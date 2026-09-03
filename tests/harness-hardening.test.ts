import assert from "node:assert/strict";
import test from "node:test";
import { StudyStore } from "../src/db/store.js";
import {
  HARNESS_SCHEMA_VERSION,
  PRE_HARDENING_SCHEMA_VERSION,
  MemoryHarnessRepository,
  SQLiteHarnessRepository,
  StudyHarness,
  TrustedLearnerIngress,
  decodeHarnessEvent,
  evaluateCompletion,
  projectHarness,
  type CriterionAssessmentInput,
  type Subject,
  type TargetDefinition,
} from "../src/harness/index.js";
import { HARNESS_TOOLS } from "../extensions/study-engine/harness-tools.js";

const SAMPLE =
  "chronology identifies 1929 before 1933 evidence includes unemployment decree rule causes separated structural contingent factors";

const NOVEL: Record<Subject, string> = {
  history: "the 1931 banking crisis converted a liquidity squeeze into a political crisis that ended parliamentary government",
  law: "a duty of care is owed when foreseeability and proximity establish a relationship of reliance between the parties",
  economics: "a price ceiling below equilibrium generates excess demand and a persistent shortage until non price rationing emerges",
  general: "the core claim is that spaced retrieval strengthens memory more than rereading because it forces recall",
};

function autoClock(startMs = Date.parse("2026-06-01T00:00:00.000Z")) {
  let ms = startMs;
  return { now: () => { ms += 1000; return new Date(ms).toISOString(); } };
}

function ids() {
  let n = 0;
  return () => `id-${++n}`;
}

function assessAll(target: TargetDefinition, content: string, failedIndex?: number): CriterionAssessmentInput[] {
  return target.criteria.map((criterion, index) => ({
    criterionId: criterion.id,
    met: index !== failedIndex,
    quotes: index === failedIndex ? [] : [content.slice(0, 6)],
  }));
}

function startSession(harness: StudyHarness, subject: Subject) {
  const started = harness.start("learner-1", {
    capability: "Capability",
    targetTask: "Target task",
    successCriteria: "Accurate",
    subject,
  });
  new TrustedLearnerIngress(harness).confirmGoal(started.sessionId, "yes, this is my goal");
  harness.defineTargets(started.sessionId);
  const target = Object.values(harness.status(started.sessionId).projection.targets)[0]!;
  return { sessionId: started.sessionId, target };
}

function learnerAttempt(
  harness: StudyHarness,
  sessionId: string,
  target: TargetDefinition,
  kind: "baseline" | "retrieval" | "transfer",
  content: string,
  failedIndex?: number,
) {
  const begun = harness.beginAttempt(sessionId, { kind, targetIds: [target.id] });
  new TrustedLearnerIngress(harness).submitArtifact(sessionId, begun.attemptId, content);
  const state = harness.assess(sessionId, begun.attemptId, assessAll(target, content, failedIndex));
  return { attemptId: begun.attemptId, state };
}

function buildCompletable(subject: Subject) {
  const repo = new MemoryHarnessRepository();
  const harness = new StudyHarness(repo, { now: autoClock().now, id: ids() });
  const { sessionId, target } = startSession(harness, subject);
  const baseline = learnerAttempt(harness, sessionId, target, "baseline", SAMPLE, 1);
  const gap = harness.openGap(sessionId, {
    attemptId: baseline.attemptId,
    targetId: target.id,
    criterionId: target.criteria[1]!.id,
    diagnosis: "missing evidence",
  });
  harness.remediate(sessionId, gap.gapId, "Use one named fact per causal link.");
  learnerAttempt(harness, sessionId, target, "retrieval", SAMPLE);
  learnerAttempt(harness, sessionId, target, "transfer", NOVEL[subject]);
  return { repo, harness, sessionId, target };
}

function completeHappyPath(subject: Subject) {
  const { harness, sessionId, target } = buildCompletable(subject);
  const completion = harness.complete(sessionId);
  return { harness, sessionId, target, completion };
}

