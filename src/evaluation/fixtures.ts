import type { EvaluationProtocol, PolicyVariant, StudyPack, SyntheticHelpMode, SyntheticMatrixCell, SyntheticReadiness } from "./types.js";

const createdAt = "2026-01-01T00:00:00.000Z";

function variant(policyId: string, policyVersion: number, description: string, featureFlags: readonly string[]): PolicyVariant {
  return {
    policyId,
    policyVersion,
    description,
    deterministicConfig: {
      helpBudgetMinutes: 1,
      sessionBudgetMinutes: 10,
      label: policyId,
    },
    allowedPhases: ["pretest", "immediate", "transfer", "delayed"],
    allowedIntents: ["orientation", "minimal_remediation", "clean_retry", "transfer", "delayed_retrieval", "pause", "stop", "completion_check"],
    featureFlags,
    runtimeSpec: {
      schemaVersion: 1,
      readyRule: "all-required-criteria-met",
      gapSelection: "first-unmet-or-unknown",
      supportMode: featureFlags.includes("structured-cue") ? "structured-orientation" : "minimal-gap-cue",
      gapIntent: featureFlags.includes("structured-cue") ? "orientation" : "minimal_remediation",
      interventionBudget: {
        maxDurationMs: featureFlags.includes("structured-cue") ? 120_000 : 60_000,
        maxHelpLevel: featureFlags.includes("structured-cue") ? "minimal_hint" : "process_prompt",
      },
      requiredSequence: { transferAfterCleanPretest: true, delayedAfterTransfer: true },
      disclosurePolicy: "assessment-isolated",
      fallback: "stop",
    },
    createdAt,
    updatedAt: createdAt,
  };
}

