import assert from "node:assert/strict";
import test from "node:test";
import { StudyStore } from "../src/db/store.js";

const productDecision = { kind: "PRODUCT_DECISION" as const, sourceIds: [], policyVersion: "test" };

test("store creates and transitions a persistent study session transactionally", () => {
  const store = new StudyStore(":memory:");
  store.ensureUser("u1");
  const objectiveId = store.createObjective({
    userId: "u1",
    title: "Fractions",
    observableOutcome: "Explain and solve fraction addition",
    targetTask: "Solve a new fraction problem and explain why",
    assessmentFormat: "written problem plus explanation",
    stakes: "normal",
    provenance: productDecision,
  });
  const session = store.createSession("u1", objectiveId, "pi-1");
  assert.equal(session.currentState, "OUTCOME");
  assert.equal(store.countEvents(session.id), 1);
  assert.equal(store.countStudyEvents(session.id), 1);
  assert.deepEqual(store.getPinnedPolicyBundle(session.id), { bundleId: "core-default", bundleVersion: 2 });

  const transitioned = store.transition({
    sessionId: session.id,
    expectedVersion: session.stateVersion,
    to: "BASELINE_PROBE",
    evidence: { objectiveExplicit: true },
    actor: "user",
    provenance: productDecision,
  });
  assert.equal(transitioned.currentState, "BASELINE_PROBE");
  assert.equal(transitioned.stateVersion, 1);
  assert.equal(store.countEvents(session.id), 2);
  assert.equal(store.countStudyEvents(session.id), 2);
  const normalized = store.db
    .prepare(
      `SELECT sequence, payload_hash, integrity_status, actor, correlation_id
       FROM study_events WHERE study_session_id = ? ORDER BY sequence`,
    )
    .all(session.id) as unknown as Array<{
      sequence: number;
      payload_hash: string;
      integrity_status: string;
      actor: string;
      correlation_id: string;
    }>;
  assert.equal(normalized.length, 2);
  assert.equal(normalized.every((event) => event.payload_hash.length === 64), true);
  assert.equal(normalized.every((event) => event.integrity_status === "verified"), true);
  assert.deepEqual(normalized.map((event) => event.actor), ["engine", "user"]);
  assert.equal(normalized.every((event) => event.correlation_id === session.attemptBranchId), true);
  assert.equal(normalized[1]!.sequence > normalized[0]!.sequence, true);
  assert.equal(store.getActiveSession("pi-1")?.id, session.id);
  store.close();
});

test("store rejects stale state versions", () => {
  const store = new StudyStore(":memory:");
  store.ensureUser("u1");
  const objectiveId = store.createObjective({
    userId: "u1",
    title: "Topic",
    observableOutcome: "Explain topic",
    targetTask: "Give an explanation",
    assessmentFormat: "oral",
    stakes: "normal",
    provenance: productDecision,
  });
  const session = store.createSession("u1", objectiveId);
  assert.throws(() =>
    store.transition({
      sessionId: session.id,
      expectedVersion: 99,
      to: "BASELINE_PROBE",
      evidence: { objectiveExplicit: true },
      actor: "ai",
      provenance: productDecision,
    }),
  /version conflict/i);
  store.close();
});