test("AI-facing tool cannot record learner evidence or confirm a goal (trusted ingress only)", () => {
  const store = new StudyStore(":memory:");
  const call = (name: string, params: Record<string, unknown>) => {
    const tool = HARNESS_TOOLS.find((candidate) => candidate.name === name);
    assert.ok(tool, `missing tool ${name}`);
    return tool.handler(store, params) as any;
  };
  // No tool may create a learner confirmation or submit learner evidence.
  assert.equal(HARNESS_TOOLS.some((tool) => tool.name.includes("confirm")), false);
  assert.equal(HARNESS_TOOLS.some((tool) => tool.name === "study_v2_submit"), true);

  const started = call("study_v2_start", {
    learnerId: "ai-learner", subject: "law", capability: "Apply negligence",
    targetTask: "Analyze a novel fact pattern", successCriteria: "Issue, rule, application, counterargument",
  });
  // request_learner_input records nothing and points back to trusted ingress.
  const requested = call("study_v2_request_learner_input", { sessionId: started.sessionId });
  assert.equal(requested.recorded, false);
  assert.match(requested.trustBoundary, /trusted/i);

  // The submit tool refuses learner provenance outright.
  assert.throws(
    () => call("study_v2_submit", { sessionId: started.sessionId, attemptId: "x", content: "my work", author: "learner" }),
    /ai or shared/,
  );

  // Without trusted ingress, the goal is never confirmed and completion is impossible.
  const status = call("study_v2_status", { sessionId: started.sessionId });
  assert.equal(status.projection.goalConfirmedAt, undefined);
  assert.equal(status.completion.complete, false);

  // Trusted ingress is the only path that produces learner confirmation.
  const harness = new StudyHarness(new SQLiteHarnessRepository(store));
  new TrustedLearnerIngress(harness).confirmGoal(started.sessionId, "confirmed by human");
  assert.notEqual(harness.status(started.sessionId).projection.goalConfirmedAt, undefined);
  store.close();
});

test("trusted ingress happy path produces valid learner confirmation and artifact", () => {
  const harness = new StudyHarness(new MemoryHarnessRepository(), { now: autoClock().now, id: ids() });
  const { sessionId, target } = startSession(harness, "general");
  const begun = harness.beginAttempt(sessionId, { kind: "baseline", targetIds: [target.id] });
  const real = new TrustedLearnerIngress(harness).submitArtifact(sessionId, begun.attemptId, "learner answer");
  const attempt = harness.status(sessionId).projection.attempts[begun.attemptId]!;
  assert.equal(attempt.artifact?.author, "learner");
  assert.equal(attempt.artifact?.content, "learner answer");
  assert.equal(real.artifactId.length > 0, true);
});

test("anomaly blocks an otherwise-successful completion", () => {
  // A clean journal of the same shape would complete.
  const clean = buildCompletable("history");
  assert.equal(clean.harness.complete(clean.sessionId).recorded, true);

  // A pre-existing malformed raw ledger row (injected before completion) blocks it.
  const { repo, harness, sessionId } = buildCompletable("history");
  repo.append({
    eventId: "raw-malformed",
    sessionId,
    type: "harness.unknown.event",
    schemaVersion: HARNESS_SCHEMA_VERSION,
    occurredAt: "2026-01-01T00:00:00.000Z",
    actor: "engine",
    payload: {},
  } as unknown as Parameters<MemoryHarnessRepository["append"]>[0]);
  const blocked = harness.complete(sessionId);
  assert.equal(blocked.recorded, false);
  assert.ok(blocked.decision.reasons.some((reason) => reason.includes("anomaly")));
});

test("invalid runtime command never reaches the ledger", () => {
  const repo = new MemoryHarnessRepository();
  const harness = new StudyHarness(repo, { now: autoClock().now, id: ids() });
  const { sessionId, target } = startSession(harness, "general");
  // An attempt referencing an unknown target is rejected by the projector before append.
  assert.throws(
    () => harness.beginAttempt(sessionId, { kind: "baseline", targetIds: ["does-not-exist"] }),
    /INVALID_ATTEMPT_TARGET/,
  );
  // A transfer without a prior passing retrieval is likewise rejected before append.
  learnerAttempt(harness, sessionId, target, "baseline", SAMPLE);
  const before = repo.load(sessionId).length;
  assert.throws(
    () => harness.beginAttempt(sessionId, { kind: "transfer", targetIds: [target.id] }),
    /PRIMARY_RETRIEVAL_REQUIRED/,
  );
  assert.equal(repo.load(sessionId).length, before);
});

