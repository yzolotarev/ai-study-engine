import assert from "node:assert/strict";
import test from "node:test";
import { allowedTargets, evaluateTransition } from "../src/core/state-machine.js";
import { STUDY_STATES, type StudyState, type TransitionEvidence } from "../src/core/types.js";

const legacyGraphGolden: Record<StudyState, readonly StudyState[]> = {
  ONBOARD: ["OUTCOME", "PAUSED"],
  OUTCOME: ["BASELINE_PROBE", "PRIME_L1", "PAUSED"],
  BASELINE_PROBE: ["PRIME_L1", "GAP", "PAUSED"],
  PRIME_L1: ["AIM", "GAP", "BREAK", "PAUSED"],
  AIM: ["SHOOT_ENCODE", "GAP", "BREAK", "PAUSED"],
  SHOOT_ENCODE: ["SKIN", "REFERENCE", "GAP", "BREAK", "PAUSED"],
  SKIN: ["RETRIEVE", "SHOOT_ENCODE", "REFERENCE", "GAP", "BREAK", "PAUSED"],
  REFERENCE: ["SHOOT_ENCODE", "SKIN", "RETRIEVE", "PAUSED"],
  RETRIEVE: ["GAP", "INTERLEAVE", "DELAY", "META", "OVERLEARN", "COMPLETE", "PAUSED"],
  GAP: ["REMEDIATE", "SHOOT_ENCODE", "REFERENCE", "DELAY", "PAUSED"],
  REMEDIATE: ["RETRIEVE", "GAP", "BREAK", "PAUSED"],
  INTERLEAVE: ["GAP", "DELAY", "META", "OVERLEARN", "COMPLETE", "BREAK", "PAUSED"],
  DELAY: ["RETRIEVE", "PAUSED"],
  META: ["PRIME_L1", "AIM", "SHOOT_ENCODE", "RETRIEVE", "DELAY", "COMPLETE", "PAUSED"],
  BREAK: ["PRIME_L1", "AIM", "SHOOT_ENCODE", "SKIN", "RETRIEVE", "REMEDIATE", "PAUSED"],
  OVERLEARN: ["GAP", "DELAY", "COMPLETE", "BREAK", "PAUSED"],
  COMPLETE: ["RETRIEVE", "GAP", "PAUSED"],
  PAUSED: ["OUTCOME", "PRIME_L1", "AIM", "SHOOT_ENCODE", "SKIN", "RETRIEVE", "REMEDIATE", "DELAY"],
};

test("golden: legacy global state graph remains frozen during migration", () => {
  assert.deepEqual(
    Object.fromEntries(STUDY_STATES.map((state) => [state, [...allowedTargets(state)]])),
    legacyGraphGolden,
  );
});

test("golden: legacy conceptual happy path remains accepted", () => {
  const path: Array<[StudyState, StudyState, TransitionEvidence]> = [
    ["OUTCOME", "BASELINE_PROBE", { objectiveExplicit: true }],
    ["BASELINE_PROBE", "PRIME_L1", {}],
    ["PRIME_L1", "AIM", { learnerQuestionOrRelation: true }],
    ["AIM", "SHOOT_ENCODE", { concreteBackbone: true }],
    ["SHOOT_ENCODE", "SKIN", { learnerArtifact: true }],
    ["SKIN", "RETRIEVE", { learnerArtifact: true }],
    ["RETRIEVE", "INTERLEAVE", {}],
    ["INTERLEAVE", "COMPLETE", { independentAttempt: true, targetRubricPassed: true }],
  ];

  for (const [from, to, evidence] of path) {
    assert.deepEqual(evaluateTransition({ from, to, evidence }), { allowed: true, reasons: [] });
  }
});

test("golden: legacy boolean evidence weakness is captured before replacement", () => {
  const decision = evaluateTransition({
    from: "RETRIEVE",
    to: "COMPLETE",
    evidence: { independentAttempt: true, targetRubricPassed: true },
  });
  assert.equal(decision.allowed, true);
});
