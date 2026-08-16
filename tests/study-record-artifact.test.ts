import assert from "node:assert/strict";
import test from "node:test";
import { StudyStore } from "../src/db/store.js";
import { STUDY_TOOLS } from "../extensions/study-engine/study-tools.js";

test("study_record_artifact records operation and returns next move", () => {
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

  const tool = STUDY_TOOLS.find((t) => t.name === "study_record_artifact");
  assert.ok(tool);

  const result = tool.handler(store, {
    sessionId: session.id,
    artifactType: "preview_artifact",
    artifactJson: JSON.stringify({ notes: "My preview" }),
    targetId: "cauchy-riemann",
    completedArtifacts: "[]",
  }) as {
    status: string;
    operationId: string;
    contaminationBlocked: boolean;
    currentMove: { nodeId: string; operation: string; instruction: string };
    nextMove?: { nodeId: string; operation: string };
    protocolComplete: boolean;
  };

  assert.equal(result.status, "recorded");
  assert.equal(typeof result.operationId, "string");
  assert.equal(result.contaminationBlocked, false);
  assert.equal(result.currentMove.nodeId, "learner_preview");
  assert.equal(result.protocolComplete, false);

  const operation = store.db
    .prepare("SELECT operation, author, status FROM operation_attempts WHERE operation_id = ?")
    .get(result.operationId) as unknown as { operation: string; author: string; status: string };

  assert.equal(operation.operation, "preview_material");
  assert.equal(operation.author, "learner");
  assert.equal(operation.status, "clean");

  store.close();
});

test("study_record_artifact blocks help when target is contaminated", () => {
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

  const tool = STUDY_TOOLS.find((t) => t.name === "study_record_artifact");
  assert.ok(tool);

  const result = tool.handler(store, {
    sessionId: session.id,
    artifactType: "preview_artifact",
    artifactJson: JSON.stringify({ notes: "Attempt" }),
    targetId: "cauchy-riemann",
    completedArtifacts: "[]",
  }) as {
    status: string;
    contaminationBlocked: boolean;
    enforcedHelpLevel: string;
    currentMove: { instruction: string };
  };

  assert.equal(result.status, "recorded");
  assert.equal(result.contaminationBlocked, true);
  assert.equal(result.enforcedHelpLevel, "none");
  assert.ok(result.currentMove.instruction.includes("загрязнён"));

  store.close();
});

test("study_record_artifact includes assessment result", () => {
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

  const tool = STUDY_TOOLS.find((t) => t.name === "study_record_artifact");
  assert.ok(tool);

  const result = tool.handler(store, {
    sessionId: session.id,
    artifactType: "preview_artifact",
    artifactJson: JSON.stringify({
      structure_overview: "Three sections",
      key_areas: "Derivatives and integrals",
      uncertainty_zones: "Conformal maps",
    }),
    targetId: "cauchy-riemann",
    completedArtifacts: "[]",
  }) as {
    status: string;
    assessment: { score: number; maxScore: number; passed: boolean; feedback: string[] };
  };

  assert.equal(result.status, "recorded");
  assert.ok(result.assessment);
  assert.equal(result.assessment.score, 3);
  assert.equal(result.assessment.maxScore, 3);
  assert.equal(result.assessment.passed, true);

  store.close();
});

test("study_record_artifact returns protocol_complete only after every artifact is recorded in SQLite", () => {
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

  const tool = STUDY_TOOLS.find((t) => t.name === "study_record_artifact");
  assert.ok(tool);

  // Each artifact must be recorded so its evidence lands in SQLite. A
  // caller-supplied completedArtifacts list is ignored by design.
  const tokens = [
    "preview_artifact",
    "questions_artifact",
    "grouping_artifact",
    "relations_artifact",
    "reconstruction_artifact",
    "application_artifact",
    "delayed_retrieval_artifact",
  ];

  let lastStatus = "";
  for (const token of tokens) {
    const res = tool.handler(store, {
      sessionId: session.id,
      artifactType: token,
      artifactJson: JSON.stringify({ notes: token }),
      targetId: "cauchy-riemann",
    }) as { status: string; protocolComplete: boolean };
    lastStatus = res.status;
    if (token !== "delayed_retrieval_artifact") {
      assert.equal(res.status, "recorded");
      assert.equal(res.protocolComplete, false);
    }
  }

  const finalRes = tool.handler(store, {
    sessionId: session.id,
    artifactType: "delayed_retrieval_artifact",
    artifactJson: JSON.stringify({ explanation: "Final" }),
    targetId: "cauchy-riemann",
  }) as { status: string; protocolComplete: boolean };

  assert.equal(finalRes.status, "protocol_complete");
  assert.equal(finalRes.protocolComplete, true);

  const persisted = store.getValidProtocolEvidence(session.id);
  for (const token of tokens) assert.ok(persisted.includes(token), `missing ${token}`);

  store.close();
});