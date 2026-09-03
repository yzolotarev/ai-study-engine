export const EVALUATION_SCHEMA_VERSION = 1 as const;
export const EVALUATION_STORE_SCHEMA_VERSION = 2 as const;

export type CheckpointPhase = "pretest" | "immediate" | "transfer" | "delayed";
export type EvaluationArtifactType = "text" | "voice" | "map" | "canvas";
export type CriticalIncidentCategory =
  | "lost_goal"
  | "cold_baseline"
  | "overload"
  | "premature_help"
  | "wrong_gap"
  | "false_completion"
  | "transcription_problem"
  | "technical_wait"
  | "user_stopped"
  | "other";
export type ScorerKind = "trusted-human" | "deterministic" | "ai-semantic";
export type TrialStatus = "planned" | "started" | "paused" | "completed" | "cancelled";
export type CheckpointStatus = "presented" | "valid" | "invalid" | "not-yet-due";
export type TrialSubjectKind = "human" | "synthetic" | "legacy-unclassified";
export type NewTrialSubjectKind = Exclude<TrialSubjectKind, "legacy-unclassified">;
export type LearnerArtifactProvenance =
  | "trusted-human"
  | "deterministic-fixture"
  | "ai-simulation"
  | "legacy-unclassified";
export type StudyPackClassification = "human-ready" | "calibration-only" | "synthetic-only";
export type SyntheticReadiness = "cold" | "partial" | "ready" | "overfit";
export type SyntheticHelpMode = "none" | "process_prompt";

export interface SyntheticMatrixCell {
  readonly fixtureId: string;
  readonly seed: string;
  readonly readiness: SyntheticReadiness;
  readonly helpMode: SyntheticHelpMode;
  readonly policyId: string;
  readonly policyVersion: number;
  readonly trialSubjectKind: "synthetic";
}

export const SYNTHETIC_BEHAVIORAL_WARNING = "SYNTHETIC SOFTWARE/BEHAVIORAL CHECK — NOT HUMAN LEARNING EVIDENCE" as const;

/**
 * The part of a policy that is safe to execute without giving the policy
 * runtime access to assessment material.  A policy may choose a pedagogical
 * move, but it never produces learner evidence or assessment content.
 */
export type PolicyRuntimeSupportMode = "minimal-gap-cue" | "structured-orientation";
export type PolicyRuntimeHelpLevel = "process_prompt" | "minimal_hint";
export type PolicyRuntimeGapSelection = "first-unmet-or-unknown";
export type PolicyRuntimeReadyRule = "all-required-criteria-met";

export interface PolicyRuntimeSpec {
  readonly schemaVersion: 1;
  readonly readyRule: PolicyRuntimeReadyRule;
  readonly gapSelection: PolicyRuntimeGapSelection;
  readonly supportMode: PolicyRuntimeSupportMode;
  readonly gapIntent: "minimal_remediation" | "orientation";
  readonly interventionBudget: {
    readonly maxDurationMs: number;
    readonly maxHelpLevel: PolicyRuntimeHelpLevel;
  };
  readonly requiredSequence: {
    readonly transferAfterCleanPretest: boolean;
    readonly delayedAfterTransfer: boolean;
  };
  readonly disclosurePolicy: "assessment-isolated";
  readonly fallback: "stop";
}

export interface JsonObject {
  readonly [key: string]: JsonValue;
}
export type JsonArray = readonly JsonValue[];
export type JsonValue = string | number | boolean | null | JsonObject | JsonArray;

export interface RubricCriterion {
  readonly id: string;
  readonly description: string;
}

