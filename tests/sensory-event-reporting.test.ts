import assert from "node:assert/strict";
import test from "node:test";

import { StudyStore } from "../src/db/store.js";
import { evaluatePolicies, evaluateAfterSensoryEvent } from "../src/core/policy/engine.js";
import type { Provenance } from "../src/core/provenance.js";

function setup() {
  const store = new StudyStore(":memory:");
  store.ensureUser("learner");
  const objectiveId = store.createObjective({
    userId: "learner",
    title: "Sensory integration",
    observableOutcome: "Encode independently",
    targetTask: "Build the map without help",
    assessmentFormat: "written",
    stakes: "normal",
    provenance: { kind: "PRODUCT_DECISION", sourceIds: [] },
  });
  const session = store.createSession("learner", objectiveId);
  return { store, session };
}

test("neighborhood_expansion records sensory_input and opens contaminated target", () => {
  const { store, session } = setup();
  const targetId = "target:shape-1";

  const eventId = store.recordSensoryEvent({
    learnerId: "learner",
    studySessionId: session.id,
    subtype: "neighborhood_expansion",
    payload: { sourceTextLength: 120, resultLength: 18, nucleus: "perimeter" },
  });

  assert.match(eventId, /[0-9a-f-]{36}/);
  assert.equal(
    store.countStudyEventsByType({ learnerId: "learner", eventType: "sensory_input", targetId: null }),
    1,
  );

  const recId = store.openSensoryContamination({
    learnerId: "learner",
    studySessionId: session.id,
    targetId,
    subtype: "neighborhood_expansion",
    eventId,
  });
  assert.ok(recId, "contamination record created");

  const status = store.getContaminationStatus(targetId);
  assert.equal(status?.status, "contaminated");
  assert.equal(status?.helpLevel, "content_cue");
});

test("familiarity_scaffold opens familiarity_only target", () => {
  const { store, session } = setup();
  const targetId = "target:term-7";

  const eventId = store.recordSensoryEvent({
    learnerId: "learner",
    studySessionId: session.id,
    subtype: "familiarity_scaffold",
    payload: { sourceTextLength: 40, resultLength: 5 },
  });
  store.openSensoryContamination({
    learnerId: "learner",
    studySessionId: session.id,
    targetId,
    subtype: "familiarity_scaffold",
    eventId,
  });

  const status = store.getContaminationStatus(targetId);
  assert.equal(status?.status, "familiarity_only");
  assert.equal(status?.helpLevel, "familiarity");
});

test("identify_key_terms records event but changes no contamination", () => {
  const { store, session } = setup();
  const targetId = "target:term-9";

  const eventId = store.recordSensoryEvent({
    learnerId: "learner",
    studySessionId: session.id,
    subtype: "identify_key_terms",
    payload: { sourceTextLength: 60, resultLength: 3, nucleus: null },
  });
  const recId = store.openSensoryContamination({
    learnerId: "learner",
    studySessionId: session.id,
    targetId,
    subtype: "identify_key_terms",
    eventId,
  });

  assert.equal(recId, undefined);
  assert.equal(store.getContaminationStatus(targetId), undefined);
  assert.equal(
    store.countStudyEventsByType({ learnerId: "learner", eventType: "sensory_input" }),
    1,
  );
});

test("last_sensory_input anchor and event_count detection work after event", () => {
  const { store, session } = setup();

  // Before any sensory input the anchor must be null (-> uncertain, never false).
  assert.equal(store.findAnchorTimestamp(session.userId, session.id, "last_sensory_input"), null);

  store.recordSensoryEvent({
    learnerId: "learner",
    studySessionId: session.id,
    subtype: "neighborhood_expansion",
    payload: { sourceTextLength: 10, resultLength: 1 },
  });

  const anchorTs = store.findAnchorTimestamp(session.userId, session.id, "last_sensory_input");
  assert.notEqual(anchorTs, null);
  assert.equal(
    store.countStudyEventsByTypeSince({
      learnerId: "learner",
      eventType: "sensory_input",
      anchorTs: anchorTs!,
    }),
    1,
  );
});

test("payload persists source/result lengths and nucleus", () => {
  const { store, session } = setup();
  store.recordSensoryEvent({
    learnerId: "learner",
    studySessionId: session.id,
    subtype: "neighborhood_expansion",
    payload: { sourceTextLength: 240, resultLength: 7, nucleus: "core" },
  });
  const row = store.db
    .prepare(
      `SELECT payload_json FROM study_events WHERE learner_id = ? AND event_type = 'sensory_input' ORDER BY occurred_at DESC LIMIT 1`,
    )
    .get("learner") as { payload_json: string };
  const parsed = JSON.parse(row.payload_json);
  assert.equal(parsed.subtype, "neighborhood_expansion");
  assert.equal(parsed.source_text_length, 240);
  assert.equal(parsed.result_length, 7);
  assert.equal(parsed.nucleus, "core");
  assert.ok(parsed.occurred_at);
});