export function createSyntheticEvaluationFixture(): { readonly protocol: EvaluationProtocol; readonly pack: StudyPack; readonly participantId: string; readonly seed: string } {
  const protocol: EvaluationProtocol = {
    protocolId: "synthetic-learning-eval-protocol-v0",
    version: 0,
    title: "Synthetic Learning Evaluation Layer v0",
    domain: "synthetic-general",
    hypothesis: "Variant assignment, blind scoring, and delayed checkpoints can be replayed locally without touching the mastery kernel.",
    primaryOutcome: "criterion gain on blind-scored delayed outcome",
    secondaryOutcomes: ["immediate performance", "transfer performance", "session friction", "evidence validity"],
    retentionDelayDays: 1,
    sessionTimeBudgetMinutes: 10,
    policyVariants: [
      variant("policy-alpha", 0, "minimal prompt + brief cue policy", ["minimal-cue"]),
      variant("policy-beta", 0, "structured prompt + worked example policy", ["structured-cue"]),
    ],
    topicAssignmentRules: {
      method: "seeded-rotation",
      counterbalance: "paired-rotation",
      lockStartedTrials: true,
    },
    allowedArtifactTypes: ["text", "canvas"],
    scorerRequirements: {
      requireBlindScoring: true,
      allowedScorers: ["trusted-human", "deterministic", "ai-semantic"],
      rubricVersion: "rubric-synthetic-v0",
    },
    createdAt,
    updatedAt: createdAt,
    metadata: {
      schemaVersion: 1,
      createdBy: "synthetic-fixture",
      sourceHash: "sha256-synthetic-protocol",
      notes: "Explicitly synthetic fixture for tests and docs only.",
    },
  };

  const rubric = [
    { id: "idea", description: "Names the core synthetic idea" },
    { id: "reason", description: "Gives a reason or mechanism" },
    { id: "transfer", description: "Applies the idea to a changed case" },
  ] as const;

  const pack: StudyPack = {
    packId: "synthetic-study-pack-v0",
    version: 0,
    domain: "synthetic-general",
    sourceReferences: ["sha256-pack-source-a", "sha256-pack-source-b"],
    matchedSets: [
      {
        matchedSetId: "matched-set-a",
        description: "Synthetic matched set A",
        microtopicIds: ["microtopic-a1", "microtopic-a2"],
        equivalenceMetadata: {
          rationale: "Paired on the same synthetic concept with a changed surface cue.",
          sourceHashes: ["sha256-topic-a1", "sha256-topic-a2"],
          matchingDimensions: ["same-idea", "same-rubric", "different-surface-form"],
        },
      },
      {
        matchedSetId: "matched-set-b",
        description: "Synthetic matched set B",
        microtopicIds: ["microtopic-b1", "microtopic-b2"],
        equivalenceMetadata: {
          rationale: "Paired on a second synthetic concept with an equivalent rubric.",
          sourceHashes: ["sha256-topic-b1", "sha256-topic-b2"],
          matchingDimensions: ["same-idea", "same-rubric", "different-surface-form"],
        },
      },
    ],
    microtopics: [
      {
        microtopicId: "microtopic-a1",
        title: "Synthetic topic A1",
        goalContract: "The learner explains the synthetic idea, gives a reason, and transfers it to a changed case.",
        rubric,
      },
      {
        microtopicId: "microtopic-a2",
        title: "Synthetic topic A2",
        goalContract: "The learner explains the same synthetic idea under a different cue.",
        rubric,
      },
      {
        microtopicId: "microtopic-b1",
        title: "Synthetic topic B1",
        goalContract: "The learner explains a second synthetic idea, gives a reason, and transfers it.",
        rubric,
      },
      {
        microtopicId: "microtopic-b2",
        title: "Synthetic topic B2",
        goalContract: "The learner explains the second synthetic idea under a different cue.",
        rubric,
      },
    ],
    rubric,
    pretestForm: {
      formId: "synthetic-pretest-form-v0",
      title: "Synthetic pretest",
      prompt: "Before study, explain the synthetic idea in your own words.",
      artifactType: "text",
    },
    immediateForm: {
      formId: "synthetic-immediate-form-v0",
      title: "Synthetic immediate test",
      prompt: "Immediately after study, answer the same idea with the same rubric.",
      artifactType: "text",
    },
    transferForm: {
      formId: "synthetic-transfer-form-v0",
      title: "Synthetic transfer test",
      prompt: "Apply the idea to a changed synthetic case.",
      artifactType: "text",
    },
    delayedForm: {
      formId: "synthetic-delayed-form-v0",
      title: "Synthetic delayed test",
      prompt: "After the delay, reconstruct the idea again without coaching.",
      artifactType: "text",
    },
    equivalenceMetadata: {
      rationale: "Synthetic only; all paired topics share the same rubric and a different surface cue.",
      sourceHashes: ["sha256-pack-source-a", "sha256-pack-source-b"],
    },
    scoringMaterials: {
      scoringGuidance: "Synthetic fixture scorer uses only the immutable rubric and learner artifact.",
      referenceAnswer: "idea reason transfer",
      disagreementPolicy: "Report disagreement as unknown; never infer a positive outcome.",
    },
    createdAt,
    updatedAt: createdAt,
    metadata: {
      schemaVersion: 1,
      createdBy: "synthetic-fixture",
      classification: "synthetic-only",
      author: "fixture-generator",
      reviewer: "fixture-auditor",
      changeHistory: ["v0 deterministic synthetic fixture"],
      sourceHash: "sha256-pack-fixture",
      notes: "Explicitly synthetic fixture for testing and documentation.",
    },
  };

  return {
    protocol,
    pack,
    participantId: "participant-01",
    seed: "synthetic-seed-42",
  };
}

/** Deterministic 2 policies × 4 readiness personas × 4 seeds × 2 help modes
 * matrix descriptor. It contains no learner artifacts and does not start trials. */
export function createSyntheticBenchmarkMatrix(): readonly SyntheticMatrixCell[] {
  const fixture = createSyntheticEvaluationFixture();
  const readiness: readonly SyntheticReadiness[] = ["cold", "partial", "ready", "overfit"];
  const helpModes: readonly SyntheticHelpMode[] = ["none", "process_prompt"];
  const seeds = ["synthetic-seed-01", "synthetic-seed-02", "synthetic-seed-03", "synthetic-seed-04"];
  return fixture.protocol.policyVariants.flatMap((policy) => readiness.flatMap((persona) => seeds.flatMap((seed) => helpModes.map((helpMode) => ({
    fixtureId: fixture.pack.packId,
    seed,
    readiness: persona,
    helpMode,
    policyId: policy.policyId,
    policyVersion: policy.policyVersion,
    trialSubjectKind: "synthetic" as const,
  })))));
}
