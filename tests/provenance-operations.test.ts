import assert from "node:assert/strict";
import test from "node:test";
import { StudyStore } from "../src/db/store.js";

test("recordOperation with structure_reveal opens contamination", () => {
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

  const operationId = store.recordOperation({
    sessionId: session.id,
    targetId: "cauchy-riemann",
    operation: "propose_relation",
    author: "ai",
    helpLevel: "structure_reveal",
    contaminationScope: "relation",
    confidence: "high",
    status: "contaminated",
  });

  assert.equal(typeof operationId, "string");
  assert.equal(operationId.length, 36);

  const contamination = store.getContaminationStatus("cauchy-riemann", "relation");
  assert.ok(contamination);
  assert.equal(contamination.status, "contaminated");
  assert.equal(contamination.helpLevel, "structure_reveal");

  store.close();
});

test("closeContamination transitions to provisional_owned", () => {
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

  store.recordOperation({
    sessionId: session.id,
    targetId: "cauchy-riemann",
    operation: "propose_relation",
    author: "ai",
    helpLevel: "structure_reveal",
    contaminationScope: "relation",
  });

  const contamination = store.getContaminationStatus("cauchy-riemann", "relation");
  assert.ok(contamination);
  assert.equal(contamination.status, "contaminated");

  const closureId = store.closeContamination(
    contamination.recordId,
    "independent_reconstruction",
    "evidence-123",
  );

  assert.equal(typeof closureId, "string");

  const after = store.getContaminationStatus("cauchy-riemann", "relation");
  assert.ok(after);
  assert.equal(after.status, "provisional_owned");

  store.close();
});

test("non-contaminating help level does not create contamination record", () => {
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

  store.recordOperation({
    sessionId: session.id,
    targetId: "complex-number",
    operation: "explain_simply",
    author: "learner",
    helpLevel: "none",
    confidence: "high",
    status: "clean",
  });

  const contamination = store.getContaminationStatus("complex-number");
  assert.equal(contamination, undefined);

  store.close();
});