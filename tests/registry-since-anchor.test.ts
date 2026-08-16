import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { StudyStore } from "../src/db/store.js";
import { compileRegistry } from "../src/core/policy/registry-compiler.js";
import { evaluateCondition, type ConditionAST, type EvaluationContext } from "../src/core/policy/condition.js";

const XML_PATH = fileURLToPath(new URL("../registry/studying-antipatterns.registry.xml", import.meta.url));
const XML = readFileSync(XML_PATH, "utf8");

function setup() {
  const store = new StudyStore(":memory:");
  store.ensureUser("learner");
  const objectiveId = store.createObjective({
    userId: "learner",
    title: "Sensory",
    observableOutcome: "Encode independently",
    targetTask: "Build the map without help",
    assessmentFormat: "written",
    stakes: "normal",
    provenance: { kind: "PRODUCT_DECISION", sourceIds: [] },
  });
  const session = store.createSession("learner", objectiveId);
  return { store, session };
}

function emit(store: StudyStore, session: ReturnType<typeof setup>["session"], type: string): void {
  store.appendEvent({
    userId: "learner",
    studySessionId: session.id,
    attemptBranchId: session.attemptBranchId,
    type,
    payload: { type },
    actor: "engine",
    provenance: { kind: "PRODUCT_DECISION", sourceIds: [] },
  });
}

/** Build an EvaluationContext whose eventCount delegates to the real store anchor logic. */
function storeBackedContext(
  store: StudyStore,
  session: ReturnType<typeof setup>["session"],
  facts: EvaluationContext["facts"],
  parameters: EvaluationContext["parameters"],
): EvaluationContext {
  return {
    facts,
    parameters,
    eventCount: ({ eventType, sinceAnchor, targetId }) => {
      if (sinceAnchor) {
        const anchorTs = store.findAnchorTimestamp(session.userId, session.id, sinceAnchor);
        if (anchorTs === null) return undefined;
        return store.countStudyEventsByTypeSince({ learnerId: session.userId, eventType, anchorTs, targetId: targetId ?? null });
      }
      return store.countStudyEventsByType({ learnerId: session.userId, eventType, targetId: targetId ?? null });
    },
  };
}

function passiveCondition(): ConditionAST {
  const compiled = compileRegistry(XML, { mode: "review" });
  const policy = compiled.policies.find((p) => p.policyId === "bp_passive_consumption_after_sensory");
  assert.ok(policy, "bp_passive_consumption_after_sensory must compile after sinceAnchor support");
  return policy!.condition as ConditionAST;
}

test("compiler: bp_passive_consumption_after_sensory compiles with anchored event_counts", () => {
  const cond = passiveCondition();
  assert.equal(cond.op, "all");
  const args = (cond as { args: ConditionAST[] }).args;
  assert.deepEqual(args[0], {
    op: "compare",
    left: { kind: "event_count", eventType: "sensory_input", sinceAnchor: "last_independent_attempt" },
    cmp: "gte",
    right: { kind: "parameter", id: "pol_sensory_threshold" },
  });
  assert.deepEqual(args[1], {
    op: "compare",
    left: { kind: "event_count", eventType: "independent_encoding", sinceAnchor: "last_sensory_input" },
    cmp: "eq",
    right: { kind: "literal", value: 0 },
  });
});

test("store: findAnchorTimestamp + countStudyEventsByTypeSince resolve anchored windows", async () => {
  const { store, session } = setup();
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  emit(store, session, "sensory_input"); await sleep(3); // pre-anchor (must be excluded)
  emit(store, session, "independent_attempt"); await sleep(3); // t0 (anchor)
  emit(store, session, "sensory_input"); await sleep(3);
  emit(store, session, "sensory_input"); await sleep(3);
  emit(store, session, "sensory_input");

  const indepAnchor = store.findAnchorTimestamp(session.userId, session.id, "last_independent_attempt");
  assert.ok(indepAnchor !== null, "anchor must be found");
  // >= anchor includes the anchor event itself; excludes the pre-anchor sensory_input.
  assert.equal(store.countStudyEventsByTypeSince({ learnerId: session.userId, eventType: "sensory_input", anchorTs: indepAnchor! }), 3);
  assert.equal(store.countStudyEventsByTypeSince({ learnerId: session.userId, eventType: "independent_attempt", anchorTs: indepAnchor! }), 1);

  const sensoryAnchor = store.findAnchorTimestamp(session.userId, session.id, "last_sensory_input");
  assert.ok(sensoryAnchor !== null && sensoryAnchor! > indepAnchor!);
  assert.equal(store.countStudyEventsByTypeSince({ learnerId: session.userId, eventType: "sensory_input", anchorTs: sensoryAnchor! }), 1); // anchor event itself (>=)
  assert.equal(store.countStudyEventsByTypeSince({ learnerId: session.userId, eventType: "independent_encoding", anchorTs: sensoryAnchor! }), 0); // none after last sensory
});

