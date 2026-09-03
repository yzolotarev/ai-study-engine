import { sha256Hex, stableStringify } from "./hash.js";
import type {
  CheckpointPhase,
  JsonValue,
  PolicyRuntimeHelpLevel,
  PolicyRuntimeSpec,
  PolicyVariant,
} from "./types.js";

export type PolicyCriterionStatus = "met" | "unmet" | "unknown";

export type PolicyRuntimeIntent =
  | "orientation"
  | "minimal_remediation"
  | "clean_retry"
  | "transfer"
  | "delayed_retrieval"
  | "pause"
  | "stop"
  | "completion_check";

export type PolicyRuntimeReasonCode =
  | "pretest-gap"
  | "immediate-gap"
  | "clean-retry-required"
  | "pretest-ready-transfer"
  | "retrieval-ready-transfer"
  | "transfer-ready-delayed"
  | "delayed-retrieval-ready"
  | "delayed-not-due"
  | "protocol-violation"
  | "completion-check"
  | "unsupported-transition";

export interface PolicyRuntimeInput {
  /** Current evidence phase; hidden task material is intentionally absent. */
  readonly phase: CheckpointPhase;
  /** Immutable rubric projection, not a learner answer or reference answer. */
  readonly criteria: Readonly<Record<string, PolicyCriterionStatus>>;
  readonly attemptContaminated: boolean;
  readonly helpExposureCount: number;
  readonly cleanAttemptAvailable: boolean;
  readonly sessionElapsedMs: number;
  readonly sessionBudgetMs: number;
  readonly delayedDue: boolean;
  readonly protocolViolations?: readonly string[];
  readonly requiredTransfer?: boolean;
  readonly requiredDelayed?: boolean;
}

export interface PolicyRuntimeAction {
  readonly intent: PolicyRuntimeIntent;
  /** The phase the operator should move to or continue in. */
  readonly targetPhase: CheckpointPhase;
  readonly gapId?: string;
  readonly helpLevel?: PolicyRuntimeHelpLevel;
  readonly maxDurationMs?: number;
  readonly reasonCode: PolicyRuntimeReasonCode;
}

export interface PolicyRuntimeTrace {
  readonly traceSchemaVersion: 1;
  readonly policyId: string;
  readonly policyVersion: number;
  readonly currentPhase: CheckpointPhase;
  readonly inputFingerprint: string;
  readonly action: PolicyRuntimeAction;
  readonly violations: readonly string[];
  readonly traceFingerprint: string;
}

export type ExecutablePolicyVariant = PolicyVariant & {
  readonly runtimeSpec: PolicyRuntimeSpec;
};

export class PolicyRuntimeError extends Error {
  readonly code: "INVALID_POLICY" | "INVALID_STATE";

  constructor(code: "INVALID_POLICY" | "INVALID_STATE", message: string) {
    super(`${code}: ${message}`);
    this.name = "PolicyRuntimeError";
    this.code = code;
  }
}