test("unknown raw event becomes a replay anomaly without throwing", () => {
  const proj = projectHarness([{
    eventId: "e1", sessionId: "s", type: "harness.unknown.event", schemaVersion: HARNESS_SCHEMA_VERSION,
    occurredAt: "2026-01-01T00:00:00.000Z", actor: "engine", payload: {},
  }]);
  assert.equal(proj.anomalies.length, 1);
  assert.equal(proj.anomalies[0]!.code, "UNKNOWN_EVENT_TYPE");
});

test("malformed event does not crash replay", () => {
  const proj = projectHarness([{ foo: "bar" }, null, 42, "garbage"]);
  assert.ok(proj.anomalies.some((item) => item.code === "MALFORMED_EVENT"));
  assert.equal(Object.keys(proj.attempts).length, 0);
});

test("attempt is started and submitted before remediation, then assessed after remediation", () => {
  const harness = new StudyHarness(new MemoryHarnessRepository(), { now: autoClock().now, id: ids() });
  const { sessionId, target } = startSession(harness, "history");
  const baseline = learnerAttempt(harness, sessionId, target, "baseline", SAMPLE, 1);
  // Submit happened before any remediation; now open the gap and remediate.
  const gap = harness.openGap(sessionId, {
    attemptId: baseline.attemptId, targetId: target.id,
    criterionId: target.criteria[1]!.id, diagnosis: "needs evidence",
  });
  harness.remediate(sessionId, gap.gapId, "Cite one named fact.");
  // Assessment (resolution) occurs after remediation via a clean retrieval.
  learnerAttempt(harness, sessionId, target, "retrieval", SAMPLE);
  const resolved = harness.status(sessionId).projection.gaps[gap.gapId]!;
  assert.notEqual(resolved.resolvedAt, undefined);
  assert.equal(harness.status(sessionId).projection.anomalies.length, 0);
});

test("multiple remediations in a row are all counted", () => {
  const harness = new StudyHarness(new MemoryHarnessRepository(), { now: autoClock().now, id: ids() });
  const { sessionId, target } = startSession(harness, "law");
  const baseline = learnerAttempt(harness, sessionId, target, "baseline", SAMPLE, 0);
  const gap = harness.openGap(sessionId, {
    attemptId: baseline.attemptId, targetId: target.id,
    criterionId: target.criteria[0]!.id, diagnosis: "missing issue",
  });
  harness.remediate(sessionId, gap.gapId, "First intervention.");
  harness.remediate(sessionId, gap.gapId, "Second intervention.");
  const stored = harness.status(sessionId).projection.gaps[gap.gapId]!;
  assert.equal(stored.remediationCount, 2);
  assert.notEqual(stored.lastRemediatedAt, undefined);
});

test("substantive help without an active attempt is rejected", () => {
  const harness = new StudyHarness(new MemoryHarnessRepository(), { now: autoClock().now, id: ids() });
  const { sessionId } = startSession(harness, "general");
  assert.throws(() => harness.help(sessionId, "Here is the answer.", "answer"), /HELP_WITHOUT_ACTIVE_ATTEMPT/);
});

test("help after submission is rejected", () => {
  const harness = new StudyHarness(new MemoryHarnessRepository(), { now: autoClock().now, id: ids() });
  const { sessionId, target } = startSession(harness, "general");
  const begun = harness.beginAttempt(sessionId, { kind: "baseline", targetIds: [target.id] });
  new TrustedLearnerIngress(harness).submitArtifact(sessionId, begun.attemptId, "my answer");
  assert.throws(() => harness.help(sessionId, "Hint: think harder.", "content_hint", begun.attemptId), /HELP_AFTER_SUBMISSION/);
});

test("transfer before any retrieval is rejected", () => {
  const harness = new StudyHarness(new MemoryHarnessRepository(), { now: autoClock().now, id: ids() });
  const { sessionId, target } = startSession(harness, "economics");
  // A clean assessed baseline exists, but no retrieval yet.
  learnerAttempt(harness, sessionId, target, "baseline", SAMPLE);
  assert.throws(() => harness.beginAttempt(sessionId, { kind: "transfer", targetIds: [target.id] }), /PRIMARY_RETRIEVAL_REQUIRED/);
});

