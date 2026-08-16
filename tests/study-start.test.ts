import assert from "node:assert/strict";
import test from "node:test";
import { StudyStore } from "../src/db/store.js";
import { STUDY_TOOLS } from "../extensions/study-engine/study-tools.js";

test("study_start creates session and returns first move", () => {
  const store = new StudyStore(":memory:");
  const tool = STUDY_TOOLS.find((t) => t.name === "study_start");
  assert.ok(tool);

  const result = tool.handler(store, {
    capability: "объяснять ключевые идеи комплексного анализа",
    targetTask: "объяснить 15 концепций простым языком",
    successCriteria: "корректно объясняет минимум 12 из 15",
  }) as {
    contractId: string;
    sessionId: string;
    protocolId: string;
    protocolVersion: string;
    firstMove?: { nodeId: string; operation: string; instruction: string };
  };

  assert.equal(typeof result.contractId, "string");
  assert.equal(typeof result.sessionId, "string");
  assert.equal(result.protocolId, "conceptual-dialogue");
  assert.equal(result.protocolVersion, "1");
  assert.ok(result.firstMove);
  assert.equal(result.firstMove.nodeId, "learner_preview");
  assert.equal(result.firstMove.operation, "preview_material");

  const contract = store.getGoalContract(result.contractId);
  assert.ok(contract);
  assert.equal(contract.capability, "объяснять ключевые идеи комплексного анализа");
  assert.equal(contract.learnerConfirmed, true);

  store.close();
});

test("study_start throws on empty capability", () => {
  const store = new StudyStore(":memory:");
  const tool = STUDY_TOOLS.find((t) => t.name === "study_start");
  assert.ok(tool);

  assert.throws(() => {
    tool.handler(store, {
      capability: "",
      targetTask: "test",
      successCriteria: "test",
    });
  }, /non-empty capability/);

  store.close();
});