const phases: readonly CheckpointPhase[] = ["pretest", "immediate", "transfer", "delayed"];
const intents: readonly PolicyRuntimeIntent[] = [
  "orientation",
  "minimal_remediation",
  "clean_retry",
  "transfer",
  "delayed_retrieval",
  "pause",
  "stop",
  "completion_check",
];
const helpLevels: readonly PolicyRuntimeHelpLevel[] = ["process_prompt", "minimal_hint"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPhase(value: unknown): value is CheckpointPhase {
  return typeof value === "string" && phases.includes(value as CheckpointPhase);
}

function isIntent(value: unknown): value is PolicyRuntimeIntent {
  return typeof value === "string" && intents.includes(value as PolicyRuntimeIntent);
}

function isHelpLevel(value: unknown): value is PolicyRuntimeHelpLevel {
  return typeof value === "string" && helpLevels.includes(value as PolicyRuntimeHelpLevel);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function finiteNonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function failPolicy(message: string): never {
  throw new PolicyRuntimeError("INVALID_POLICY", message);
}

function failState(message: string): never {
  throw new PolicyRuntimeError("INVALID_STATE", message);
}

function validateRuntimeSpec(spec: unknown): asserts spec is PolicyRuntimeSpec {
  if (!isRecord(spec) || spec.schemaVersion !== 1) failPolicy("runtimeSpec.schemaVersion must be 1");
  if (spec.readyRule !== "all-required-criteria-met") failPolicy("unsupported readiness rule");
  if (spec.gapSelection !== "first-unmet-or-unknown") failPolicy("unsupported gap selection rule");
  if (spec.supportMode !== "minimal-gap-cue" && spec.supportMode !== "structured-orientation") {
    failPolicy("unsupported support mode");
  }
  if (spec.gapIntent !== "minimal_remediation" && spec.gapIntent !== "orientation") {
    failPolicy("gapIntent must be minimal_remediation or orientation");
  }
  if (!isRecord(spec.interventionBudget)
      || !finiteNonNegativeInt(spec.interventionBudget.maxDurationMs)
      || spec.interventionBudget.maxDurationMs === 0
      || !isHelpLevel(spec.interventionBudget.maxHelpLevel)) {
    failPolicy("interventionBudget must contain a positive maxDurationMs and a supported maxHelpLevel");
  }
  if (!isRecord(spec.requiredSequence)
      || typeof spec.requiredSequence.transferAfterCleanPretest !== "boolean"
      || typeof spec.requiredSequence.delayedAfterTransfer !== "boolean") {
    failPolicy("requiredSequence is invalid");
  }
  if (spec.disclosurePolicy !== "assessment-isolated") failPolicy("unsupported disclosure policy");
  if (spec.fallback !== "stop") failPolicy("fallback must be stop");
}

function validatePolicy(policy: unknown): asserts policy is ExecutablePolicyVariant {
  if (!isRecord(policy) || !nonEmpty(policy.policyId) || !finiteNonNegativeInt(policy.policyVersion)) {
    failPolicy("policyId and non-negative integer policyVersion are required");
  }
  if (!Array.isArray(policy.allowedPhases) || policy.allowedPhases.length === 0 || policy.allowedPhases.some((phase) => !isPhase(phase))) {
    failPolicy("allowedPhases must be a non-empty list of evaluation phases");
  }
  if (!Array.isArray(policy.allowedIntents) || policy.allowedIntents.length === 0 || policy.allowedIntents.some((intent) => !isIntent(intent))) {
    failPolicy("allowedIntents must contain only executable policy intents");
  }
  validateRuntimeSpec(policy.runtimeSpec);
  if (!policy.allowedIntents.includes("stop") || !policy.allowedIntents.includes("pause")) {
    failPolicy("allowedIntents must include fail-closed stop and pause");
  }
  if (!policy.allowedPhases.includes("pretest") || !policy.allowedPhases.includes("immediate") || !policy.allowedPhases.includes("transfer") || !policy.allowedPhases.includes("delayed")) {
    failPolicy("executable policy must declare all checkpoint phases");
  }
  const requiredIntent = policy.runtimeSpec.gapIntent;
  if (!policy.allowedIntents.includes(requiredIntent)) failPolicy(`allowedIntents omits runtime gap intent ${requiredIntent}`);
  for (const required of ["clean_retry", "transfer", "delayed_retrieval", "completion_check"] as const) {
    if (!policy.allowedIntents.includes(required)) failPolicy(`allowedIntents omits runtime intent ${required}`);
  }
}

function validateInput(input: unknown): asserts input is PolicyRuntimeInput {
  if (!isRecord(input) || !isPhase(input.phase)) failState("phase must be a supported checkpoint phase");
  if (!isRecord(input.criteria) || Object.keys(input.criteria).length === 0) failState("criteria must be a non-empty record");
  for (const [criterionId, status] of Object.entries(input.criteria)) {
    if (!nonEmpty(criterionId) || (status !== "met" && status !== "unmet" && status !== "unknown")) {
      failState("criteria must map non-empty ids to met, unmet, or unknown");
    }
  }
  if (typeof input.attemptContaminated !== "boolean" || typeof input.cleanAttemptAvailable !== "boolean") {
    failState("attempt contamination and clean attempt availability must be boolean");
  }
  if (!finiteNonNegativeInt(input.helpExposureCount)) failState("helpExposureCount must be a non-negative integer");
  if (!finiteNonNegativeInt(input.sessionElapsedMs) || !finiteNonNegativeInt(input.sessionBudgetMs) || input.sessionBudgetMs === 0) {
    failState("session time values must be non-negative integers and budget must be positive");
  }
  if (input.sessionElapsedMs > input.sessionBudgetMs) failState("sessionElapsedMs cannot exceed sessionBudgetMs");
  if (typeof input.delayedDue !== "boolean") failState("delayedDue must be boolean");
  if (input.protocolViolations !== undefined && (!Array.isArray(input.protocolViolations) || input.protocolViolations.some((item) => !nonEmpty(item)))) {
    failState("protocolViolations must be non-empty strings");
  }
  if (input.requiredTransfer !== undefined && typeof input.requiredTransfer !== "boolean") failState("requiredTransfer must be boolean");
  if (input.requiredDelayed !== undefined && typeof input.requiredDelayed !== "boolean") failState("requiredDelayed must be boolean");
}

function firstGap(criteria: Readonly<Record<string, PolicyCriterionStatus>>): string | undefined {
  return Object.entries(criteria).find(([, status]) => status !== "met")?.[0];
}

function allMet(criteria: Readonly<Record<string, PolicyCriterionStatus>>): boolean {
  return Object.values(criteria).every((status) => status === "met");
}

function makeAction(policy: ExecutablePolicyVariant, action: PolicyRuntimeAction): PolicyRuntimeAction {
  if (!policy.allowedPhases.includes(action.targetPhase)) {
    return {
      intent: "stop",
      targetPhase: action.targetPhase,
      reasonCode: "unsupported-transition",
    };
  }
  if (!policy.allowedIntents.includes(action.intent)) {
    return {
      intent: "stop",
      targetPhase: action.targetPhase,
      reasonCode: "unsupported-transition",
    };
  }
  return action;
}

function decide(policy: ExecutablePolicyVariant, input: PolicyRuntimeInput): { readonly action: PolicyRuntimeAction; readonly violations: readonly string[] } {
  const violations = [...(input.protocolViolations ?? [])];
  if (violations.length > 0) {
    return {
      action: makeAction(policy, { intent: "stop", targetPhase: input.phase, reasonCode: "protocol-violation" }),
      violations,
    };
  }

  if (input.attemptContaminated) {
    return {
      action: makeAction(policy, {
        intent: "clean_retry",
        targetPhase: input.phase,
        reasonCode: "clean-retry-required",
      }),
      violations,
    };
  }

  if (input.phase === "delayed") {
    if (!input.delayedDue) {
      return {
        action: makeAction(policy, { intent: "stop", targetPhase: "delayed", reasonCode: "delayed-not-due" }),
        violations,
      };
    }
    return {
      action: makeAction(policy, { intent: "delayed_retrieval", targetPhase: "delayed", reasonCode: "delayed-retrieval-ready" }),
      violations,
    };
  }

  const ready = allMet(input.criteria);
  if (!ready) {
    const gapId = firstGap(input.criteria);
    if (!gapId) {
      return {
        action: makeAction(policy, { intent: "stop", targetPhase: input.phase, reasonCode: "unsupported-transition" }),
        violations,
      };
    }
    return {
      action: makeAction(policy, {
        intent: policy.runtimeSpec.gapIntent,
        targetPhase: input.phase,
        gapId,
        helpLevel: policy.runtimeSpec.interventionBudget.maxHelpLevel,
        maxDurationMs: Math.min(policy.runtimeSpec.interventionBudget.maxDurationMs, input.sessionBudgetMs - input.sessionElapsedMs),
        reasonCode: input.phase === "pretest" ? "pretest-gap" : "immediate-gap",
      }),
      violations,
    };
  }

  const requiredTransfer = input.requiredTransfer ?? policy.runtimeSpec.requiredSequence.transferAfterCleanPretest;
  const requiredDelayed = input.requiredDelayed ?? policy.runtimeSpec.requiredSequence.delayedAfterTransfer;
  if (input.phase === "pretest" && requiredTransfer) {
    return {
      action: makeAction(policy, { intent: "transfer", targetPhase: "transfer", reasonCode: "pretest-ready-transfer" }),
      violations,
    };
  }
  if (input.phase === "immediate" && requiredTransfer) {
    return {
      action: makeAction(policy, { intent: "transfer", targetPhase: "transfer", reasonCode: "retrieval-ready-transfer" }),
      violations,
    };
  }
  if (input.phase === "transfer" && requiredDelayed) {
    if (!input.delayedDue) {
      return {
        action: makeAction(policy, { intent: "pause", targetPhase: "delayed", reasonCode: "delayed-not-due" }),
        violations,
      };
    }
    return {
      action: makeAction(policy, { intent: "delayed_retrieval", targetPhase: "delayed", reasonCode: "transfer-ready-delayed" }),
      violations,
    };
  }
  return {
    action: makeAction(policy, { intent: "completion_check", targetPhase: input.phase, reasonCode: "completion-check" }),
    violations,
  };
}

/**
 * Validate and execute one deterministic policy decision.  The returned trace
 * contains only phase/evidence state and action metadata; no task prompt,
 * answer key, learner artifact, or scorer guidance is accepted by this API.
 */
export function executePolicy(policy: unknown, input: unknown): PolicyRuntimeTrace {
  validatePolicy(policy);
  validateInput(input);
  const typedPolicy = policy as ExecutablePolicyVariant;
  const typedInput = input as PolicyRuntimeInput;
  const inputFingerprint = sha256Hex(stableStringify(typedInput as unknown as JsonValue));
  const decision = decide(typedPolicy, typedInput);
  const traceWithoutFingerprint = {
    traceSchemaVersion: 1 as const,
    policyId: typedPolicy.policyId,
    policyVersion: typedPolicy.policyVersion,
    currentPhase: typedInput.phase,
    inputFingerprint,
    action: decision.action,
    violations: decision.violations,
  };
  const traceFingerprint = sha256Hex(stableStringify(traceWithoutFingerprint as unknown as JsonValue));
  return { ...traceWithoutFingerprint, traceFingerprint };
}

/** Alias with a noun-like name for callers that treat the runtime as a value object. */
export const runPolicy = executePolicy;
