import assert from "node:assert/strict";
import test from "node:test";
import {
  canCloseGap,
  extractObservationIds,
  isAttemptContaminated,
  isAttemptIndependent,
  literalsOnly,
  summarizeContamination,
  type OwnershipStatus,
  type Readiness,
} from "../src/core/evidence-ledger.js";

test("isAttemptIndependent: false when answer was visible, true otherwise", () => {
  assert.equal(isAttemptIndependent({ answerVisible: true }), false);
  assert.equal(isAttemptIndependent({ answerVisible: false, attemptIndependent: true }), true);
  assert.equal(isAttemptIndependent({ answerVisible: false }), true);
});

test("isAttemptContaminated: answer visibility or help beyond scaffolding", () => {
  assert.equal(isAttemptContaminated({ answerVisible: true }), true);
  assert.equal(isAttemptContaminated({ answerVisible: false, helpLevel: "structure_reveal" }), true);
  assert.equal(isAttemptContaminated({ answerVisible: false, helpLevel: "direct_answer" }), true);
  assert.equal(isAttemptContaminated({ answerVisible: false, helpLevel: "none" }), false);
  assert.equal(isAttemptContaminated({ answerVisible: false, helpLevel: "process_only" }), false);
});

test("canCloseGap: only stable + verified_owned learner evidence", () => {
  const cases: Array<[Readiness, OwnershipStatus, boolean]> = [
    ["stable", "verified_owned", true],
    ["stable", "provisional_owned", false],
    ["provisional", "verified_owned", false],
    ["insufficient", "unverified", false],
  ];
  for (const [readiness, ownership, expected] of cases) {
    assert.equal(canCloseGap(readiness, ownership), expected, `${readiness}/${ownership}`);
  }
});

test("extractObservationIds collects literal observation ids from transcription groups", () => {
  const transcription = {
    texts: [{ id: "t1" }, { id: "t2" }],
    objects: [{ id: "o1" }],
    visual_marks: [{ id: "m1" }],
    visible_symbols: [{ id: "s1" }],
  };
  const ids = extractObservationIds(transcription);
  assert.deepEqual([...ids].sort(), ["m1", "o1", "s1", "t1", "t2"]);
});

test("literalsOnly: learner can only confirm existing literal observations", () => {
  const valid = new Set(["t1", "o1", "m1"]);
  const result = literalsOnly(["t1", "ghost", "o1"], valid);
  assert.deepEqual(result.valid, ["t1", "o1"]);
  assert.deepEqual(result.unknown, ["ghost"]);
});

test("summarizeContamination counts only contaminated help levels", () => {
  const summary = summarizeContamination([
    { helpLevel: "none", scope: "target" },
    { helpLevel: "structure_reveal", scope: "relation" },
    { helpLevel: "direct_answer", scope: "group" },
  ]);
  assert.equal(summary.contaminatedCount, 2);
  assert.deepEqual(summary.scopes, ["relation", "group"]);
});
