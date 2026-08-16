import assert from "node:assert/strict";
import test from "node:test";
import { evaluateCondition, type EvaluationContext } from "../src/core/policy/condition.js";
import { resolveConflict, type InterventionCandidate } from "../src/core/policy/conflict-resolver.js";
import { evaluatePolicies } from "../src/core/policy/engine.js";
import type { ConflictTraceEntry } from "../src/core/policy/conflict-resolver.js";
import { StudyStore } from "../src/db/store.js";

function context(input: {
  facts?: EvaluationContext["facts"];
  parameters?: EvaluationContext["parameters"];
  counts?: Record<string, number | undefined>;
} = {}): EvaluationContext {
  return {
    facts: input.facts ?? {},
    parameters: input.parameters ?? {},
    eventCount: ({ eventType }) => input.counts?.[eventType],
  };
}

const proceduralConsumption: import("../src/core/policy/condition.js").ConditionAST = {
  op: "all",
  args: [
    {
      op: "compare",
      left: { kind: "event_count", eventType: "procedural_source_unit" },
      cmp: "gte",
      right: { kind: "parameter", id: "procedural_units_before_attempt" },
    },
    {
      op: "compare",
      left: { kind: "event_count", eventType: "independent_attempt" },
      cmp: "eq",
      right: { kind: "literal", value: 0 },
    },
    {
      op: "compare",
      left: { kind: "fact", key: "safety_briefing" },
      cmp: "eq",
      right: { kind: "literal", value: false },
    },
  ],
};

test("ConditionAST matches procedural consumption from typed evidence", () => {
  const result = evaluateCondition(proceduralConsumption, context({
    parameters: { procedural_units_before_attempt: 3 },
    facts: { safety_briefing: false },
    counts: { procedural_source_unit: 4, independent_attempt: 0 },
  }));
  assert.equal(result.result, "matched");
  assert.equal(result.trace.children?.length, 3);
});

test("ConditionAST returns uncertain when observation coverage is unknown", () => {
  const result = evaluateCondition(proceduralConsumption, context({
    parameters: { procedural_units_before_attempt: 3 },
    facts: { safety_briefing: false },
    counts: { procedural_source_unit: undefined, independent_attempt: 0 },
  }));
  assert.equal(result.result, "uncertain");
  assert.match(JSON.stringify(result.trace), /coverage.*unknown/i);
});

test("three-valued logic does not let unknown override an observed contradiction", () => {
  const result = evaluateCondition(proceduralConsumption, context({
    parameters: {},
    facts: { safety_briefing: true },
    counts: { procedural_source_unit: undefined, independent_attempt: 0 },
  }));
  assert.equal(result.result, "not_matched");
});

function candidate(overrides: Partial<InterventionCandidate> & Pick<InterventionCandidate, "ruleId">): InterventionCandidate {
  return {
    ruleId: overrides.ruleId,
    detectionId: overrides.detectionId ?? `detection:${overrides.ruleId}`,
    interventionTemplateId: overrides.interventionTemplateId ?? `template:${overrides.ruleId}`,
    interventionTemplateVersion: overrides.interventionTemplateVersion ?? 1,
    interventionKind: overrides.interventionKind ?? "process_only",
    priority: overrides.priority ?? 0,
    severity: overrides.severity ?? 1,
    specificity: overrides.specificity ?? 1,
    evidenceStrength: overrides.evidenceStrength ?? 1,
    budgetCost: overrides.budgetCost ?? 1,
    hardSafetyRank: overrides.hardSafetyRank ?? 0,
    cooldownSatisfied: overrides.cooldownSatisfied ?? true,
    invariantSatisfied: overrides.invariantSatisfied ?? true,
    oscillationBlocked: overrides.oscillationBlocked ?? false,
    suppressesRuleIds: overrides.suppressesRuleIds ?? [],
    semanticEffects: overrides.semanticEffects ?? [overrides.ruleId],
  };
}

test("conflict resolver selects one deterministic primary intervention", () => {
  const resolution = resolveConflict([
    candidate({ ruleId: "missed_review", priority: 5 }),
    candidate({ ruleId: "missing_prerequisite", priority: 8 }),
    candidate({ ruleId: "high_load_break", hardSafetyRank: 1, priority: 1 }),
  ], { interventionBudget: 1 });

  assert.equal(resolution.selected?.ruleId, "high_load_break");
  assert.equal(resolution.trace.filter((entry) => entry.disposition === "selected").length, 1);
});