test("transfer before a passing assessed retrieval is rejected", () => {
  const harness = new StudyHarness(new MemoryHarnessRepository(), { now: autoClock().now, id: ids() });
  const { sessionId, target } = startSession(harness, "economics");
  learnerAttempt(harness, sessionId, target, "baseline", SAMPLE, 1);
  // Retrieval exists but is submitted and assessed as failing: not an independent primary retrieval.
  const retrieval = harness.beginAttempt(sessionId, { kind: "retrieval", targetIds: [target.id] });
  new TrustedLearnerIngress(harness).submitArtifact(sessionId, retrieval.attemptId, SAMPLE);
  harness.assess(sessionId, retrieval.attemptId, assessAll(target, SAMPLE, 0));
  assert.throws(() => harness.beginAttempt(sessionId, { kind: "transfer", targetIds: [target.id] }), /PRIMARY_RETRIEVAL_REQUIRED/);
});

test("transfer that only changes case, punctuation, or whitespace is not novel", () => {
  const harness = new StudyHarness(new MemoryHarnessRepository(), { now: autoClock().now, id: ids() });
  const { sessionId, target } = startSession(harness, "history");
  learnerAttempt(harness, sessionId, target, "baseline", SAMPLE, 1);
  harness.openGap(sessionId, { attemptId: Object.keys(harness.status(sessionId).projection.attempts)[0]!, targetId: target.id, criterionId: target.criteria[1]!.id, diagnosis: "x" });
  learnerAttempt(harness, sessionId, target, "retrieval", SAMPLE);
  const tweaked = SAMPLE.toUpperCase().replace(/ /g, "   ");
  learnerAttempt(harness, sessionId, target, "transfer", tweaked);
  const completion = harness.complete(sessionId);
  assert.equal(completion.recorded, false);
  assert.ok(completion.decision.reasons.some((reason) => reason.toLowerCase().includes("transfer")));
});

test("genuinely novel history, law, and economics transfers complete", () => {
  for (const subject of ["history", "law", "economics", "general"] as const) {
    const { completion } = completeHappyPath(subject);
    assert.equal(completion.recorded, true, `${subject} transfer should complete`);
  }
});

test("whitespace-only and punctuation-only quotes are rejected", () => {
  const harness = new StudyHarness(new MemoryHarnessRepository(), { now: autoClock().now, id: ids() });
  const { sessionId, target } = startSession(harness, "general");
  const begun = harness.beginAttempt(sessionId, { kind: "baseline", targetIds: [target.id] });
  new TrustedLearnerIngress(harness).submitArtifact(sessionId, begun.attemptId, "real learner answer");
  assert.throws(
    () => harness.assess(sessionId, begun.attemptId, [{ criterionId: target.criteria[0]!.id, met: true, quotes: ["   ", "..."] }]),
    /INVALID_ASSESSMENT/,
  );
});

test("AI/shared artifact creates no learner mastery and still permits a clean retry", () => {
  const harness = new StudyHarness(new MemoryHarnessRepository(), { now: autoClock().now, id: ids() });
  const { sessionId, target } = startSession(harness, "general");
  learnerAttempt(harness, sessionId, target, "baseline", SAMPLE, 1);
  const retrieval = harness.beginAttempt(sessionId, { kind: "retrieval", targetIds: [target.id] });
  harness.recordArtifact(sessionId, retrieval.attemptId, "model-generated text", "ai");
  assert.throws(() => harness.assess(sessionId, retrieval.attemptId, assessAll(target, "model-generated text")), /INVALID_ASSESSMENT/);
  // Completion is blocked because the retrieval has no learner evidence.
  assert.equal(harness.complete(sessionId).recorded, false);
  // A clean learner reattempt is still allowed (no contamination lock).
  const retry = harness.beginAttempt(sessionId, { kind: "retrieval", targetIds: [target.id] });
  assert.ok(retry.attemptId);
});

test("next lifecycle returns submit, assess, and done", () => {
  const harness = new StudyHarness(new MemoryHarnessRepository(), { now: autoClock().now, id: ids() });
  const { sessionId, target } = startSession(harness, "general");
  const begun = harness.beginAttempt(sessionId, { kind: "baseline", targetIds: [target.id] });
  assert.equal(harness.status(sessionId).next.stage, "submit");
  new TrustedLearnerIngress(harness).submitArtifact(sessionId, begun.attemptId, "answer");
  assert.equal(harness.status(sessionId).next.stage, "assess");

  const done = completeHappyPath("general");
  assert.equal(done.harness.status(done.sessionId).next.stage, "done");
});

