import assert from "node:assert/strict";
import test from "node:test";
import { canTransitionGap } from "../src/core/gaps.js";
import { deriveReadiness } from "../src/core/mastery.js";
import { evaluateTransition } from "../src/core/state-machine.js";


test("PRIME_L1 cannot advance without learner question or relation", () => {
  const result = evaluateTransition({ from: "PRIME_L1", to: "AIM", evidence: {} });
  assert.equal(result.allowed, false);
  assert.match(result.reasons.join(" "), /learner/i);
});

test("AIM advances with a concrete learner-owned backbone", () => {
  const result = evaluateTransition({
    from: "AIM",
    to: "SHOOT_ENCODE",
    evidence: { concreteBackbone: true },
  });
  assert.equal(result.allowed, true);
});

test("recognition or visible answer cannot become mastery", () => {
  const result = deriveReadiness("conceptual", {
    dimensions: { factualAccuracy: 3, freeGeneration: 3, relationalStructure: 3, transfer: 3 },
    criticalErrors: [],
    answerWasVisibleBeforeAttempt: true,
    delayed: true,
  });
  assert.equal(result.readiness, "insufficient");
});

test("conceptual evidence remains provisional before delayed or transfer evidence", () => {
  const result = deriveReadiness("conceptual", {
    dimensions: { factualAccuracy: 2, freeGeneration: 2, relationalStructure: 2 },
    criticalErrors: [],
    answerWasVisibleBeforeAttempt: false,
    delayed: false,
  });
  assert.equal(result.readiness, "provisional");
});

test("gap cannot close without an independent reattempt", () => {
  const result = canTransitionGap("remediating", "provisional_closed", {
    relevantRubricPassed: true,
  });
  assert.equal(result.allowed, false);
  assert.match(result.reasons.join(" "), /reattempt/i);
});

test("verified gap closure requires delayed or varied evidence", () => {
  const result = canTransitionGap("provisional_closed", "verified_closed", {});
  assert.equal(result.allowed, false);
});