test("conflict resolver enforces invariants, cooldown, suppression, and semantic merging", () => {
  const resolution = resolveConflict([
    candidate({ ruleId: "unsafe_reveal", priority: 100, invariantSatisfied: false }),
    candidate({ ruleId: "cooldown_rule", priority: 90, cooldownSatisfied: false }),
    candidate({
      ruleId: "prerequisite",
      priority: 10,
      suppressesRuleIds: ["practice"],
      semanticEffects: ["diagnose_target"],
    }),
    candidate({ ruleId: "practice", priority: 5 }),
    candidate({ ruleId: "duplicate", priority: 4, semanticEffects: ["diagnose_target"] }),
  ], { interventionBudget: 1 });

  assert.equal(resolution.selected?.ruleId, "prerequisite");
  assert.equal(resolution.trace.some((entry) => entry.ruleId === "unsafe_reveal" && entry.disposition === "discarded"), true);
  assert.equal(resolution.trace.some((entry) => entry.ruleId === "practice" && entry.disposition === "suppressed"), true);
  assert.equal(resolution.trace.some((entry) => entry.ruleId === "duplicate" && entry.disposition === "merged"), true);
});

test("persisted policy evaluation records detections and one intervention", () => {
  const store = new StudyStore(":memory:");
  store.ensureUser("learner-1");
  const objectiveId = store.createObjective({
    userId: "learner-1",
    title: "Procedures",
    observableOutcome: "Perform procedure independently",
    targetTask: "Execute steps without aid",
    assessmentFormat: "oral execution",
    stakes: "normal",
    provenance: { kind: "PRODUCT_DECISION", sourceIds: [] },
  });
  const session = store.createSession("learner-1", objectiveId);
  store.transition({
    sessionId: session.id,
    expectedVersion: session.stateVersion,
    to: "BASELINE_PROBE",
    evidence: { objectiveExplicit: true },
    actor: "engine",
    provenance: { kind: "PRODUCT_DECISION", sourceIds: [] },
  });

  for (let i = 0; i < 4; i++) {
    store.appendEvent({
      userId: "learner-1",
      studySessionId: session.id,
      attemptBranchId: session.attemptBranchId,
      type: "procedural_source_unit",
      payload: { index: i },
      actor: "engine",
      provenance: { kind: "PRODUCT_DECISION", sourceIds: [] },
    });
  }

  const result = evaluatePolicies(store, {
    sessionId: session.id,
    facts: { safety_briefing: false },
  });
  assert.equal(result.bundle.bundleId, "core-default");
  assert.equal(result.bundle.bundleVersion, 2);
  assert.equal(result.detections.length, 3);
  assert.equal(result.detections.some((det) => det.policyId === "bp_procedural_consumption_without_attempt" && det.result === "matched"), true);
  assert.equal(result.detections.some((det) => det.policyId === "bp_missed_consolidation_window" && det.result === "uncertain"), true);
  assert.equal(result.detections.some((det) => det.policyId === "bp_passive_consumption_after_sensory" && det.result === "uncertain"), true);
  assert.ok(result.selectedIntervention);
  assert.equal(result.selectedIntervention!.templateId, "it_procedural_attempt");
  assert.equal(result.conflictTrace.some((entry) => entry.ruleId === "bp_procedural_consumption_without_attempt@1" && entry.disposition === "selected"), true);
  store.close();
});

test("uncertain procedural observation produces detection but no intervention", () => {
  const store = new StudyStore(":memory:");
  store.ensureUser("learner-2");
  const objectiveId = store.createObjective({
    userId: "learner-2",
    title: "Procedures",
    observableOutcome: "Perform procedure independently",
    targetTask: "Execute steps without aid",
    assessmentFormat: "oral execution",
    stakes: "normal",
    provenance: { kind: "PRODUCT_DECISION", sourceIds: [] },
  });
  const session = store.createSession("learner-2", objectiveId);

  const result = evaluatePolicies(store, {
    sessionId: session.id,
    facts: { safety_briefing: false },
  });

  assert.equal(result.detections.length, 3);
  assert.equal(result.detections.every((det) => det.result === "uncertain" || det.result === "not_matched"), true);
  assert.equal(result.detections.some((det) => det.policyId === "bp_missed_consolidation_window" && det.result === "uncertain"), true);
  assert.equal(result.detections.some((det) => det.policyId === "bp_procedural_consumption_without_attempt" && det.result === "not_matched"), true);
  assert.equal(result.detections.some((det) => det.policyId === "bp_passive_consumption_after_sensory" && det.result === "uncertain"), true);
  assert.equal(result.selectedIntervention, undefined);
  store.close();
});