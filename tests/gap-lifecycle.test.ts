import assert from "node:assert/strict";
import test from "node:test";
import { StudyStore } from "../src/db/store.js";

test("openGap creates gap with open status", () => {
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

  const gapId = store.openGap({
    sessionId: session.id,
    targetId: "cauchy-riemann",
    openedByEvidenceId: "evidence-1",
  });

  assert.equal(typeof gapId, "string");
  assert.equal(gapId.length, 36);

  const row = store.db
    .prepare("SELECT status, target_id, opened_by_evidence_id FROM gap_records WHERE gap_id = ?")
    .get(gapId) as unknown as { status: string; target_id: string; opened_by_evidence_id: string };

  assert.equal(row.status, "open");
  assert.equal(row.target_id, "cauchy-riemann");
  assert.equal(row.opened_by_evidence_id, "evidence-1");

  store.close();
});

test("provisionallyCloseGap transitions to provisional_closed", () => {
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

  const gapId = store.openGap({
    sessionId: session.id,
    targetId: "cauchy-riemann",
  });

  store.provisionallyCloseGap(gapId, "evidence-2", "independent_reconstruction");

  const row = store.db
    .prepare("SELECT status, closure_method, closure_evidence_id FROM gap_records WHERE gap_id = ?")
    .get(gapId) as unknown as { status: string; closure_method: string; closure_evidence_id: string };

  assert.equal(row.status, "provisional_closed");
  assert.equal(row.closure_method, "independent_reconstruction");
  assert.equal(row.closure_evidence_id, "evidence-2");

  store.close();
});

test("verifyGap transitions to verified", () => {
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

  const gapId = store.openGap({
    sessionId: session.id,
    targetId: "cauchy-riemann",
  });

  store.provisionallyCloseGap(gapId, "evidence-2");
  store.verifyGap(gapId, "evidence-3");

  const row = store.db
    .prepare("SELECT status, verified_by_evidence_id FROM gap_records WHERE gap_id = ?")
    .get(gapId) as unknown as { status: string; verified_by_evidence_id: string };

  assert.equal(row.status, "verified");
  assert.equal(row.verified_by_evidence_id, "evidence-3");

  store.close();
});