import { contentHash } from "./hash.js";
import { emptyCriticalIncidentVector } from "./scoring.js";
import { SYNTHETIC_BEHAVIORAL_WARNING } from "./types.js";
import type {
  Checkpoint,
  CheckpointPhase,
  ComparisonReport,
  ComparisonReportVariantSummary,
  CriticalIncident,
  CriticalIncidentCategory,
  EvaluationProtocol,
  InterventionObservation,
  LearnerArtifact,
  LearningTrial,
  PhaseVector,
  PolicyVariant,
  SubjectiveFeedback,
  TrialMetrics,
  StudyPack,
  SyntheticBehavioralReport,
} from "./types.js";

export interface TrialBundle {
  readonly trial: LearningTrial;
  readonly checkpoints: readonly Checkpoint[];
  readonly artifacts: readonly LearnerArtifact[];
  readonly observations: readonly InterventionObservation[];
  readonly incidents: readonly CriticalIncident[];
  readonly feedback: readonly SubjectiveFeedback[];
  readonly protocol: EvaluationProtocol;
  readonly pack: StudyPack;
  readonly policy: PolicyVariant;
}

function emptyPhaseVector(criterionIds: readonly string[]): PhaseVector {
  const criteria: Record<string, "met" | "unmet" | "unknown"> = {};
  for (const criterionId of criterionIds) criteria[criterionId] = "unknown";
  return { criteria, metCount: 0, unmetCount: 0, unknownCount: criterionIds.length };
}

function phaseVector(checkpoint: Checkpoint | undefined, criterionIds: readonly string[]): PhaseVector {
  if (!checkpoint?.rubricResultVector || checkpoint.helpState.contaminated || checkpoint.status === "not-yet-due") {
    return emptyPhaseVector(criterionIds);
  }
  const criteria: Record<string, "met" | "unmet" | "unknown"> = {};
  let metCount = 0;
  let unmetCount = 0;
  let unknownCount = 0;
  for (const criterionId of criterionIds) {
    const status = checkpoint.rubricResultVector.criteria[criterionId] ?? "unknown";
    criteria[criterionId] = status;
    if (status === "met") metCount += 1;
    else if (status === "unmet") unmetCount += 1;
    else unknownCount += 1;
  }
  return { criteria, metCount, unmetCount, unknownCount };
}