test("completion is idempotent", () => {
  const { harness, sessionId } = completeHappyPath("history");
  const first = harness.complete(sessionId);
  assert.equal(first.recorded, true);
  const second = harness.complete(sessionId);
  assert.equal(second.recorded, true);
  assert.equal(second.alreadyCompleted, true);
  const third = harness.complete(sessionId);
  assert.equal(third.alreadyCompleted, true);
  // No duplicate completion event: completedAt is stable across calls.
  assert.equal(harness.status(sessionId).projection.completedAt, first.projection.completedAt);
});

test("memory repository is mutation-resistant", () => {
  const repo = new MemoryHarnessRepository();
  const harness = new StudyHarness(repo, { now: autoClock().now, id: ids() });
  const { sessionId, target } = startSession(harness, "general");
  const begun = harness.beginAttempt(sessionId, { kind: "baseline", targetIds: [target.id] });
  new TrustedLearnerIngress(harness).submitArtifact(sessionId, begun.attemptId, "answer");
  const loaded = repo.load(sessionId);
  const count = loaded.length;
  (loaded as unknown as unknown[]).push({ hacked: true });
  assert.equal(repo.load(sessionId).length, count);

  const projection = harness.status(sessionId).projection;
  const attempt = Object.values(projection.attempts)[0]!;
  (attempt as unknown as { kind: string }).kind = "HACKED";
  const attempt2 = Object.values(harness.status(sessionId).projection.attempts)[0]!;
  assert.notEqual(attempt2.kind, "HACKED");
});

test("corrupt SQLite row fails closed on replay", () => {
  const store = new StudyStore(":memory:");
  store.ensureUser("u1");
  store.db
    .prepare(
      `INSERT INTO study_events(
         event_id, learner_id, study_session_id, event_type, schema_version,
         payload_json, payload_hash, integrity_status, actor, provenance_json,
         occurred_at, recorded_at, causation_event_id, correlation_id, legacy_domain_event_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "bad", "u1", null, "harness.session.started", 3,
      JSON.stringify({ broken: true }), "deadbeef", "legacy_unverified", "user",
      JSON.stringify({ kind: "PRODUCT_DECISION", sourceIds: [], policyVersion: "harness-v3" }),
      "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z", null, "sess", "bad",
    );
  const harness = new StudyHarness(new SQLiteHarnessRepository(store));
  const projection = harness.status("sess").projection;
  assert.equal(projection.anomalies.length, 1);
  assert.equal(projection.anomalies[0]!.code, "UNVERIFIED_EVENT");
  assert.equal(harness.complete("sess").recorded, false);
  store.close();
});

test("pre-hardening schema-v2 replay is marked unverified and cannot prove mastery", () => {
  const v2 = [
    { eventId: "s", sessionId: "sess", type: "harness.session.started", schemaVersion: PRE_HARDENING_SCHEMA_VERSION, occurredAt: "2026-01-01T00:00:00.000Z", actor: "engine" as const, payload: { learnerId: "l", goal: { capability: "c", targetTask: "t", successCriteria: "s", subject: "general" as const } } },
    { eventId: "c", sessionId: "sess", type: "harness.goal.confirmed", schemaVersion: PRE_HARDENING_SCHEMA_VERSION, occurredAt: "2026-01-01T00:00:01.000Z", actor: "learner" as const, payload: { confirmation: "yes" } },
    { eventId: "t", sessionId: "sess", type: "harness.targets.defined", schemaVersion: PRE_HARDENING_SCHEMA_VERSION, occurredAt: "2026-01-01T00:00:02.000Z", actor: "engine" as const, payload: { targets: [], generatedBy: "adapter" as const } },
  ];
  const proj = projectHarness(v2);
  assert.ok(proj.anomalies.every((item) => item.code === "PRE_HARDENING_SCHEMA"));
  assert.equal(evaluateCompletion(proj).complete, false);

  // Current schema decodes cleanly; unsupported versions are rejected.
  const current = decodeHarnessEvent({ eventId: "x", sessionId: "sess", type: "harness.goal.confirmed", schemaVersion: HARNESS_SCHEMA_VERSION, occurredAt: "2026-01-01T00:00:00.000Z", actor: "learner", payload: { confirmation: "yes" } }, 0);
  assert.ok(current.event);
  const legacy = decodeHarnessEvent({ eventId: "x", sessionId: "sess", type: "harness.goal.confirmed", schemaVersion: 1, occurredAt: "2026-01-01T00:00:00.000Z", actor: "learner", payload: { confirmation: "yes" } }, 0);
  assert.equal(legacy.anomaly?.code, "UNSUPPORTED_SCHEMA");
});
