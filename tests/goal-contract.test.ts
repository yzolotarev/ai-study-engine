import assert from "node:assert/strict";
import test from "node:test";
import { parseGoalContract } from "../src/core/goal-contract.js";
import { StudyStore } from "../src/db/store.js";

test("parseGoalContract validates required fields", () => {
  const draft = parseGoalContract({
    capability: "объяснять ключевые идеи комплексного анализа",
    targetTask: "объяснить 15 концепций простым языком",
    successCriteria: "корректно объясняет минимум 12 из 15",
    allowedHints: ["process_only"],
    retentionDays: 7,
  });

  assert.equal(draft.capability, "объяснять ключевые идеи комплексного анализа");
  assert.equal(draft.targetTask, "объяснить 15 концепций простым языком");
  assert.equal(draft.successCriteria, "корректно объясняет минимум 12 из 15");
  assert.deepEqual(draft.allowedHints, ["process_only"]);
  assert.equal(draft.retentionDays, 7);
});

test("parseGoalContract throws on empty capability", () => {
  assert.throws(() => {
    parseGoalContract({
      capability: "",
      targetTask: "test",
      successCriteria: "test",
    });
  }, /non-empty capability/);
});

test("saveGoalContract and getGoalContract round-trip", () => {
  const store = new StudyStore(":memory:");
  store.ensureUser("learner-1");

  const contractId = "contract-1";
  store.saveGoalContract({
    contractId,
    learnerId: "learner-1",
    capability: "объяснять ключевые идеи комплексного анализа",
    targetTask: "объяснить 15 концепций простым языком",
    successCriteria: "корректно объясняет минимум 12 из 15",
    allowedHints: ["process_only", "content_cue"],
    retentionDays: 7,
    learnerConfirmed: true,
    createdAt: "2026-08-15T00:00:00.000Z",
    confirmedAt: "2026-08-15T00:01:00.000Z",
  });

  const contract = store.getGoalContract(contractId);
  assert.ok(contract);
  assert.equal(contract.contractId, contractId);
  assert.equal(contract.learnerId, "learner-1");
  assert.equal(contract.capability, "объяснять ключевые идеи комплексного анализа");
  assert.equal(contract.targetTask, "объяснить 15 концепций простым языком");
  assert.equal(contract.successCriteria, "корректно объясняет минимум 12 из 15");
  assert.deepEqual(contract.allowedHints, ["process_only", "content_cue"]);
  assert.equal(contract.retentionDays, 7);
  assert.equal(contract.learnerConfirmed, true);
  assert.equal(contract.confirmedAt, "2026-08-15T00:01:00.000Z");

  store.close();
});

test("getGoalContract returns undefined for unknown contract", () => {
  const store = new StudyStore(":memory:");
  const contract = store.getGoalContract("nonexistent");
  assert.equal(contract, undefined);
  store.close();
});