export interface PolicyVariant {
  readonly policyId: string;
  readonly policyVersion: number;
  readonly description: string;
  readonly deterministicConfig: JsonObject;
  readonly allowedPhases: readonly CheckpointPhase[];
  readonly allowedIntents: readonly string[];
  readonly featureFlags: readonly string[];
  /** Versioned executable intervention contract consumed by the deterministic policy runtime. */
  readonly runtimeSpec: PolicyRuntimeSpec;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface EvaluationProtocol {
  readonly protocolId: string;
  readonly version: number;
  readonly title: string;
  readonly domain: string;
  readonly hypothesis: string;
  readonly primaryOutcome: string;
  readonly secondaryOutcomes: readonly string[];
  readonly retentionDelayDays: number;
  readonly sessionTimeBudgetMinutes: number;
  readonly policyVariants: readonly PolicyVariant[];
  readonly topicAssignmentRules: {
    readonly method: "seeded-rotation";
    readonly counterbalance: "paired-rotation";
    readonly lockStartedTrials: true;
  };
  readonly allowedArtifactTypes: readonly EvaluationArtifactType[];
  readonly scorerRequirements: {
    readonly requireBlindScoring: true;
    readonly allowedScorers: readonly ScorerKind[];
    readonly rubricVersion: string;
  };
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly metadata: {
    readonly schemaVersion: typeof EVALUATION_SCHEMA_VERSION;
    readonly createdBy: string;
    readonly sourceHash?: string;
    readonly notes?: string;
  };
}

export interface StudyPackForm {
  readonly formId: string;
  readonly title: string;
  readonly prompt: string;
  readonly artifactType: EvaluationArtifactType;
}

export interface StudyPackMicrotopic {
  readonly microtopicId: string;
  readonly title: string;
  readonly goalContract: string;
  readonly rubric: readonly RubricCriterion[];
}

export interface StudyPackMatchedSet {
  readonly matchedSetId: string;
  readonly description: string;
  readonly microtopicIds: readonly string[];
  readonly equivalenceMetadata: {
    readonly rationale: string;
    readonly sourceHashes: readonly string[];
    readonly matchingDimensions: readonly string[];
  };
}

export interface StudyPack {
  readonly packId: string;
  readonly version: number;
  readonly domain: string;
  readonly sourceReferences: readonly string[];
  readonly matchedSets: readonly StudyPackMatchedSet[];
  readonly microtopics: readonly StudyPackMicrotopic[];
  readonly rubric: readonly RubricCriterion[];
  readonly pretestForm: StudyPackForm;
  readonly immediateForm: StudyPackForm;
  readonly transferForm: StudyPackForm;
  readonly delayedForm: StudyPackForm;
  readonly equivalenceMetadata: {
    readonly rationale: string;
    readonly sourceHashes: readonly string[];
  };
  readonly scoringMaterials: {
    readonly scoringGuidance: string;
    readonly referenceAnswer?: string;
    readonly disagreementPolicy: string;
  };
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly metadata: {
    readonly schemaVersion: typeof EVALUATION_SCHEMA_VERSION;
    readonly createdBy: string;
    readonly classification: StudyPackClassification;
    readonly author: string;
    readonly reviewer: string;
    readonly changeHistory: readonly string[];
    readonly sourceHash?: string;
    readonly notes?: string;
  };
}

/** Tutor-safe view. Assessment prompts, reference answers, and scorer guidance
 * are intentionally absent from this DTO. */
export interface StudyPackCoachingSurface {
  readonly packId: string;
  readonly version: number;
  readonly domain: string;
  readonly microtopicId: string;
  readonly title: string;
  readonly goalContract: string;
  readonly allowedArtifactTypes: readonly EvaluationArtifactType[];
}

export interface TrialCheckpointLink {
  readonly checkpointId: string;
  readonly status: CheckpointStatus;
}

export interface LearningTrial {
  readonly trialId: string;
  readonly trialSubjectKind: TrialSubjectKind;
  readonly participantId: string;
  readonly protocolId: string;
  readonly protocolVersion: number;
  readonly packId: string;
  readonly packVersion: number;
  readonly policyId: string;
  readonly policyVersion: number;
  readonly microtopicId: string;
  readonly matchedSetId: string;
  readonly assignmentSeed: string;
  readonly assignmentOrder: number;
  readonly phaseOrder: readonly CheckpointPhase[];
  readonly startedAt?: string;
  readonly endedAt?: string;
  readonly retentionDueAt?: string;
  readonly status: TrialStatus;
  readonly checkpoints: Partial<Record<CheckpointPhase, TrialCheckpointLink>>;
  readonly artifactIds: readonly string[];
}

export interface TrustedLearnerProvenance {
  readonly provenanceId: string;
  readonly source: "trusted-local-human";
  readonly verifiedAt: string;
  readonly note?: string;
}

export interface LearnerArtifact {
  readonly artifactId: string;
  readonly checkpointId: string;
  readonly provenance: LearnerArtifactProvenance;
  readonly kind: EvaluationArtifactType;
  readonly content: string;
  readonly contentHash: string;
  readonly createdAt: string;
}

export interface HelpState {
  readonly contaminated: boolean;
  readonly helpCountByLevel: Readonly<Record<string, number>>;
  readonly technicalWaitMs?: number;
  readonly notes: readonly string[];
}

export interface CheckpointRubricVector {
  readonly criteria: Readonly<Record<string, "met" | "unmet" | "unknown">>;
  readonly metCount: number;
  readonly unmetCount: number;
  readonly unknownCount: number;
}

export interface ScorerRecord {
  readonly scorerKind: ScorerKind;
  readonly scorerId: string;
  readonly scorerVersion: string;
  readonly rubricVersion: string;
}

export interface Checkpoint {
  readonly checkpointId: string;
  /** Stable attempt identity; legacy rows default this to checkpointId. */
  readonly attemptId?: string;
  readonly trialId: string;
  readonly phase: CheckpointPhase;
  readonly taskId: string;
  readonly formId: string;
  readonly presentedAt: string;
  readonly dueAt?: string;
  readonly learnerArtifactRef?: {
    readonly artifactId: string;
    readonly contentHash: string;
    readonly kind: EvaluationArtifactType;
  };
  readonly trustedLearnerProvenance?: TrustedLearnerProvenance;
  readonly helpState: HelpState;
  readonly rubricResultVector?: CheckpointRubricVector;
  readonly scorer?: ScorerRecord;
  readonly assessedAt?: string;
  readonly status: CheckpointStatus;
}

export interface InterventionObservation {
  readonly observationId: string;
  readonly trialId: string;
  readonly checkpointId?: string;
  readonly pedagogicalIntent: string;
  readonly technique: string;
  readonly targetCriterionId?: string;
  readonly gapId?: string;
  readonly helpLevel: string;
  readonly aiOutputReference?: {
    readonly artifactId?: string;
    readonly contentHash?: string;
    readonly modality?: EvaluationArtifactType;
  };
  readonly learnerResponseReference?: {
    readonly artifactId?: string;
    readonly contentHash?: string;
    readonly modality?: EvaluationArtifactType;
  };
  readonly phase: CheckpointPhase | "session";
  readonly observedAt: string;
  readonly endedAt?: string;
  readonly responseIntervalMs?: number;
  readonly aiOutputWords?: number;
  readonly aiOutputCharacters?: number;
  readonly aiSpeechDurationMs?: number;
  readonly learnerCaptureDurationMs?: number;
  readonly technicalWaitMs?: number;
  readonly sessionElapsedMs?: number;
  readonly modality?: EvaluationArtifactType;
  readonly turnId?: string;
  readonly artifactId?: string;
  readonly learnerNote?: string;
}

export interface CriticalIncident {
  readonly incidentId: string;
  readonly trialId: string;
  readonly checkpointId?: string;
  readonly turnId?: string;
  readonly artifactId?: string;
  readonly category: CriticalIncidentCategory;
  readonly learnerNote?: string;
  readonly createdAt: string;
}

export interface SubjectiveFeedback {
  readonly feedbackId: string;
  readonly trialId: string;
  readonly clarity: number;
  readonly load: number;
  readonly usefulness: number;
  readonly confidence: number;
  readonly comment?: string;
  readonly createdAt: string;
}

export interface PhaseVector {
  readonly criteria: Readonly<Record<string, "met" | "unmet" | "unknown">>;
  readonly metCount: number;
  readonly unmetCount: number;
  readonly unknownCount: number;
}

export interface TrialMetrics {
  readonly trialId: string;
  readonly participantId: string;
  readonly policyId: string;
  readonly policyVersion: number;
  readonly matchedSetId: string;
  readonly microtopicId: string;
  readonly pretest: PhaseVector;
  readonly immediate: PhaseVector;
  readonly transfer: PhaseVector;
  readonly delayed: PhaseVector;
  readonly rawCriterionGain: number | null;
  readonly gapsClosed: number;
  readonly gapsReopened: number;
  readonly cleanAttempts: number;
  readonly contaminatedAttempts: number;
  readonly timeToFirstMeaningfulLearnerAttemptMs: number | null;
  readonly totalSessionDurationMs: number | null;
  readonly technicalWaitingDurationMs: number | null;
  readonly aiOutputVolume: {
    readonly words: number;
    readonly characters: number;
  };
  readonly helpCountByLevel: Readonly<Record<string, number>>;
  readonly criticalIncidents: Readonly<Record<CriticalIncidentCategory, number>>;
  readonly falseCompletionIndicator: boolean;
  readonly delayedOutcomeAvailability: boolean;
  readonly missing: readonly string[];
}

export interface ComparisonReportVariantSummary {
  readonly policyId: string;
  readonly policyVersion: number;
  readonly matchedSetIds: readonly string[];
  readonly trialCount: number;
  readonly learningOutcomes: {
    readonly rawCriterionGain: number | null;
    readonly pretest: PhaseVector | null;
    readonly immediate: PhaseVector | null;
    readonly transfer: PhaseVector | null;
    readonly delayed: PhaseVector | null;
  };
  readonly costFriction: {
    readonly cleanAttempts: number;
    readonly contaminatedAttempts: number;
    readonly totalSessionDurationMs: number | null;
    readonly technicalWaitingDurationMs: number | null;
    readonly aiOutputVolume: {
      readonly words: number;
      readonly characters: number;
    };
    readonly helpCountByLevel: Readonly<Record<string, number>>;
  };
  readonly evidenceValidity: {
    readonly falseCompletionIndicators: number;
    readonly delayedOutcomeAvailability: number;
    readonly criticalIncidents: Readonly<Record<CriticalIncidentCategory, number>>;
  };
  readonly subjectiveFeedback: {
    readonly clarity: number | null;
    readonly load: number | null;
    readonly usefulness: number | null;
    readonly confidence: number | null;
    readonly comments: readonly string[];
  };
  readonly missing: readonly string[];
}

export interface ComparisonReport {
  readonly evidencePopulation: "human-trusted-only";
  readonly protocolId: string;
  readonly protocolVersion: number;
  readonly packId: string;
  readonly packVersion: number;
  readonly seed: string;
  readonly participantId: string;
  readonly generatedAt: string;
  readonly matchedSets: readonly {
    readonly matchedSetId: string;
    readonly microtopicId: string;
    readonly policyId: string;
    readonly policyVersion: number;
    readonly trialId: string;
    readonly metrics: TrialMetrics;
  }[];
  readonly variantSummaries: readonly ComparisonReportVariantSummary[];
  readonly sections: {
    readonly learningOutcomes: string;
    readonly costFriction: string;
    readonly evidenceValidity: string;
    readonly subjectiveFeedback: string;
    readonly missingUnknownMeasurements: readonly string[];
  };
  readonly caution: readonly string[];
}

export interface SyntheticBehavioralCell {
  readonly matchedSetId: string;
  readonly microtopicId: string;
  readonly policyId: string;
  readonly policyVersion: number;
  readonly trialId: string;
  readonly artifactProvenance: readonly Exclude<LearnerArtifactProvenance, "trusted-human" | "legacy-unclassified">[];
  readonly rubricPipeline: {
    readonly pretest: PhaseVector;
    readonly immediate: PhaseVector;
    readonly transfer: PhaseVector;
    readonly freshContextProxy: PhaseVector;
    readonly rubricPipelineDelta: number | null;
  };
  readonly mechanics: {
    readonly cleanAttempts: number;
    readonly contaminatedAttempts: number;
    readonly helpCountByLevel: Readonly<Record<string, number>>;
    readonly technicalWaitingDurationMs: number | null;
    readonly runtimeDurationMs: number | null;
    readonly missing: readonly string[];
  };
}

export interface SyntheticBehavioralVariantSummary {
  readonly policyId: string;
  readonly policyVersion: number;
  readonly trialCount: number;
  readonly matchedSetIds: readonly string[];
  readonly rubricPipeline: {
    readonly averageRubricPipelineDelta: number | null;
  };
  readonly mechanics: {
    readonly cleanAttempts: number;
    readonly contaminatedAttempts: number;
    readonly helpCountByLevel: Readonly<Record<string, number>>;
    readonly falseCompletionIndicators: number;
    readonly missing: readonly string[];
  };
}

export interface SyntheticBehavioralReport {
  readonly reportKind: "synthetic-software-behavioral-check";
  readonly warning: typeof SYNTHETIC_BEHAVIORAL_WARNING;
  readonly protocolId: string;
  readonly protocolVersion: number;
  readonly packId: string;
  readonly packVersion: number;
  readonly seed: string;
  readonly participantId: string;
  readonly generatedAt: string;
  readonly cells: readonly SyntheticBehavioralCell[];
  readonly variantSummaries: readonly SyntheticBehavioralVariantSummary[];
  readonly limitations: readonly string[];
}

export interface SyntheticBenchmarkCellResult {
  readonly fixtureId: string;
  readonly seed: string;
  readonly readiness: SyntheticReadiness;
  readonly helpMode: SyntheticHelpMode;
  readonly policyId: string;
  readonly policyVersion: number;
  readonly trialId: string;
  readonly reportCell: SyntheticBehavioralCell;
  readonly policyDecision: {
    readonly action: string;
    readonly intent: string;
    readonly reasonCode: string;
    readonly traceFingerprint: string;
  };
}

export interface SyntheticBenchmarkReport {
  readonly reportKind: "synthetic-software-behavioral-benchmark";
  readonly warning: typeof SYNTHETIC_BEHAVIORAL_WARNING;
  readonly matrixSize: number;
  readonly completedCells: number;
  readonly failedCells: number;
  readonly failures: readonly { readonly fixtureId: string; readonly seed: string; readonly readiness: SyntheticReadiness; readonly helpMode: SyntheticHelpMode; readonly policyId: string; readonly error: string }[];
  readonly cells: readonly SyntheticBenchmarkCellResult[];
  readonly deterministicDigest: string;
  readonly limitations: readonly string[];
}

export interface ExportPreviewFile {
  readonly path: string;
  readonly description: string;
}

export interface SecretFinding {
  readonly kind: string;
  readonly path: string;
  readonly sample: string;
}

export interface ExportPreview {
  readonly exportId: string;
  readonly mode: "summary" | "research";
  readonly generatedAt: string;
  readonly consentRequired: boolean;
  readonly targetDirectory: string;
  readonly files: readonly ExportPreviewFile[];
  readonly includedFields: readonly string[];
  readonly excludedFields: readonly string[];
  readonly secretsScan: {
    readonly passed: boolean;
    readonly findings: readonly SecretFinding[];
  };
  readonly snapshotHash: string;
  readonly fileManifest: readonly string[];
  readonly fileHashes: Readonly<Record<string, string>>;
}

export interface ExportResult {
  readonly exportId: string;
  readonly mode: "summary" | "research";
  readonly outputDirectory: string;
  readonly generatedAt: string;
  readonly files: readonly string[];
}

export interface EvaluationAnomaly {
  readonly code: string;
  readonly detail: string;
  readonly entity: string;
  readonly entityId: string;
}