function firstObservedVector(values: readonly PhaseVector[], criterionCount: number): PhaseVector | undefined {
  return values.find((value) => value.unknownCount < criterionCount);
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function average(values: readonly number[]): number | null {
  return values.length === 0 ? null : sum(values) / values.length;
}

function mergeCounts<T extends string>(keys: readonly T[]): Record<T, number> {
  return keys.reduce((acc, key) => {
    acc[key] = 0;
    return acc;
  }, {} as Record<T, number>);
}

function criterionIdsForPack(pack: StudyPack): readonly string[] {
  return [...new Set(pack.rubric.map((criterion) => criterion.id))];
}

function attemptVector(trial: LearningTrial, checkpoints: readonly Checkpoint[], phase: CheckpointPhase, criterionIds: readonly string[]): PhaseVector {
  const attempts = checkpoints.filter((checkpoint) => checkpoint.phase === phase);
  return phaseVector(attempts.at(-1), criterionIds);
}

export function computeTrialMetrics(bundle: TrialBundle, now: string): TrialMetrics {
  const criterionIds = criterionIdsForPack(bundle.pack);
  const byPhase = (phase: CheckpointPhase) => bundle.checkpoints.find((checkpoint) => checkpoint.phase === phase);
  const pretest = attemptVector(bundle.trial, bundle.checkpoints, "pretest", criterionIds);
  const immediate = attemptVector(bundle.trial, bundle.checkpoints, "immediate", criterionIds);
  const transfer = attemptVector(bundle.trial, bundle.checkpoints, "transfer", criterionIds);
  const delayed = attemptVector(bundle.trial, bundle.checkpoints, "delayed", criterionIds);
  const finalVector = firstObservedVector([delayed, transfer, immediate, pretest], criterionIds.length);
  const baseVector = pretest;
  const rawCriterionGain = finalVector && baseVector.unknownCount < criterionIds.length
    ? finalVector.metCount - baseVector.metCount
    : null;

  const checkpointByPhase = new Map(bundle.checkpoints.map((checkpoint) => [checkpoint.phase, checkpoint] as const));
  const vectorSequence = [pretest, immediate, transfer, delayed];
  const gapsClosed = criterionIds.filter((criterionId) => {
    const statuses = vectorSequence.map((vector) => vector.criteria[criterionId] ?? "unknown");
    return statuses.some((status) => status === "met") && statuses.some((status) => status === "unmet");
  }).length;
  const gapsReopened = criterionIds.filter((criterionId) => {
    const statuses = vectorSequence.map((vector) => vector.criteria[criterionId] ?? "unknown");
    return statuses.some((status) => status === "met") && statuses.lastIndexOf("unmet") > statuses.indexOf("met");
  }).length;

  const cleanAttempts = bundle.checkpoints.filter((checkpoint) => checkpoint.learnerArtifactRef !== undefined && checkpoint.helpState.contaminated === false).length;
  const contaminatedAttempts = bundle.checkpoints.filter((checkpoint) => checkpoint.helpState.contaminated === true).length;
  const firstArtifact = [...bundle.artifacts].sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))[0];
  const timeToFirstMeaningfulLearnerAttemptMs = bundle.trial.startedAt && firstArtifact
    ? Math.max(0, Date.parse(firstArtifact.createdAt) - Date.parse(bundle.trial.startedAt))
    : null;
  const totalSessionDurationMs = bundle.trial.startedAt
    ? Math.max(0, Date.parse(bundle.trial.endedAt ?? now) - Date.parse(bundle.trial.startedAt))
    : null;
  const technicalWaitingDurationMs = sum(bundle.observations.map((observation) => observation.technicalWaitMs ?? 0))
    + sum(bundle.checkpoints.map((checkpoint) => checkpoint.helpState.technicalWaitMs ?? 0));
  const aiOutputVolume = {
    words: sum(bundle.observations.map((observation) => observation.aiOutputWords ?? 0)),
    characters: sum(bundle.observations.map((observation) => observation.aiOutputCharacters ?? 0)),
  };
  const helpCountByLevel = bundle.observations.reduce((acc, observation) => {
    acc[observation.helpLevel] = (acc[observation.helpLevel] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const criticalIncidents = mergeCounts([
    "lost_goal",
    "cold_baseline",
    "overload",
    "premature_help",
    "wrong_gap",
    "false_completion",
    "transcription_problem",
    "technical_wait",
    "user_stopped",
    "other",
  ] as const);
  for (const incident of bundle.incidents) criticalIncidents[incident.category] += 1;
  const delayedCheckpoint = byPhase("delayed");
  const delayedOutcomeAvailability = Boolean(delayedCheckpoint && delayedCheckpoint.assessedAt && (delayedCheckpoint.dueAt === undefined || Date.parse(delayedCheckpoint.assessedAt) >= Date.parse(delayedCheckpoint.dueAt)));
  const falseCompletionIndicator = bundle.trial.status === "completed"
    && bundle.checkpoints.some((checkpoint) => checkpoint.status !== "valid" || checkpoint.helpState.contaminated);

  const missing = [
    !bundle.trial.startedAt ? "trial.startedAt" : null,
    !bundle.trial.endedAt && bundle.trial.status === "started" ? "trial.endedAt" : null,
    !bundle.checkpoints.find((checkpoint) => checkpoint.phase === "pretest") ? "checkpoint.pretest" : null,
    !bundle.checkpoints.find((checkpoint) => checkpoint.phase === "immediate") ? "checkpoint.immediate" : null,
    !bundle.checkpoints.find((checkpoint) => checkpoint.phase === "transfer") ? "checkpoint.transfer" : null,
    !bundle.checkpoints.find((checkpoint) => checkpoint.phase === "delayed") ? "checkpoint.delayed" : null,
    delayedCheckpoint?.status === "not-yet-due" ? "delayed.not-yet-due" : null,
    bundle.feedback.length === 0 ? "subjective.feedback" : null,
  ].filter((item): item is string => item !== null);

  return {
    trialId: bundle.trial.trialId,
    participantId: bundle.trial.participantId,
    policyId: bundle.policy.policyId,
    policyVersion: bundle.policy.policyVersion,
    matchedSetId: bundle.trial.matchedSetId,
    microtopicId: bundle.trial.microtopicId,
    pretest,
    immediate,
    transfer,
    delayed,
    rawCriterionGain,
    gapsClosed,
    gapsReopened,
    cleanAttempts,
    contaminatedAttempts,
    timeToFirstMeaningfulLearnerAttemptMs,
    totalSessionDurationMs,
    technicalWaitingDurationMs,
    aiOutputVolume,
    helpCountByLevel,
    criticalIncidents,
    falseCompletionIndicator,
    delayedOutcomeAvailability,
    missing,
  };
}

function variantKey(policyId: string, policyVersion: number): string {
  return `${policyId}@${policyVersion}`;
}

function aggregateVariantSummary(variantKeyText: string, bundles: readonly TrialBundle[], generatedAt: string): ComparisonReportVariantSummary {
  const [policyIdRaw, versionText] = variantKeyText.split("@");
  const policyId = policyIdRaw ?? "unknown";
  const policyVersion = Number(versionText);
  const metrics = bundles.map((bundle) => computeTrialMetrics(bundle, generatedAt));
  const criterionGain = average(metrics.map((metric) => metric.rawCriterionGain).filter((value): value is number => value !== null));
  const cleanAttempts = sum(metrics.map((metric) => metric.cleanAttempts));
  const contaminatedAttempts = sum(metrics.map((metric) => metric.contaminatedAttempts));
  const totalSessionDurationMs = average(metrics.map((metric) => metric.totalSessionDurationMs).filter((value): value is number => value !== null));
  const technicalWaitingDurationMs = average(metrics.map((metric) => metric.technicalWaitingDurationMs).filter((value): value is number => value !== null));
  const aiOutputWords = sum(metrics.map((metric) => metric.aiOutputVolume.words));
  const aiOutputCharacters = sum(metrics.map((metric) => metric.aiOutputVolume.characters));
  const helpCountByLevel = metrics.reduce((acc, metric) => {
    for (const [level, count] of Object.entries(metric.helpCountByLevel)) acc[level] = (acc[level] ?? 0) + count;
    return acc;
  }, {} as Record<string, number>);
  const criticalIncidents = emptyCriticalIncidentVector();
  for (const metric of metrics) {
    for (const [category, count] of Object.entries(metric.criticalIncidents) as [CriticalIncidentCategory, number][]) {
      criticalIncidents[category] += count;
    }
  }
  const subjective = bundles.flatMap((bundle) => bundle.feedback);
  const summary = {
    policyId,
    policyVersion,
    matchedSetIds: [...new Set(bundles.map((bundle) => bundle.trial.matchedSetId))],
    trialCount: bundles.length,
    learningOutcomes: {
      rawCriterionGain: criterionGain,
      pretest: bundles[0] ? metrics[0]!.pretest : null,
      immediate: bundles[0] ? metrics[0]!.immediate : null,
      transfer: bundles[0] ? metrics[0]!.transfer : null,
      delayed: bundles[0] ? metrics[0]!.delayed : null,
    },
    costFriction: {
      cleanAttempts,
      contaminatedAttempts,
      totalSessionDurationMs,
      technicalWaitingDurationMs,
      aiOutputVolume: { words: aiOutputWords, characters: aiOutputCharacters },
      helpCountByLevel,
    },
    evidenceValidity: {
      falseCompletionIndicators: sum(metrics.map((metric) => Number(metric.falseCompletionIndicator))),
      delayedOutcomeAvailability: sum(metrics.map((metric) => Number(metric.delayedOutcomeAvailability))),
      criticalIncidents,
    },
    subjectiveFeedback: {
      clarity: average(subjective.map((feedback) => feedback.clarity)),
      load: average(subjective.map((feedback) => feedback.load)),
      usefulness: average(subjective.map((feedback) => feedback.usefulness)),
      confidence: average(subjective.map((feedback) => feedback.confidence)),
      comments: subjective.map((feedback) => feedback.comment).filter((comment): comment is string => Boolean(comment)),
    },
    missing: [...new Set(metrics.flatMap((metric) => metric.missing))],
  } as const;
  return summary;
}

export function buildComparisonReport(input: {
  readonly protocol: EvaluationProtocol;
  readonly pack: StudyPack;
  readonly seed: string;
  readonly participantId: string;
  readonly generatedAt: string;
  readonly bundles: readonly TrialBundle[];
}): ComparisonReport {
  const matchedSets = input.bundles.map((bundle) => ({
    matchedSetId: bundle.trial.matchedSetId,
    microtopicId: bundle.trial.microtopicId,
    policyId: bundle.policy.policyId,
    policyVersion: bundle.policy.policyVersion,
    trialId: bundle.trial.trialId,
    metrics: computeTrialMetrics(bundle, input.generatedAt),
  }));
  const byVariant = new Map<string, TrialBundle[]>();
  for (const bundle of input.bundles) {
    const key = variantKey(bundle.policy.policyId, bundle.policy.policyVersion);
    const list = byVariant.get(key) ?? [];
    list.push(bundle);
    byVariant.set(key, list);
  }
  const variantSummaries = [...byVariant.entries()].map(([key, bundles]) => aggregateVariantSummary(key, bundles, input.generatedAt));
  const learningOutcomes = matchedSets.length === 0
    ? "No matched sets were recorded yet."
    : `Observed ${matchedSets.length} matched-set trial(s) with raw criterion gain values that remain descriptive only; no statistical significance claim is made.`;
  const costFriction = matchedSets.length === 0
    ? "No cost/friction data were recorded yet."
    : "Reported durations, AI output volume, and help counts are observational proxies only; missing fields remain missing.";
  const evidenceValidity = matchedSets.length === 0
    ? "No validity evidence was recorded yet."
    : "Evidence validity is separated from learning outcomes and keeps contaminated, invalid, and not-yet-due outcomes distinct.";
  const subjectiveFeedback = matchedSets.length === 0
    ? "No subjective feedback was collected yet."
    : "Subjective exit feedback remains separate from learning outcomes and is not treated as performance evidence.";
  const missingUnknownMeasurements = [...new Set([...variantSummaries.flatMap((summary) => summary.missing), ...matchedSets.flatMap((item) => item.metrics.missing)])];
  return {
    evidencePopulation: "human-trusted-only",
    protocolId: input.protocol.protocolId,
    protocolVersion: input.protocol.version,
    packId: input.pack.packId,
    packVersion: input.pack.version,
    seed: input.seed,
    participantId: input.participantId,
    generatedAt: input.generatedAt,
    matchedSets,
    variantSummaries,
    sections: {
      learningOutcomes,
      costFriction,
      evidenceValidity,
      subjectiveFeedback,
      missingUnknownMeasurements,
    },
    caution: [
      "No statistical significance claim is made at this sample size.",
      "Unknown and missing measurements remain explicit instead of being treated as zero.",
      "This report observes outcomes; it does not prove learning.",
    ],
  };
}

export function buildSyntheticBehavioralReport(input: {
  readonly protocol: EvaluationProtocol;
  readonly pack: StudyPack;
  readonly seed: string;
  readonly participantId: string;
  readonly generatedAt: string;
  readonly bundles: readonly TrialBundle[];
}): SyntheticBehavioralReport {
  const comparison = buildComparisonReport(input);
  const bundleByTrialId = new Map(input.bundles.map((bundle) => [bundle.trial.trialId, bundle] as const));
  const cells = comparison.matchedSets.map((item) => {
    const bundle = bundleByTrialId.get(item.trialId)!;
    const artifactProvenance = [...new Set(bundle.artifacts.map((artifact) => artifact.provenance))].filter(
      (provenance): provenance is "deterministic-fixture" | "ai-simulation" => provenance === "deterministic-fixture" || provenance === "ai-simulation",
    );
    return {
      matchedSetId: item.matchedSetId,
      microtopicId: item.microtopicId,
      policyId: item.policyId,
      policyVersion: item.policyVersion,
      trialId: item.trialId,
      artifactProvenance,
      rubricPipeline: {
        pretest: item.metrics.pretest,
        immediate: item.metrics.immediate,
        transfer: item.metrics.transfer,
        freshContextProxy: item.metrics.delayed,
        rubricPipelineDelta: item.metrics.rawCriterionGain,
      },
      mechanics: {
        cleanAttempts: item.metrics.cleanAttempts,
        contaminatedAttempts: item.metrics.contaminatedAttempts,
        helpCountByLevel: item.metrics.helpCountByLevel,
        technicalWaitingDurationMs: item.metrics.technicalWaitingDurationMs,
        runtimeDurationMs: item.metrics.totalSessionDurationMs,
        missing: item.metrics.missing,
      },
    } as const;
  });
  const variantSummaries = comparison.variantSummaries.map((summary) => ({
    policyId: summary.policyId,
    policyVersion: summary.policyVersion,
    trialCount: summary.trialCount,
    matchedSetIds: summary.matchedSetIds,
    rubricPipeline: {
      averageRubricPipelineDelta: summary.learningOutcomes.rawCriterionGain,
    },
    mechanics: {
      cleanAttempts: summary.costFriction.cleanAttempts,
      contaminatedAttempts: summary.costFriction.contaminatedAttempts,
      helpCountByLevel: summary.costFriction.helpCountByLevel,
      falseCompletionIndicators: summary.evidenceValidity.falseCompletionIndicators,
      missing: summary.missing,
    },
  }));
  return {
    reportKind: "synthetic-software-behavioral-check",
    warning: SYNTHETIC_BEHAVIORAL_WARNING,
    protocolId: input.protocol.protocolId,
    protocolVersion: input.protocol.version,
    packId: input.pack.packId,
    packVersion: input.pack.version,
    seed: input.seed,
    participantId: input.participantId,
    generatedAt: input.generatedAt,
    cells,
    variantSummaries,
    limitations: [
      "Rubric vectors are scoring-pipeline diagnostics, not human learning outcomes.",
      "The delayed field is a fresh-context orchestration proxy and does not measure human retention.",
      "Results are conditional on the exact fixture, policies, scorer, and execution parameters.",
    ],
  };
}
