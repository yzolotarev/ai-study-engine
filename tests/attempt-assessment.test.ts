import assert from "node:assert/strict";
import test from "node:test";
import { StudyStore } from "../src/db/store.js";

test("startAttempt creates attempt with started status", () => {
  const store = new StudyStore(":memory:");
  store.ensureUser("learner-1");
  const objectiveId = store.createObjective({
    userId: "learner-1",
    title: "Test",
    observableOutcome: "Explain",
    targetTask: "Dialogue",
    assessmentFormat: "oral",
    stakes: "normal",
    provenance: { kind: "PRODUCT_DECISION", sourceIds: [], policyVersion: "test" },
  });
  const session = store.createSession("learner-1", objectiveId);

  const attemptId = store.startAttempt({
    sessionId: session.id,
    targetId: "cauchy-riemann",
    protocolNodeId: "explain_simply",
  });

  assert.equal(typeof attemptId, "string");
  assert.equal(attemptId.length, 36);

  const row = store.db
    .prepare("SELECT status, target_id, protocol_node_id FROM attempts WHERE id = ?")
    .get(attemptId) as unknown as { status: string; target_id: string; protocol_node_id: string };

  assert.equal(row.status, "started");
  assert.equal(row.target_id, "cauchy-riemann");
  assert.equal(row.protocol_node_id, "explain_simply");

  store.close();
});

test("submitAttempt updates status to submitted and stores artifact", () => {
  const store = new StudyStore(":memory:");
  store.ensureUser("learner-1");
  const objectiveId = store.createObjective({
    userId: "learner-1",
    title: "Test",
    observableOutcome: "Explain",
    targetTask: "Dialogue",
    assessmentFormat: "oral",
    stakes: "normal",
    provenance: { kind: "PRODUCT_DECISION", sourceIds: [], policyVersion: "test" },
  });
  const session = store.createSession("learner-1", objectiveId);

  const attemptId = store.startAttempt({
    sessionId: session.id,
    targetId: "cauchy-riemann",
  });

  const artifact = JSON.stringify({ explanation: "My explanation" });
  store.submitAttempt(attemptId, artifact);

  const row = store.db
    .prepare("SELECT status, artifact_json FROM attempts WHERE id = ?")
    .get(attemptId) as unknown as { status: string; artifact_json: string };

  assert.equal(row.status, "submitted");
  assert.equal(row.artifact_json, artifact);

  store.close();
});

test("recordAssessment creates evidence records and marks attempt assessed", () => {
  const store = new StudyStore(":memory:");
  store.ensureUser("learner-1");
  const objectiveId = store.createObjective({
    userId: "learner-1",
    title: "Test",
    observableOutcome: "Explain",
    targetTask: "Dialogue",
    assessmentFormat: "oral",
    stakes: "normal",
    provenance: { kind: "PRODUCT_DECISION", sourceIds: [], policyVersion: "test" },
  });
  const session = store.createSession("learner-1", objectiveId);

  const attemptId = store.startAttempt({
    sessionId: session.id,
    targetId: "cauchy-riemann",
  });

  store.submitAttempt(attemptId, JSON.stringify({ explanation: "Test" }));

  const assessmentId = store.recordAssessment(attemptId, [
    { type: "factual_accuracy", score: 0.8, confidence: 0.9 },
    { type: "generation_quality", score: 0.7, confidence: 0.8, notes: "Good but incomplete" },
  ]);

  assert.equal(typeof assessmentId, "string");

  const attemptRow = store.db
    .prepare("SELECT status FROM attempts WHERE id = ?")
    .get(attemptId) as unknown as { status: string };

  assert.equal(attemptRow.status, "assessed");

  const evidenceCount = store.db
    .prepare("SELECT COUNT(*) AS count FROM assessment_evidence WHERE attempt_id = ?")
    .get(attemptId) as unknown as { count: number };

  assert.equal(evidenceCount.count, 2);

  store.close();
});