test("store: findAnchorTimestamp returns null when the anchor event is absent", () => {
  const { store, session } = setup();
  emit(store, session, "sensory_input");
  assert.equal(store.findAnchorTimestamp(session.userId, session.id, "last_independent_attempt"), null);
  // last_sensory_input IS present here
  assert.ok(store.findAnchorTimestamp(session.userId, session.id, "last_sensory_input") !== null);
});

test("evaluator: sensory-first then no encoding -> matched", () => {
  const { store, session } = setup();
  emit(store, session, "independent_attempt");
  emit(store, session, "sensory_input");
  emit(store, session, "sensory_input");
  emit(store, session, "sensory_input");
  const result = evaluateCondition(
    passiveCondition(),
    storeBackedContext(store, session, { minutes_since_last_sensory: 10 }, { pol_sensory_threshold: 3 }),
  );
  assert.equal(result.result, "matched");
});

test("evaluator: encoding after last sensory -> not_matched", () => {
  const { store, session } = setup();
  emit(store, session, "independent_attempt");
  emit(store, session, "sensory_input");
  emit(store, session, "sensory_input");
  emit(store, session, "sensory_input");
  emit(store, session, "independent_encoding"); // after the last sensory input
  const result = evaluateCondition(
    passiveCondition(),
    storeBackedContext(store, session, { minutes_since_last_sensory: 10 }, { pol_sensory_threshold: 3 }),
  );
  assert.equal(result.result, "not_matched");
});

test("evaluator: anchor event absent -> uncertain, never false", () => {
  const { store, session } = setup();
  emit(store, session, "sensory_input");
  emit(store, session, "sensory_input");
  emit(store, session, "sensory_input");
  const result = evaluateCondition(
    passiveCondition(),
    storeBackedContext(store, session, { minutes_since_last_sensory: 10 }, { pol_sensory_threshold: 3 }),
  );
  assert.equal(result.result, "uncertain");
});

// Literal readiness-criterion-2 scenarios: count independent_attempts SINCE the last
// sensory input. This exercises anchor resolution for `last_sensory_input` directly.
test("evaluator (spec 2a): sensory input, no independent_attempt after -> matched", () => {
  const { store, session } = setup();
  emit(store, session, "sensory_input");
  const cond: ConditionAST = {
    op: "compare",
    left: { kind: "event_count", eventType: "independent_attempt", sinceAnchor: "last_sensory_input" },
    cmp: "eq",
    right: { kind: "literal", value: 0 },
  };
  const r = evaluateCondition(cond, storeBackedContext(store, session, {}, {}));
  assert.equal(r.result, "matched");
});

test("evaluator (spec 2b): sensory input, independent_attempt after -> not_matched", () => {
  const { store, session } = setup();
  emit(store, session, "sensory_input");
  emit(store, session, "independent_attempt"); // emitted after the sensory input
  const cond: ConditionAST = {
    op: "compare",
    left: { kind: "event_count", eventType: "independent_attempt", sinceAnchor: "last_sensory_input" },
    cmp: "eq",
    right: { kind: "literal", value: 0 },
  };
  const r = evaluateCondition(cond, storeBackedContext(store, session, {}, {}));
  assert.equal(r.result, "not_matched");
});

test("backward compat: rolling-window event_count without sinceAnchor still works", () => {
  const { store, session } = setup();
  emit(store, session, "sensory_input");
  emit(store, session, "sensory_input");
  // no anchor -> plain count within windowMs
  const count = store.countStudyEventsByType({ learnerId: session.userId, eventType: "sensory_input", windowMs: 86_400_000 });
  assert.equal(count, 2);
  const cond: ConditionAST = {
    op: "compare",
    left: { kind: "event_count", eventType: "sensory_input", windowMs: 86_400_000 },
    cmp: "gte",
    right: { kind: "literal", value: 2 },
  };
  const r = evaluateCondition(cond, storeBackedContext(store, session, {}, {}));
  assert.equal(r.result, "matched");
});
