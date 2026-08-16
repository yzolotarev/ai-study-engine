import assert from "node:assert/strict";
import test from "node:test";
import { decideHelp } from "../src/core/help-controller.js";

const base = {
  currentLevel: 0 as const,
  materiallyDistinctFailedAttempts: 0,
  degradationSignals: 0,
  explicitAnswerRequest: false,
  explicitSurrender: false,
  blockingPrerequisite: false,
};

test("retrieval requests an attempt before help", () => {
  const result = decideHelp({ ...base, mode: "retrieval" });
  assert.equal(result.level, 0);
  assert.equal(result.contaminateAttempt, false);
});

test("familiarity permits a concise direct scaffold", () => {
  const result = decideHelp({ ...base, mode: "familiarity" });
  assert.equal(result.level, 3);
  assert.equal(result.action, "one_fact");
});

test("explicit answer request gives answer but contaminates retrieval", () => {
  const result = decideHelp({ ...base, mode: "retrieval", explicitAnswerRequest: true });
  assert.equal(result.level, 5);
  assert.equal(result.contaminateAttempt, true);
  assert.deepEqual(result.requiredFollowUps, [
    "paraphrase",
    "explain_relation",
    "analogous_task",
    "delayed_retrieval",
  ]);
});

test("blocking prerequisite triggers a teaching reset", () => {
  const result = decideHelp({ ...base, mode: "encoding", blockingPrerequisite: true });
  assert.equal(result.level, 6);
  assert.equal(result.action, "teaching_reset");
});
