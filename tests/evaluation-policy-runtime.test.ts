import assert from "node:assert/strict";
import test from "node:test";
import {
  createSyntheticBenchmarkMatrix,
  executePolicy,
  PolicyRuntimeError,
  type ExecutablePolicyVariant,
  type PolicyRuntimeInput,
  type PolicyRuntimeSpec,
} from "../src/evaluation/index.js";

const now = "2026-01-01T00:00:00.000Z";

function policy(policyId: string, mode: "minimal-gap-cue" | "structured-orientation", gapIntent: "minimal_remediation" | "orientation", maxHelpLevel: "process_prompt" | "minimal_hint"): ExecutablePolicyVariant {
  const runtimeSpec: PolicyRuntimeSpec = {
    schemaVersion: 1,
    readyRule: "all-required-criteria-met",
    gapSelection: "first-unmet-or-unknown",
    supportMode: mode,
    gapIntent,
    interventionBudget: {
      maxDurationMs: mode === "minimal-gap-cue" ? 60_000 : 120_000,
      maxHelpLevel,
    },
    requiredSequence: {
      transferAfterCleanPretest: true,
      delayedAfterTransfer: true,
    },
    disclosurePolicy: "assessment-isolated",
    fallback: "stop",
  };
  return {
    policyId,
    policyVersion: 0,
    description: `${policyId} executable test policy`,
    deterministicConfig: { label: policyId },
    allowedPhases: ["pretest", "immediate", "transfer", "delayed"],
    allowedIntents: ["orientation", "minimal_remediation", "clean_retry", "transfer", "delayed_retrieval", "pause", "stop", "completion_check"],
    featureFlags: [mode],
    runtimeSpec,
    createdAt: now,
    updatedAt: now,
  };
}

const gapState: PolicyRuntimeInput = {
  phase: "pretest",
  criteria: { first: "unmet", second: "met" },
  attemptContaminated: false,
  helpExposureCount: 0,
  cleanAttemptAvailable: true,
  sessionElapsedMs: 15_000,
  sessionBudgetMs: 600_000,
  delayedDue: false,
};

test("alpha and beta execute different typed actions for the same evidence state", () => {
  const alpha = executePolicy(policy("policy-alpha", "minimal-gap-cue", "minimal_remediation", "process_prompt"), gapState);
  const beta = executePolicy(policy("policy-beta", "structured-orientation", "orientation", "minimal_hint"), gapState);

  assert.equal(alpha.action.intent, "minimal_remediation");
  assert.equal(alpha.action.helpLevel, "process_prompt");
  assert.equal(beta.action.intent, "orientation");
  assert.equal(beta.action.helpLevel, "minimal_hint");
  assert.equal(alpha.action.gapId, beta.action.gapId);
  assert.notEqual(alpha.traceFingerprint, beta.traceFingerprint);
  assert.equal(alpha.violations.length, 0);
});

test("a clean pretest never consumes unnecessary orientation and moves to materially distinct transfer", () => {
  const trace = executePolicy(policy("policy-alpha", "minimal-gap-cue", "minimal_remediation", "process_prompt"), {
    ...gapState,
    criteria: { first: "met", second: "met" },
  });
  assert.deepEqual(trace.action, {
    intent: "transfer",
    targetPhase: "transfer",
    reasonCode: "pretest-ready-transfer",
  });
});

test("contaminated attempts require an independent clean retry", () => {
  const trace = executePolicy(policy("policy-beta", "structured-orientation", "orientation", "minimal_hint"), {
    ...gapState,
    attemptContaminated: true,
  });
  assert.deepEqual(trace.action, {
    intent: "clean_retry",
    targetPhase: "pretest",
    reasonCode: "clean-retry-required",
  });
});

test("delayed retrieval fails closed before the retention interval", () => {
  const trace = executePolicy(policy("policy-alpha", "minimal-gap-cue", "minimal_remediation", "process_prompt"), {
    ...gapState,
    phase: "delayed",
    criteria: { first: "met" },
    delayedDue: false,
  });
  assert.equal(trace.action.intent, "stop");
  assert.equal(trace.action.reasonCode, "delayed-not-due");
});

test("protocol violations produce a stop trace rather than a helpful action", () => {
  const trace = executePolicy(policy("policy-beta", "structured-orientation", "orientation", "minimal_hint"), {
    ...gapState,
    protocolViolations: ["assessment prompt exposed"],
  });
  assert.equal(trace.action.intent, "stop");
  assert.equal(trace.action.reasonCode, "protocol-violation");
  assert.deepEqual(trace.violations, ["assessment prompt exposed"]);
});

test("missing runtime spec and invalid policy declarations fail closed", () => {
  const withoutSpec = { ...policy("policy-alpha", "minimal-gap-cue", "minimal_remediation", "process_prompt") } as Record<string, unknown>;
  delete withoutSpec.runtimeSpec;
  assert.throws(
    () => executePolicy(withoutSpec, gapState),
    (error: unknown) => error instanceof PolicyRuntimeError && error.code === "INVALID_POLICY" && /runtimeSpec/.test(error.message),
  );

  const invalidIntents = policy("policy-alpha", "minimal-gap-cue", "minimal_remediation", "process_prompt");
  (invalidIntents as any).allowedIntents = ["study"];
  assert.throws(
    () => executePolicy(invalidIntents, gapState),
    (error: unknown) => error instanceof PolicyRuntimeError && error.code === "INVALID_POLICY",
  );
});

test("malformed evidence state is rejected instead of becoming an implicit gap", () => {
  assert.throws(
    () => executePolicy(policy("policy-alpha", "minimal-gap-cue", "minimal_remediation", "process_prompt"), { ...gapState, criteria: {} }),
    (error: unknown) => error instanceof PolicyRuntimeError && error.code === "INVALID_STATE",
  );
  assert.throws(
    () => executePolicy(policy("policy-alpha", "minimal-gap-cue", "minimal_remediation", "process_prompt"), { ...gapState, sessionElapsedMs: 700_000 }),
    (error: unknown) => error instanceof PolicyRuntimeError && error.code === "INVALID_STATE",
  );
});

test("synthetic benchmark matrix is complete, deterministic, and provenance-labelled", () => {
  const first = createSyntheticBenchmarkMatrix();
  const second = createSyntheticBenchmarkMatrix();
  assert.equal(first.length, 64);
  assert.deepEqual(first, second);
  assert.equal(new Set(first.map((cell) => `${cell.policyId}|${cell.readiness}|${cell.seed}|${cell.helpMode}`)).size, 64);
  assert.equal(first.every((cell) => cell.trialSubjectKind === "synthetic"), true);
});
