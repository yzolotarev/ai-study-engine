import type { ConditionAST } from "./condition.js";

export interface CoreInterventionTemplateSeed {
  id: string;
  version: number;
  name: string;
  kind: "process_only" | "content_cue" | "structure_reveal";
  content: Record<string, unknown>;
  provenance: { kind: string; sourceIds: string[] };
  status: "active" | "experimental" | "draft";
}

export interface CorePolicySeed {
  policyId: string;
  version: number;
  name: string;
  scope: Record<string, unknown>;
  condition: ConditionAST;
  exclusions: ConditionAST[];
  priority: number;
  severity: number;
  cooldownMs: number | null;
  interventionTemplateId: string;
  interventionTemplateVersion: number;
  provenance: { kind: string; sourceIds: string[]; note?: string };
  status: "active" | "experimental";
}

export interface CoreParameterSeed {
  parameterId: string;
  version: number;
  name: string;
  value: unknown;
  scope: Record<string, unknown>;
  provenance: { kind: string; sourceIds: string[]; note?: string };
  status: "active" | "experimental";
}

export const CORE_POLICY_BUNDLE = {
  id: "core-default",
  version: 2,
  name: "Core default policies",
} as const;

const PRODUCT = { kind: "PRODUCT_DECISION", sourceIds: [] };
const EXPERIMENTAL = { kind: "EXPERIMENTAL", sourceIds: [] };

export const CORE_INTERVENTION_TEMPLATES: readonly CoreInterventionTemplateSeed[] = [
  {
    id: "it_procedural_attempt",
    version: 1,
    name: "Attempt current procedure",
    kind: "process_only",
    content: {
      text: "Before the next procedural unit, perform one independent target-performance attempt. If practice is unavailable or unsafe, predict or simulate the steps and mark that evidence as weaker.",
    },
    provenance: PRODUCT,
    status: "active",
  },
  {
    id: "it_review_reschedule",
    version: 1,
    name: "Reschedule missed review",
    kind: "process_only",
    content: {
      text: "A review window for this target has ended without independent retrieval or application. Perform, reschedule, defer, or remove it — the choice stays with you.",
    },
    provenance: PRODUCT,
    status: "active",
  },
];

export const CORE_POLICIES: readonly CorePolicySeed[] = [
  {
    policyId: "bp_procedural_consumption_without_attempt",
    version: 1,
    name: "Procedural consumption without target attempt",
    scope: { protocols: ["procedural-performance"] },
    condition: {
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
    },
    exclusions: [],
    priority: 10,
    severity: 2,
    cooldownMs: 3_600_000,
    interventionTemplateId: "it_procedural_attempt",
    interventionTemplateVersion: 1,
    provenance: { ...PRODUCT, note: "From studying-antipatterns.registry.xml (bp_procedural_consumption_without_attempt)" },
    status: "experimental",
  },
  {
    policyId: "bp_passive_consumption_after_sensory",
    version: 1,
    name: "Passive consumption after sensory scaffold",
    scope: { phases: ["priming", "source_contact", "encoding"], sensory_subtypes: ["identify_key_terms", "familiarity_scaffold", "neighborhood_expansion"] },
    condition: {
      op: "all",
      args: [
        {
          op: "compare",
          left: { kind: "event_count", eventType: "sensory_input", sinceAnchor: "last_independent_attempt" },
          cmp: "gte",
          right: { kind: "parameter", id: "pol_sensory_threshold" },
        },
        {
          op: "compare",
          left: { kind: "event_count", eventType: "independent_encoding", sinceAnchor: "last_sensory_input" },
          cmp: "eq",
          right: { kind: "literal", value: 0 },
        },
        {
          op: "compare",
          left: { kind: "fact", key: "minutes_since_last_sensory" },
          cmp: "gte",
          right: { kind: "literal", value: 5 },
        },
      ],
    },
    exclusions: [],
    priority: 90,
    severity: 1,
    cooldownMs: null,
    interventionTemplateId: "it_procedural_attempt",
    interventionTemplateVersion: 1,
    provenance: {
      kind: "PRODUCT_DECISION",
      sourceIds: ["sung_y14", "sung_y05"],
      note: "Compiled from studying-antipatterns.registry.xml (bp_passive_consumption_after_sensory) via registry-compiler review mode. Experimental — requires human activation. Intervention template remapped to it_procedural_attempt (i_force_encoding not shipped in core bundle).",
    },
    status: "experimental",
  },
  {
    policyId: "bp_missed_consolidation_window",
    version: 1,
    name: "Missed consolidation window",
    scope: { phases: ["consolidation", "delayed_retrieval"] },
    condition: {
      op: "all",
      args: [
        {
          op: "compare",
          left: { kind: "fact", key: "review_due" },
          cmp: "eq",
          right: { kind: "literal", value: true },
        },
        {
          op: "compare",
          left: { kind: "event_count", eventType: "qualifying_evidence" },
          cmp: "eq",
          right: { kind: "literal", value: 0 },
        },
        {
          op: "compare",
          left: { kind: "fact", key: "explicit_deferral" },
          cmp: "eq",
          right: { kind: "literal", value: false },
        },
      ],
    },
    exclusions: [],
    priority: 8,
    severity: 1,
    cooldownMs: 86_400_000,
    interventionTemplateId: "it_review_reschedule",
    interventionTemplateVersion: 1,
    provenance: { ...PRODUCT, note: "From studying-antipatterns.registry.xml (bp_missed_consolidation_window)" },
    status: "experimental",
  },
];

export const CORE_PARAMETERS: readonly CoreParameterSeed[] = [
  {
    parameterId: "procedural_units_before_attempt",
    version: 1,
    name: "Procedural source units before a target attempt",
    value: 3,
    scope: { protocols: ["procedural-performance"] },
    provenance: { ...EXPERIMENTAL, note: "Experimental default; adapt from load and error evidence." },
    status: "experimental",
  },
  {
    parameterId: "pol_sensory_threshold",
    version: 1,
    name: "Sensory inputs before passive-consumption detection",
    value: 3,
    scope: {},
    provenance: { ...EXPERIMENTAL, note: "Compiled from studying-antipatterns.registry.xml (pol_sensory_threshold). Experimental default." },
    status: "experimental",
  },
  {
    parameterId: "consolidation_delay_days",
    version: 1,
    name: "Default consolidation delay",
    value: 7,
    scope: { phases: ["consolidation"] },
    provenance: { ...EXPERIMENTAL, note: "Weekly window is an experimental default, not a universal law." },
    status: "experimental",
  },
];