function isoMinutesAgo(min: number): string {
  return new Date(Date.now() - min * 60_000).toISOString();
}

function recordActivity(
  store: StudyStore,
  session: { id: string; userId: string; attemptBranchId: string },
  eventType: string,
  occurredAt?: string,
): string {
  return store.appendEvent({
    userId: session.userId,
    studySessionId: session.id,
    attemptBranchId: session.attemptBranchId,
    type: eventType,
    payload: { occurred_at: occurredAt ?? new Date().toISOString() },
    actor: "user",
    provenance: { kind: "PRODUCT_DECISION", sourceIds: [] },
    ...(occurredAt ? { occurredAt } : {}),
  });
}

test("bp_passive_consumption_after_sensory: matched after 3 sensory inputs, no encoding", () => {
  const { store, session } = setup();

  // A prior independent attempt anchors sensory_input_count.
  recordActivity(store, session, "independent_attempt", isoMinutesAgo(20));
  // 3+ sensory inputs (>= pol_sensory_threshold) >= 5 min ago, no encoding after.
  for (let i = 0; i < 3; i++) {
    store.recordSensoryEvent({
      learnerId: "learner",
      studySessionId: session.id,
      subtype: "neighborhood_expansion",
      payload: { sourceTextLength: 50, resultLength: 4, nucleus: "x" },
      occurredAt: isoMinutesAgo(10),
    });
  }

  const res = evaluatePolicies(store, { sessionId: session.id });
  const det = res.detections.find((d) => d.policyId === "bp_passive_consumption_after_sensory");
  assert.ok(det, "policy evaluated");
  assert.equal(det!.result, "matched");
});

test("bp_passive_consumption_after_sensory: not_matched when independent encoding follows", () => {
  const { store, session } = setup();

  // A prior independent attempt anchors sensory_input_count.
  recordActivity(store, session, "independent_attempt", isoMinutesAgo(20));
  for (let i = 0; i < 3; i++) {
    store.recordSensoryEvent({
      learnerId: "learner",
      studySessionId: session.id,
      subtype: "neighborhood_expansion",
      payload: { sourceTextLength: 50, resultLength: 4, nucleus: "x" },
      occurredAt: isoMinutesAgo(10),
    });
  }
  // An independent encoding after the last sensory input breaks the antipattern.
  recordActivity(store, session, "independent_encoding", isoMinutesAgo(2));

  const res = evaluatePolicies(store, { sessionId: session.id });
  const det = res.detections.find((d) => d.policyId === "bp_passive_consumption_after_sensory");
  assert.ok(det, "policy evaluated");
  assert.notEqual(det!.result, "matched");
});

test("record-event CLI hook (evaluateAfterSensoryEvent) evaluates bp_passive_consumption on sensory input", () => {
  // Mirrors study-cli `record-event`, which calls evaluateAfterSensoryEvent after
  // recordSensoryEvent when the session has an active policy activation.
  const { store, session } = setup();
  recordActivity(store, session, "independent_attempt", isoMinutesAgo(20));
  for (let i = 0; i < 3; i++) {
    store.recordSensoryEvent({
      learnerId: "learner",
      studySessionId: session.id,
      subtype: "neighborhood_expansion",
      payload: { sourceTextLength: 50, resultLength: 4, nucleus: "x" },
      occurredAt: isoMinutesAgo(10),
    });
  }
  const res = evaluateAfterSensoryEvent(store, { sessionId: session.id });
  const det = res.detections.find((d) => d.policyId === "bp_passive_consumption_after_sensory");
  assert.ok(det, "policy evaluated via sensory hook");
  assert.equal(det!.result, "matched");
});
test("bp_passive_consumption_after_sensory: uncertain without a prior independent attempt anchor", () => {
  const { store, session } = setup();
  // 1 sensory input but no independent_attempt -> last_independent_attempt anchor is
  // null -> event_count(sensory_input, sinceAnchor) is undefined -> uncertain.
  store.recordSensoryEvent({
    learnerId: "learner",
    studySessionId: session.id,
    subtype: "identify_key_terms",
    payload: { sourceTextLength: 30, resultLength: 2 },
    occurredAt: isoMinutesAgo(10),
  });

  const res = evaluatePolicies(store, { sessionId: session.id });
  const det = res.detections.find((d) => d.policyId === "bp_passive_consumption_after_sensory");
  assert.ok(det, "policy evaluated");
  assert.equal(det!.result, "uncertain");
});
