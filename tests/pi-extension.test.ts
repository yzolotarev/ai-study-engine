import assert from "node:assert/strict";
import test from "node:test";
import { StudyStore } from "../src/db/store.js";
import { STUDY_TOOLS } from "../extensions/study-engine/study-tools.js";

test("STUDY_TOOLS contains the live workflow tools", () => {
  const expectedNames = [
    "study_start",
    "study_status",
    "study_record_artifact",
    "study_capture_canvas",
    "study_confirm_canvas",
    "study_select_next",
    "study_record_attempt",
    "study_record_assessment",
    "study_request_help",
    "study_open_gap",
    "study_reviews",
  ];
  assert.equal(STUDY_TOOLS.length, expectedNames.length);
  for (const name of expectedNames) {
    const tool = STUDY_TOOLS.find((t) => t.name === name);
    assert.ok(tool, `missing tool ${name}`);
    assert.equal(tool.description.length > 0, true);
    assert.equal(typeof tool.handler, "function");
  }
});

test("STUDY_TOOLS has study_start tool", () => {
  const tool = STUDY_TOOLS.find((t) => t.name === "study_start");
  assert.ok(tool);
  assert.equal(tool.description.length > 0, true);
  assert.equal(typeof tool.handler, "function");
});

test("STUDY_TOOLS has study_status tool", () => {
  const tool = STUDY_TOOLS.find((t) => t.name === "study_status");
  assert.ok(tool);
  assert.equal(tool.description.length > 0, true);
  assert.equal(typeof tool.handler, "function");
});

test("study_status returns contamination info", () => {
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

  const tool = STUDY_TOOLS.find((t) => t.name === "study_status");
  assert.ok(tool);

  const result = tool.handler(store, { sessionId: session.id }) as {
    sessionId: string;
    contaminationCount: number;
    contaminatedTargets: Array<{ targetId: string; scope: string; helpLevel: string }>;
    operationCount: number;
  };

  assert.equal(result.sessionId, session.id);
  assert.equal(result.contaminationCount, 1);
  assert.equal(result.contaminatedTargets.length, 1);
  const target = result.contaminatedTargets[0];
  assert.ok(target);
  assert.equal(target.targetId, "cauchy-riemann");
  assert.equal(target.helpLevel, "structure_reveal");
  assert.equal(result.operationCount, 1);

  store.close();
});

test("STUDY_TOOLS has study_record_artifact tool", () => {
  const tool = STUDY_TOOLS.find((t) => t.name === "study_record_artifact");
  assert.ok(tool);
  assert.equal(tool.description.length > 0, true);
  assert.equal(typeof tool.handler, "function");
});