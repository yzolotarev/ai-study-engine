import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { randomUUID } from "node:crypto";
import { buildComparisonReport, buildSyntheticBehavioralReport, computeTrialMetrics, type TrialBundle } from "./report.js";
import { contentHash, sha256Hex } from "./hash.js";
import { DeterministicFixtureScorer, ManualTrustedScorer, type Scorer, type ScorerInput, emptyCriticalIncidentVector, validateRubricVector } from "./scoring.js";
import { EvaluationStore, type EvaluationDeletionResult } from "./store.js";
import { validateEvaluationProtocol, validateStudyPack as validateStudyPackInput } from "./validation.js";
import { executePolicy, type PolicyRuntimeInput, type PolicyRuntimeTrace } from "./policy-runtime.js";
import type {
  Checkpoint,
  CheckpointPhase,
  CheckpointRubricVector,
  CheckpointStatus,
  ComparisonReport,
  CriticalIncident,
  CriticalIncidentCategory,
  EvaluationAnomaly,
  EvaluationProtocol,
  ExportPreview,
  ExportPreviewFile,
  ExportResult,
  InterventionObservation,
  JsonValue,
  LearnerArtifact,
  LearnerArtifactProvenance,
  LearningTrial,
  NewTrialSubjectKind,
  PolicyVariant,
  ScorerKind,
  StudyPack,
  StudyPackCoachingSurface,
  SubjectiveFeedback,
  SyntheticBehavioralReport,
  TrialCheckpointLink,
  TrialMetrics,
  TrialStatus,
  TrustedLearnerProvenance,
} from "./types.js";

export interface EvaluationServiceOptions {
  readonly now?: () => string;
  readonly id?: () => string;
}

export interface AssignmentRequest {
  readonly protocolId: string;
  readonly protocolVersion: number;
  readonly packId: string;
  readonly packVersion: number;
  readonly participantId: string;
  readonly seed: string;
  readonly trialSubjectKind: NewTrialSubjectKind;
}

export interface OpenCheckpointResult {
  readonly checkpoint: Checkpoint;
  readonly form: {
    readonly formId: string;
    readonly title: string;
    readonly prompt: string;
    readonly artifactType: string;
  };
}

export interface TrialStatusResult {
  readonly trial: LearningTrial;
  readonly metrics: TrialMetrics;
  readonly checkpoints: readonly Checkpoint[];
  readonly artifacts: readonly LearnerArtifact[];
  readonly observations: readonly InterventionObservation[];
  readonly incidents: readonly CriticalIncident[];
  readonly feedback: readonly SubjectiveFeedback[];
  readonly anomalies: readonly EvaluationAnomaly[];
}

interface SecretScanContext {
  readonly path: string;
  readonly value: string;
}

const TRUSTED_HUMAN_INGRESS = Symbol("trusted-evaluation-human-ingress");
const SYNTHETIC_TEST_INGRESS = Symbol("synthetic-evaluation-test-ingress");

function nowIso(): string {
  return new Date().toISOString();
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function phaseToFormKey(phase: CheckpointPhase): keyof Pick<StudyPack, "pretestForm" | "immediateForm" | "transferForm" | "delayedForm"> {
  return phase === "pretest" ? "pretestForm"
    : phase === "immediate" ? "immediateForm"
      : phase === "transfer" ? "transferForm"
        : "delayedForm";
}

function makeTrialId(protocolId: string, protocolVersion: number, packId: string, packVersion: number, participantId: string, microtopicId: string): string {
  return `trial-${sha256Hex([protocolId, protocolVersion, packId, packVersion, participantId, microtopicId].join("|")).slice(0, 16)}`;
}

function makeCheckpointId(trialId: string, phase: CheckpointPhase, attemptNumber = 0): string {
  return `checkpoint-${sha256Hex([trialId, phase, attemptNumber].join("|")).slice(0, 16)}`;
}

function makeArtifactId(checkpointId: string, hash: string): string {
  return `artifact-${sha256Hex([checkpointId, hash].join("|")).slice(0, 16)}`;
}

function makeObservationId(trialId: string, phase: string, helpLevel: string, technique: string, observedAt: string): string {
  return `obs-${sha256Hex([trialId, phase, helpLevel, technique, observedAt].join("|")).slice(0, 16)}`;
}

function makeIncidentId(trialId: string, category: string, createdAt: string, reference: string): string {
  return `incident-${sha256Hex([trialId, category, createdAt, reference].join("|")).slice(0, 16)}`;
}

function makeFeedbackId(trialId: string, createdAt: string, comment: string): string {
  return `feedback-${sha256Hex([trialId, createdAt, comment].join("|")).slice(0, 16)}`;
}

function jsonRow<T>(value: string | undefined, entity: string, id: string, anomalies: EvaluationAnomaly[]): T | undefined {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    anomalies.push({ code: "CORRUPT_JSON", detail: `cannot parse ${entity}`, entity, entityId: id });
    return undefined;
  }
}

function phaseOrder(): readonly CheckpointPhase[] {
  return ["pretest", "immediate", "transfer", "delayed"];
}

function normaliseVector(criteria: readonly string[], vector?: CheckpointRubricVector): CheckpointRubricVector {
  if (!vector) {
    const empty: Record<string, "met" | "unmet" | "unknown"> = {};
    for (const criterionId of criteria) empty[criterionId] = "unknown";
    return { criteria: empty, metCount: 0, unmetCount: 0, unknownCount: criteria.length };
  }
  const criteriaVector: Record<string, "met" | "unmet" | "unknown"> = {};
  let metCount = 0;
  let unmetCount = 0;
  let unknownCount = 0;
  for (const criterionId of criteria) {
    const status = vector.criteria[criterionId] ?? "unknown";
    criteriaVector[criterionId] = status;
    if (status === "met") metCount += 1;
    else if (status === "unmet") unmetCount += 1;
    else unknownCount += 1;
  }
  return { criteria: criteriaVector, metCount, unmetCount, unknownCount };
}

function helperCounts(checkpoint: Checkpoint): Readonly<Record<string, number>> {
  return checkpoint.helpState.helpCountByLevel;
}

function phaseFromRow(row: string): CheckpointPhase {
  assert(row === "pretest" || row === "immediate" || row === "transfer" || row === "delayed", `invalid phase ${row}`);
  return row;
}

function isSubstantiveHelp(helpLevel: string): boolean {
  return !["process_prompt", "none", "neutral"].includes(helpLevel);
}

function scanText(path: string, value: string, findings: SecretScanContext[]): void {
  const patterns: Array<{ kind: string; regex: RegExp }> = [
    { kind: "api-key", regex: /\b(?:AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/ },
    { kind: "credential", regex: /\b(?:api[_-]?key|secret|password|access[_-]?token|refresh[_-]?token|cookie|authorization)\b/i },
    { kind: "private-key", regex: /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/ },
  ];
  if (/\/[^\s"']+/.test(value) && value.startsWith("/")) {
    findings.push({ path, value: value.slice(0, 120) });
  }
  for (const { kind, regex } of patterns) {
    if (regex.test(value)) findings.push({ path, value: `${kind}: ${value.slice(0, 120)}` });
  }
}

function scanJson(root: JsonValue, path = "root", findings: SecretScanContext[] = []): SecretScanContext[] {
  if (typeof root === "string") scanText(path, root, findings);
  else if (Array.isArray(root)) {
    for (const [index, item] of root.entries()) scanJson(item, `${path}[${index}]`, findings);
  } else if (root && typeof root === "object") {
    for (const [key, value] of Object.entries(root)) scanJson(value as JsonValue, `${path}.${key}`, findings);
  }
  return findings;
}

function buildSummaryJson(input: {
  readonly protocol: EvaluationProtocol;
  readonly pack: StudyPack;
  readonly report: ComparisonReport;
  readonly appVersion: string;
  readonly nodeVersion: string;
  readonly protocolHash: string;
  readonly packHash: string;
}): unknown {
  const { participantId: _participantId, ...reportWithoutParticipant } = input.report;
  const report = {
    ...reportWithoutParticipant,
    matchedSets: input.report.matchedSets.map((item) => {
      const { participantId: _metricsParticipantId, ...metrics } = item.metrics;
      return { ...item, metrics };
    }),
    variantSummaries: input.report.variantSummaries.map((summary) => ({
      ...summary,
      subjectiveFeedback: { ...summary.subjectiveFeedback, comments: [] },
    })),
  };
  return {
    exportMode: "summary",
    protocol: {
      protocolId: input.protocol.protocolId,
      version: input.protocol.version,
      title: input.protocol.title,
      domain: input.protocol.domain,
      hypothesis: input.protocol.hypothesis,
      primaryOutcome: input.protocol.primaryOutcome,
      secondaryOutcomes: [...input.protocol.secondaryOutcomes],
      retentionDelayDays: input.protocol.retentionDelayDays,
      sessionTimeBudgetMinutes: input.protocol.sessionTimeBudgetMinutes,
      policyVariants: input.protocol.policyVariants.map((variant) => ({
        policyId: variant.policyId,
        policyVersion: variant.policyVersion,
        description: variant.description,
        deterministicConfig: variant.deterministicConfig,
        runtimeSpec: variant.runtimeSpec,
        allowedPhases: [...variant.allowedPhases],
        allowedIntents: [...variant.allowedIntents],
        featureFlags: [...variant.featureFlags],
      })),
      allowedArtifactTypes: [...input.protocol.allowedArtifactTypes],
      scorerRequirements: input.protocol.scorerRequirements,
      createdAt: input.protocol.createdAt,
      updatedAt: input.protocol.updatedAt,
      metadata: input.protocol.metadata,
      definitionHash: input.protocolHash,
    },
    pack: {
      packId: input.pack.packId,
      version: input.pack.version,
      domain: input.pack.domain,
      sourceReferences: input.pack.sourceReferences.map((source) => sha256Hex(source)),
      matchedSets: input.pack.matchedSets.map((set) => ({
        matchedSetId: set.matchedSetId,
        description: set.description,
        microtopicIds: [...set.microtopicIds],
        equivalenceMetadata: {
          rationale: sha256Hex(set.equivalenceMetadata.rationale),
          sourceHashes: set.equivalenceMetadata.sourceHashes.map((source) => sha256Hex(source)),
          matchingDimensions: [...set.equivalenceMetadata.matchingDimensions],
        },
      })),
      microtopics: input.pack.microtopics.map((microtopic) => ({
        microtopicId: microtopic.microtopicId,
        title: microtopic.title,
        goalContract: sha256Hex(microtopic.goalContract),
        rubric: microtopic.rubric.map((criterion) => ({ id: criterion.id, descriptionHash: sha256Hex(criterion.description) })),
      })),
      rubric: input.pack.rubric.map((criterion) => ({ id: criterion.id, descriptionHash: sha256Hex(criterion.description) })),
      forms: {
        pretestForm: { formId: input.pack.pretestForm.formId, artifactType: input.pack.pretestForm.artifactType },
        immediateForm: { formId: input.pack.immediateForm.formId, artifactType: input.pack.immediateForm.artifactType },
        transferForm: { formId: input.pack.transferForm.formId, artifactType: input.pack.transferForm.artifactType },
        delayedForm: { formId: input.pack.delayedForm.formId, artifactType: input.pack.delayedForm.artifactType },
      },
      equivalenceMetadata: {
        rationale: sha256Hex(input.pack.equivalenceMetadata.rationale),
        sourceHashes: input.pack.equivalenceMetadata.sourceHashes.map((source) => sha256Hex(source)),
      },
      createdAt: input.pack.createdAt,
      updatedAt: input.pack.updatedAt,
      metadata: input.pack.metadata,
      definitionHash: input.packHash,
    },
    report,
    environment: {
      appVersion: input.appVersion,
      nodeVersion: input.nodeVersion,
    },
  };
}

function redactedResearchBundle(bundle: TrialBundle): unknown {
  const { participantId: _participantId, ...trial } = bundle.trial;
  return {
    trial,
    checkpoints: bundle.checkpoints,
    artifacts: bundle.artifacts.map((artifact) => ({
      artifactId: artifact.artifactId,
      checkpointId: artifact.checkpointId,
      kind: artifact.kind,
      provenance: artifact.provenance,
      contentHash: artifact.contentHash,
      content: artifact.content,
      createdAt: artifact.createdAt,
    })),
    observations: bundle.observations,
    incidents: bundle.incidents,
    feedback: bundle.feedback,
  };
}

export class EvaluationService {
  private readonly now: () => string;
  private readonly id: () => string;

  constructor(readonly store: EvaluationStore, options: EvaluationServiceOptions = {}) {
    this.now = options.now ?? nowIso;
    this.id = options.id ?? randomUUID;
  }

  validateProtocol(input: unknown) {
    return validateEvaluationProtocol(input);
  }

  validateStudyPack(input: unknown) {
    return validateStudyPackInput(input);
  }

  coachingSurface(packId: string, packVersion: number, microtopicId: string): StudyPackCoachingSurface {
    const pack = this.loadPack(packId, packVersion);
    const microtopic = pack.microtopics.find((item) => item.microtopicId === microtopicId);
    assert(microtopic, `Unknown microtopic ${microtopicId}`);
    return {
      packId: pack.packId,
      version: pack.version,
      domain: pack.domain,
      microtopicId: microtopic.microtopicId,
      title: microtopic.title,
      goalContract: microtopic.goalContract,
      allowedArtifactTypes: [...new Set([pack.pretestForm.artifactType, pack.immediateForm.artifactType, pack.transferForm.artifactType, pack.delayedForm.artifactType])],
    };
  }

  importProtocol(protocol: EvaluationProtocol): { readonly protocolHash: string } {
    const validation = validateEvaluationProtocol(protocol);
    if (!validation.ok || !validation.value) {
      throw new Error(validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
    }
    this.store.upsertProtocol(validation.value);
    return { protocolHash: this.store.hashProtocol(validation.value) };
  }

  importStudyPack(pack: StudyPack): { readonly packHash: string } {
    const validation = validateStudyPackInput(pack);
    if (!validation.ok || !validation.value) {
      throw new Error(validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
    }
    this.store.upsertStudyPack(validation.value);
    return { packHash: this.store.hashPack(validation.value) };
  }

  private loadProtocol(protocolId: string, version: number): EvaluationProtocol {
    const protocol = this.store.getProtocol(protocolId, version);
    assert(protocol, `Unknown protocol ${protocolId}@${version}`);
    return protocol;
  }

  private loadPack(packId: string, version: number): StudyPack {
    const pack = this.store.getPack(packId, version);
    assert(pack, `Unknown pack ${packId}@${version}`);
    return pack;
  }

  private loadTrialBundle(trialId: string): { bundle?: TrialBundle; anomalies: EvaluationAnomaly[] } {
    const anomalies: EvaluationAnomaly[] = [];
    const trialRow = this.store.db.prepare(`SELECT json FROM evaluation_trials WHERE trial_id = ?`).get(trialId) as { json?: string | null } | undefined;
    const trial = jsonRow<LearningTrial>(trialRow?.json ?? undefined, "trial", trialId, anomalies);
    if (!trial) return { anomalies };
    const protocolRow = this.store.db.prepare(`SELECT json FROM evaluation_protocols WHERE protocol_id = ? AND version = ?`).get(trial.protocolId, trial.protocolVersion) as { json?: string | null } | undefined;
    const packRow = this.store.db.prepare(`SELECT json FROM study_packs WHERE pack_id = ? AND version = ?`).get(trial.packId, trial.packVersion) as { json?: string | null } | undefined;
    const policyRow = this.store.db.prepare(`SELECT json FROM policy_variants WHERE policy_id = ? AND policy_version = ?`).get(trial.policyId, trial.policyVersion) as { json?: string | null } | undefined;
    const protocol = jsonRow<EvaluationProtocol>(protocolRow?.json ?? undefined, "protocol", `${trial.protocolId}@${trial.protocolVersion}`, anomalies);
    const pack = jsonRow<StudyPack>(packRow?.json ?? undefined, "pack", `${trial.packId}@${trial.packVersion}`, anomalies);
    const policy = jsonRow<PolicyVariant>(policyRow?.json ?? undefined, "policy", `${trial.policyId}@${trial.policyVersion}`, anomalies);
    if (!protocol || !pack || !policy) return { anomalies };
    let checkpoints: readonly Checkpoint[] = [];
    let artifacts: readonly LearnerArtifact[] = [];
    let observations: readonly InterventionObservation[] = [];
    let incidents: readonly CriticalIncident[] = [];
    let feedback: readonly SubjectiveFeedback[] = [];
    try {
      checkpoints = this.store.listCheckpointsByTrial(trial.trialId);
      artifacts = this.store.listArtifactsByTrial(trial.trialId);
      observations = this.store.listObservationsByTrial(trial.trialId);
      incidents = this.store.listIncidentsByTrial(trial.trialId);
      feedback = this.store.listFeedbackByTrial(trial.trialId);
    } catch (error) {
      anomalies.push({ code: "CORRUPT_EVALUATION_RECORD", detail: error instanceof Error ? error.message : String(error), entity: "trial-stream", entityId: trial.trialId });
      return { anomalies };
    }
    return { bundle: { trial, checkpoints, artifacts, observations, incidents, feedback, protocol, pack, policy }, anomalies };
  }

  generateAssignments(request: AssignmentRequest): { readonly trials: readonly LearningTrial[]; readonly generated: number } {
    assert(request.trialSubjectKind === "human" || request.trialSubjectKind === "synthetic", "trialSubjectKind must be human or synthetic");
    const protocol = this.loadProtocol(request.protocolId, request.protocolVersion);
    const pack = this.loadPack(request.packId, request.packVersion);
    const variantCount = protocol.policyVariants.length;
    assert(variantCount > 0, "protocol has no policy variants");
    const assigned: LearningTrial[] = [];
    const existing = new Map(this.store.listTrialsByProtocolPack(request.protocolId, request.protocolVersion, request.packId, request.packVersion, request.participantId).map((trial) => [trial.microtopicId, trial] as const));

    const order = [...pack.matchedSets].sort((left, right) => left.matchedSetId.localeCompare(right.matchedSetId));
    let assignmentOrder = 0;
    for (const matchedSet of order) {
      const rotation = Number.parseInt(sha256Hex([request.seed, request.participantId, request.packId, matchedSet.matchedSetId].join("|")).slice(0, 8), 16) % variantCount;
      for (const [index, microtopicId] of matchedSet.microtopicIds.entries()) {
        const key = microtopicId;
        const existingTrial = existing.get(key);
        if (existingTrial) {
          assert(existingTrial.trialSubjectKind === request.trialSubjectKind, `existing trial ${existingTrial.trialId} has immutable subject kind ${existingTrial.trialSubjectKind}`);
          assigned.push(existingTrial);
          assignmentOrder += 1;
          continue;
        }
        const microtopic = pack.microtopics.find((item) => item.microtopicId === microtopicId);
        assert(microtopic, `Unknown microtopic ${microtopicId}`);
        const policy = protocol.policyVariants[(rotation + index) % variantCount]!;
        const trial: LearningTrial = {
          trialId: makeTrialId(protocol.protocolId, protocol.version, pack.packId, pack.version, request.participantId, microtopic.microtopicId),
          trialSubjectKind: request.trialSubjectKind,
          participantId: request.participantId,
          protocolId: protocol.protocolId,
          protocolVersion: protocol.version,
          packId: pack.packId,
          packVersion: pack.version,
          policyId: policy.policyId,
          policyVersion: policy.policyVersion,
          microtopicId: microtopic.microtopicId,
          matchedSetId: matchedSet.matchedSetId,
          assignmentSeed: request.seed,
          assignmentOrder,
          phaseOrder: phaseOrder(),
          status: "planned",
          checkpoints: {},
          artifactIds: [],
        };
        this.store.upsertTrial(trial);
        assigned.push(trial);
        assignmentOrder += 1;
      }
    }
    return { trials: assigned, generated: assigned.length };
  }

  startTrial(trialId: string): { readonly trial: LearningTrial; readonly started: boolean } {
    const trial = this.store.getTrial(trialId);
    assert(trial, `Unknown trial ${trialId}`);
    assert(trial.trialSubjectKind !== "legacy-unclassified", `legacy-unclassified trial ${trialId} is read-only`);
    if (trial.startedAt) return { trial, started: false };
    const protocol = this.loadProtocol(trial.protocolId, trial.protocolVersion);
    const startedAt = this.now();
    const retentionDueAt = new Date(Date.parse(startedAt) + protocol.retentionDelayDays * 86_400_000).toISOString();
    const startedTrial: LearningTrial = { ...trial, startedAt, retentionDueAt, status: "started" };
    this.store.upsertTrial(startedTrial);
    return { trial: startedTrial, started: true };
  }

  resumeTrial(trialId: string): { readonly trial: LearningTrial; readonly resumed: boolean } {
    const trial = this.store.getTrial(trialId);
    assert(trial, `Unknown trial ${trialId}`);
    assert(trial.trialSubjectKind !== "legacy-unclassified", `legacy-unclassified trial ${trialId} is read-only`);
    return { trial, resumed: true };
  }

  executePolicy(trialId: string, input: PolicyRuntimeInput): PolicyRuntimeTrace {
    const trial = this.store.getTrial(trialId);
    assert(trial, `Unknown trial ${trialId}`);
    assert(trial.trialSubjectKind !== "legacy-unclassified", `legacy-unclassified trial ${trialId} is read-only`);
    const policy = this.store.getPolicyVariant(trial.policyId, trial.policyVersion);
    assert(policy, `Unknown policy ${trial.policyId}@${trial.policyVersion}`);
    return executePolicy(policy, input);
  }

  openCheckpoint(trialId: string, phase: CheckpointPhase): OpenCheckpointResult {
    const trial = this.store.getTrial(trialId);
    assert(trial, `Unknown trial ${trialId}`);
    assert(trial.trialSubjectKind !== "legacy-unclassified", `legacy-unclassified trial ${trialId} is read-only`);
    assert(phase !== "delayed" || trial.startedAt !== undefined, `delayed checkpoint requires a started trial ${trialId}`);
    const protocol = this.loadProtocol(trial.protocolId, trial.protocolVersion);
    const pack = this.loadPack(trial.packId, trial.packVersion);
    const form = pack[phaseToFormKey(phase)];
    assert(protocol.policyVariants.some((variant) => variant.policyId === trial.policyId && variant.policyVersion === trial.policyVersion), `Unknown policy ${trial.policyId}@${trial.policyVersion}`);
    const phaseCheckpoints = this.store.listCheckpointsByTrial(trialId).filter((checkpoint) => checkpoint.phase === phase);
    const latestPhaseCheckpoint = phaseCheckpoints.at(-1);
    let checkpointId = makeCheckpointId(trialId, phase);
    let existing = latestPhaseCheckpoint ?? this.store.getCheckpoint(checkpointId);
    if (existing && phase !== "delayed" && (existing.helpState.contaminated || existing.status === "invalid")) {
      checkpointId = makeCheckpointId(trialId, phase, phaseCheckpoints.length);
      existing = undefined;
    }
    const dueAt = phase === "delayed"
      ? trial.retentionDueAt ?? new Date(Date.parse(trial.startedAt ?? this.now()) + protocol.retentionDelayDays * 86_400_000).toISOString()
      : undefined;
    const isNotYetDue = dueAt !== undefined && Date.parse(this.now()) < Date.parse(dueAt);
    if (existing) {
      if (existing.phase === "delayed" && existing.dueAt && Date.parse(this.now()) >= Date.parse(existing.dueAt) && existing.status === "not-yet-due") {
        const presented: Checkpoint = { ...existing, status: "presented", presentedAt: this.now() };
        this.store.upsertCheckpoint(presented);
        this.store.upsertTrial({ ...trial, checkpoints: { ...trial.checkpoints, delayed: { checkpointId, status: "presented" } } });
        return {
          checkpoint: presented,
          form: { formId: form.formId, title: form.title, prompt: form.prompt, artifactType: form.artifactType },
        };
      }
      return {
        checkpoint: existing,
        form: existing.status === "not-yet-due"
          ? { formId: form.formId, title: "Delayed checkpoint", prompt: `Delayed checkpoint is not yet due; due at ${existing.dueAt ?? dueAt}`, artifactType: form.artifactType }
          : { formId: form.formId, title: form.title, prompt: form.prompt, artifactType: form.artifactType },
      };
    }
    const checkpoint: Checkpoint = {
      checkpointId,
      attemptId: `attempt-${sha256Hex([trialId, phase, phaseCheckpoints.length].join("|")).slice(0, 16)}`,
      trialId,
      phase,
      taskId: `${trial.microtopicId}:${phase}`,
      formId: form.formId,
      presentedAt: this.now(),
      helpState: {
        contaminated: false,
        helpCountByLevel: {},
        notes: [],
      },
      status: isNotYetDue ? "not-yet-due" : "presented",
      ...(dueAt ? { dueAt } : {}),
    };
    this.store.upsertCheckpoint(checkpoint);
    this.store.upsertTrial({
      ...trial,
      checkpoints: {
        ...trial.checkpoints,
        [phase]: { checkpointId, status: checkpoint.status },
      },
    });
    return {
      checkpoint,
      form: checkpoint.status === "not-yet-due"
        ? { formId: form.formId, title: "Delayed checkpoint", prompt: `Delayed checkpoint is not yet due; due at ${checkpoint.dueAt}`, artifactType: form.artifactType }
        : { formId: form.formId, title: form.title, prompt: form.prompt, artifactType: form.artifactType },
    };
  }

  private recordLearnerArtifact(checkpointId: string, input: {
    readonly kind: "text" | "voice" | "map" | "canvas";
    readonly content: string;
    readonly provenance: Exclude<LearnerArtifactProvenance, "legacy-unclassified">;
    readonly provenanceNote?: string;
  }): { readonly artifact: LearnerArtifact; readonly checkpoint: Checkpoint } {
    const checkpoint = this.store.getCheckpoint(checkpointId);
    assert(checkpoint, `Unknown checkpoint ${checkpointId}`);
    const trial = this.store.getTrial(checkpoint.trialId);
    assert(trial, `Unknown trial ${checkpoint.trialId}`);
    const humanIngress = input.provenance === "trusted-human";
    assert(trial.trialSubjectKind !== "legacy-unclassified", `legacy-unclassified trial ${trial.trialId} is read-only`);
    assert(
      (trial.trialSubjectKind === "human" && humanIngress)
        || (trial.trialSubjectKind === "synthetic" && !humanIngress),
      humanIngress
        ? `trusted-human ingress rejects ${trial.trialSubjectKind} trial ${trial.trialId}`
        : `synthetic ingress rejects ${trial.trialSubjectKind} trial ${trial.trialId}`,
    );
    const protocol = this.loadProtocol(trial.protocolId, trial.protocolVersion);
    assert(protocol.allowedArtifactTypes.includes(input.kind), `artifact kind ${input.kind} is not allowed`);
    assert(!(checkpoint.phase === "delayed" && checkpoint.dueAt !== undefined && Date.parse(this.now()) < Date.parse(checkpoint.dueAt)), `delayed checkpoint ${checkpointId} is not yet due`);
    const existingArtifact = this.store.listArtifactsByTrial(trial.trialId).find((artifact) => artifact.checkpointId === checkpointId);
    const hash = contentHash(input.content);
    if (existingArtifact) {
      if (existingArtifact.contentHash !== hash) throw new Error(`checkpoint ${checkpointId} already has a different artifact`);
      if (existingArtifact.provenance !== input.provenance) throw new Error(`checkpoint ${checkpointId} already has an artifact with immutable provenance ${existingArtifact.provenance}`);
      return { artifact: existingArtifact, checkpoint };
    }
    const artifact: LearnerArtifact = {
      artifactId: makeArtifactId(checkpointId, hash),
      checkpointId,
      provenance: input.provenance,
      kind: input.kind,
      content: input.content,
      contentHash: hash,
      createdAt: this.now(),
    };
    this.store.upsertArtifact(artifact);
    const trustedLearnerProvenance: TrustedLearnerProvenance | undefined = humanIngress
      ? {
          provenanceId: `prov-${sha256Hex([checkpointId, artifact.artifactId].join("|")).slice(0, 16)}`,
          source: "trusted-local-human",
          verifiedAt: this.now(),
          ...(input.provenanceNote ? { note: input.provenanceNote } : {}),
        }
      : undefined;
    const updatedCheckpoint: Checkpoint = {
      ...checkpoint,
      learnerArtifactRef: { artifactId: artifact.artifactId, contentHash: artifact.contentHash, kind: artifact.kind },
      ...(trustedLearnerProvenance ? { trustedLearnerProvenance } : {}),
      status: checkpoint.status,
    };
    this.store.upsertCheckpoint(updatedCheckpoint);
    this.store.upsertTrial({
      ...trial,
      artifactIds: trial.artifactIds.includes(artifact.artifactId) ? trial.artifactIds : [...trial.artifactIds, artifact.artifactId],
      checkpoints: {
        ...trial.checkpoints,
        [checkpoint.phase]: { checkpointId, status: checkpoint.status },
      },
    });
    return { artifact, checkpoint: updatedCheckpoint };
  }

  recordTrustedLearnerArtifact(checkpointId: string, input: { readonly kind: "text" | "voice" | "map" | "canvas"; readonly content: string; readonly provenanceNote?: string }, capability?: symbol): { readonly artifact: LearnerArtifact; readonly checkpoint: Checkpoint } {
    assert(capability === TRUSTED_HUMAN_INGRESS, "trusted human artifact ingress is capability-bound");
    return this.recordLearnerArtifact(checkpointId, { ...input, provenance: "trusted-human" });
  }

  recordSyntheticLearnerArtifact(checkpointId: string, input: {
    readonly kind: "text" | "voice" | "map" | "canvas";
    readonly content: string;
    readonly provenance: "deterministic-fixture" | "ai-simulation";
    readonly provenanceNote?: string;
  }, capability?: symbol): { readonly artifact: LearnerArtifact; readonly checkpoint: Checkpoint } {
    assert(capability === SYNTHETIC_TEST_INGRESS, "synthetic artifact ingress is test-capability-bound");
    return this.recordLearnerArtifact(checkpointId, input);
  }

  trustedHumanIngress(): TrustedEvaluationIngress {
    return new TrustedEvaluationIngress(this);
  }

  syntheticTestIngress(provenance: "deterministic-fixture" | "ai-simulation"): SyntheticEvaluationIngress {
    return new SyntheticEvaluationIngress(this, provenance);
  }

  recordInterventionObservation(input: {
    readonly trialId: string;
    readonly checkpointId?: string;
    readonly pedagogicalIntent: string;
    readonly technique: string;
    readonly targetCriterionId?: string;
    readonly gapId?: string;
    readonly helpLevel: string;
    readonly aiOutputReference?: { readonly artifactId?: string; readonly contentHash?: string; readonly modality?: "text" | "voice" | "map" | "canvas" };
    readonly learnerResponseReference?: { readonly artifactId?: string; readonly contentHash?: string; readonly modality?: "text" | "voice" | "map" | "canvas" };
    readonly phase: CheckpointPhase | "session";
    readonly observedAt?: string;
    readonly endedAt?: string;
    readonly responseIntervalMs?: number;
    readonly aiOutputWords?: number;
    readonly aiOutputCharacters?: number;
    readonly aiSpeechDurationMs?: number;
    readonly learnerCaptureDurationMs?: number;
    readonly technicalWaitMs?: number;
    readonly sessionElapsedMs?: number;
    readonly modality?: "text" | "voice" | "map" | "canvas";
    readonly turnId?: string;
    readonly artifactId?: string;
    readonly learnerNote?: string;
  }): { readonly observation: InterventionObservation; readonly checkpoint?: Checkpoint } {
    const trial = this.store.getTrial(input.trialId);
    assert(trial, `Unknown trial ${input.trialId}`);
    assert(trial.trialSubjectKind !== "legacy-unclassified", `legacy-unclassified trial ${trial.trialId} is read-only`);
    const checkpoint = input.checkpointId ? this.store.getCheckpoint(input.checkpointId) : undefined;
    if (input.checkpointId) {
      assert(checkpoint, `Unknown checkpoint ${input.checkpointId}`);
      assert(checkpoint.trialId === input.trialId, `checkpoint ${input.checkpointId} does not belong to trial ${input.trialId}`);
      assert(checkpoint.phase === input.phase, `intervention phase ${input.phase} does not match checkpoint phase ${checkpoint.phase}`);
    }
    const observedAt = input.observedAt ?? this.now();
    const observationId = makeObservationId(input.trialId, input.phase, input.helpLevel, input.technique, observedAt);
    const existing = this.store.listObservationsByTrial(input.trialId).find((observation) => observation.observationId === observationId);
    if (existing) {
      return checkpoint ? { observation: existing, checkpoint } : { observation: existing };
    }
    if (checkpoint) {
      assert(checkpoint.status === "presented", `checkpoint ${checkpoint.checkpointId} is not accepting intervention observations`);
      assert(checkpoint.learnerArtifactRef === undefined, `checkpoint ${checkpoint.checkpointId} already has a learner artifact`);
    }
    const observation: InterventionObservation = {
      observationId,
      trialId: input.trialId,
      ...(input.checkpointId ? { checkpointId: input.checkpointId } : {}),
      pedagogicalIntent: input.pedagogicalIntent,
      technique: input.technique,
      ...(input.targetCriterionId ? { targetCriterionId: input.targetCriterionId } : {}),
      ...(input.gapId ? { gapId: input.gapId } : {}),
      helpLevel: input.helpLevel,
      ...(input.aiOutputReference ? { aiOutputReference: input.aiOutputReference } : {}),
      ...(input.learnerResponseReference ? { learnerResponseReference: input.learnerResponseReference } : {}),
      phase: input.phase,
      observedAt,
      ...(input.endedAt ? { endedAt: input.endedAt } : {}),
      ...(input.responseIntervalMs !== undefined ? { responseIntervalMs: input.responseIntervalMs } : {}),
      ...(input.aiOutputWords !== undefined ? { aiOutputWords: input.aiOutputWords } : {}),
      ...(input.aiOutputCharacters !== undefined ? { aiOutputCharacters: input.aiOutputCharacters } : {}),
      ...(input.aiSpeechDurationMs !== undefined ? { aiSpeechDurationMs: input.aiSpeechDurationMs } : {}),
      ...(input.learnerCaptureDurationMs !== undefined ? { learnerCaptureDurationMs: input.learnerCaptureDurationMs } : {}),
      ...(input.technicalWaitMs !== undefined ? { technicalWaitMs: input.technicalWaitMs } : {}),
      ...(input.sessionElapsedMs !== undefined ? { sessionElapsedMs: input.sessionElapsedMs } : {}),
      ...(input.modality ? { modality: input.modality } : {}),
      ...(input.turnId ? { turnId: input.turnId } : {}),
      ...(input.artifactId ? { artifactId: input.artifactId } : {}),
      ...(input.learnerNote ? { learnerNote: input.learnerNote } : {}),
    };
    this.store.upsertObservation(observation);
    if (checkpoint) {
      const helpCountByLevel = { ...checkpoint.helpState.helpCountByLevel };
      helpCountByLevel[input.helpLevel] = (helpCountByLevel[input.helpLevel] ?? 0) + 1;
      const contaminated = checkpoint.helpState.contaminated || isSubstantiveHelp(input.helpLevel);
      const technicalWaitMs = (checkpoint.helpState.technicalWaitMs ?? 0) + (input.technicalWaitMs ?? 0);
      const notes = input.learnerNote ? [...checkpoint.helpState.notes, input.learnerNote] : checkpoint.helpState.notes;
      this.store.upsertCheckpoint({
        ...checkpoint,
        helpState: {
          contaminated,
          helpCountByLevel,
          ...(technicalWaitMs > 0 ? { technicalWaitMs } : {}),
          notes,
        },
      });
      const updatedCheckpoint = this.store.getCheckpoint(checkpoint.checkpointId);
      return updatedCheckpoint ? { observation, checkpoint: updatedCheckpoint } : { observation };
    }
    return { observation };
  }

  recordCriticalIncident(input: {
    readonly trialId: string;
    readonly checkpointId?: string;
    readonly turnId?: string;
    readonly artifactId?: string;
    readonly category: CriticalIncidentCategory;
    readonly learnerNote?: string;
    readonly createdAt?: string;
  }): { readonly incident: CriticalIncident } {
    const trial = this.store.getTrial(input.trialId);
    assert(trial, `Unknown trial ${input.trialId}`);
    assert(trial.trialSubjectKind !== "legacy-unclassified", `legacy-unclassified trial ${trial.trialId} is read-only`);
    const createdAt = input.createdAt ?? this.now();
    const reference = input.checkpointId ?? input.turnId ?? input.artifactId ?? createdAt;
    const incidentId = makeIncidentId(input.trialId, input.category, createdAt, reference);
    const existing = this.store.listIncidentsByTrial(input.trialId).find((incident) => incident.incidentId === incidentId);
    if (existing) return { incident: existing };
    const incident: CriticalIncident = {
      incidentId,
      trialId: input.trialId,
      ...(input.checkpointId ? { checkpointId: input.checkpointId } : {}),
      ...(input.turnId ? { turnId: input.turnId } : {}),
      ...(input.artifactId ? { artifactId: input.artifactId } : {}),
      category: input.category,
      ...(input.learnerNote ? { learnerNote: input.learnerNote } : {}),
      createdAt,
    };
    this.store.upsertIncident(incident);
    return { incident };
  }

  recordSubjectiveFeedback(input: {
    readonly trialId: string;
    readonly clarity: number;
    readonly load: number;
    readonly usefulness: number;
    readonly confidence: number;
    readonly comment?: string;
    readonly createdAt?: string;
  }): { readonly feedback: SubjectiveFeedback } {
    const trial = this.store.getTrial(input.trialId);
    assert(trial, `Unknown trial ${input.trialId}`);
    assert(trial.trialSubjectKind !== "legacy-unclassified", `legacy-unclassified trial ${trial.trialId} is read-only`);
    const createdAt = input.createdAt ?? this.now();
    const feedbackId = makeFeedbackId(input.trialId, createdAt, input.comment ?? "");
    const existing = this.store.listFeedbackByTrial(input.trialId).find((feedback) => feedback.feedbackId === feedbackId);
    if (existing) return { feedback: existing };
    const feedback: SubjectiveFeedback = {
      feedbackId,
      trialId: input.trialId,
      clarity: input.clarity,
      load: input.load,
      usefulness: input.usefulness,
      confidence: input.confidence,
      ...(input.comment ? { comment: input.comment } : {}),
      createdAt,
    };
    this.store.upsertFeedback(feedback);
    return { feedback };
  }

  assessCheckpoint(checkpointId: string, scorer: Scorer, input?: { readonly vector?: CheckpointRubricVector }): { readonly checkpoint: Checkpoint; readonly scorerKind: ScorerKind } {
    const checkpoint = this.store.getCheckpoint(checkpointId);
    assert(checkpoint, `Unknown checkpoint ${checkpointId}`);
    const trial = this.store.getTrial(checkpoint.trialId);
    assert(trial, `Unknown trial ${checkpoint.trialId}`);
    assert(trial.trialSubjectKind !== "legacy-unclassified", `legacy-unclassified trial ${trial.trialId} is read-only`);
    const protocol = this.loadProtocol(trial.protocolId, trial.protocolVersion);
    const pack = this.loadPack(trial.packId, trial.packVersion);
    if (checkpoint.scorer || checkpoint.assessedAt) {
      return { checkpoint, scorerKind: checkpoint.scorer?.scorerKind ?? scorer.scorerKind };
    }
    const policy = protocol.policyVariants.find((variant) => variant.policyId === trial.policyId && variant.policyVersion === trial.policyVersion);
    assert(policy, `Unknown policy ${trial.policyId}@${trial.policyVersion}`);
    assert(protocol.scorerRequirements.allowedScorers.includes(scorer.scorerKind), `scorer kind ${scorer.scorerKind} is not allowed by protocol`);
    assert(!(input?.vector && scorer.scorerKind !== "trusted-human" && scorer.scorerKind !== "ai-semantic"), "manual vector override is only allowed for trusted-human or ai-semantic scorers");
    const artifact = checkpoint.learnerArtifactRef ? this.store.getArtifact(checkpoint.learnerArtifactRef.artifactId) : undefined;
    if (!artifact) throw new Error(`checkpoint ${checkpointId} has no learner artifact`);
    const form = pack[phaseToFormKey(checkpoint.phase)];
    const rubric = pack.rubric;
    const scorerMetadata = {
      scorerKind: scorer.scorerKind,
      scorerId: scorer.scorerId,
      scorerVersion: scorer.scorerVersion,
      assessedAt: this.now(),
    };
    const dueAt = checkpoint.dueAt;
    const assessedAt = scorerMetadata.assessedAt;
    const notYetDue = checkpoint.phase === "delayed" && dueAt !== undefined && Date.parse(assessedAt) < Date.parse(dueAt);
    if (notYetDue) {
      const unchanged = checkpoint.status === "not-yet-due" ? checkpoint : { ...checkpoint, status: "not-yet-due" as const };
      if (unchanged !== checkpoint) this.store.upsertCheckpoint(unchanged);
      return { checkpoint: unchanged, scorerKind: scorer.scorerKind };
    }
    const taskSnapshot = {
      protocolId: protocol.protocolId,
      protocolVersion: protocol.version,
      packId: pack.packId,
      packVersion: pack.version,
      trialId: trial.trialId,
      checkpointId: checkpoint.checkpointId,
      phase: checkpoint.phase,
      taskId: checkpoint.taskId,
      formId: form.formId,
      prompt: form.prompt,
      presentedAt: checkpoint.presentedAt,
      ...(checkpoint.dueAt ? { dueAt: checkpoint.dueAt } : {}),
      microtopicId: trial.microtopicId,
      matchedSetId: trial.matchedSetId,
    };
    const vector = scorer.scorerKind === "ai-semantic" && input?.vector
      ? input.vector
      : scorer.score({
          taskSnapshot,
          artifact,
          rubric,
          reference: {
            scoringGuidance: "Use only the immutable task snapshot and rubric; missing evidence remains missing.",
          },
          scorerMetadata,
        });
    assert(validateRubricVector(vector, rubric), "scorer returned an invalid rubric vector");
    if (input?.vector) assert(validateRubricVector(input.vector, rubric), "manual rubric vector is invalid");
    const rubricResultVector = input?.vector ? input.vector : vector;
    const provenanceEligible = trial.trialSubjectKind === "human"
      ? artifact.provenance === "trusted-human" && checkpoint.trustedLearnerProvenance !== undefined
      : (artifact.provenance === "deterministic-fixture" || artifact.provenance === "ai-simulation")
        && checkpoint.trustedLearnerProvenance === undefined;
    const status: CheckpointStatus = notYetDue
      ? "not-yet-due"
      : checkpoint.helpState.contaminated || !provenanceEligible
        ? "invalid"
        : rubricResultVector.unmetCount === 0 && rubricResultVector.unknownCount === 0
          ? "valid"
          : "invalid";
    const assessed: Checkpoint = {
      ...checkpoint,
      rubricResultVector,
      scorer: {
        scorerKind: scorer.scorerKind,
        scorerId: scorer.scorerId,
        scorerVersion: scorer.scorerVersion,
        rubricVersion: protocol.scorerRequirements.rubricVersion,
      },
      assessedAt,
      status,
    };
    this.store.upsertCheckpoint(assessed);
    const trialCheckpoints = this.store.listCheckpointsByTrial(trial.trialId);
    const allPhases = phaseOrder();
    const ready = allPhases.every((phase) => trialCheckpoints.some((item) => item.phase === phase && item.status === "valid"));
    if (ready && trial.status !== "completed") {
      this.store.upsertTrial({ ...trial, status: "completed", endedAt: assessedAt, checkpoints: this.mergeCheckpointLinks(trial, assessed) });
    } else {
      this.store.upsertTrial({ ...trial, checkpoints: this.mergeCheckpointLinks(trial, assessed) });
    }
    return { checkpoint: assessed, scorerKind: scorer.scorerKind };
  }

  private mergeCheckpointLinks(trial: LearningTrial, checkpoint: Checkpoint): Partial<Record<CheckpointPhase, TrialCheckpointLink>> {
    return {
      ...trial.checkpoints,
      [checkpoint.phase]: { checkpointId: checkpoint.checkpointId, status: checkpoint.status },
    };
  }

  trialStatus(trialId: string): TrialStatusResult {
    const bundle = this.loadTrialBundle(trialId);
    if (!bundle.bundle) throw new Error(`Unknown trial ${trialId}`);
    const metrics = computeTrialMetrics(bundle.bundle, this.now());
    return {
      trial: bundle.bundle.trial,
      metrics,
      checkpoints: bundle.bundle.checkpoints,
      artifacts: bundle.bundle.artifacts,
      observations: bundle.bundle.observations,
      incidents: bundle.bundle.incidents,
      feedback: bundle.bundle.feedback,
      anomalies: bundle.anomalies,
    };
  }

  deleteParticipantData(participantId: string, confirmation: string): EvaluationDeletionResult {
    return this.store.deleteParticipantData(participantId, confirmation);
  }

  showDueDelayedTests(): readonly { readonly trialId: string; readonly checkpointId: string; readonly dueAt: string; readonly status: CheckpointStatus }[] {
    const now = Date.parse(this.now());
    return this.store.listTrials().flatMap((trial) => {
      if (trial.trialSubjectKind === "legacy-unclassified") return [] as const;
      const checkpoint = this.store.listCheckpointsByTrial(trial.trialId).find((item) => item.phase === "delayed");
      if (!checkpoint?.dueAt || Date.parse(checkpoint.dueAt) > now) return [] as const;
      if (checkpoint.status === "valid") return [] as const;
      return [{ trialId: trial.trialId, checkpointId: checkpoint.checkpointId, dueAt: checkpoint.dueAt, status: checkpoint.status }];
    });
  }

  private assertHumanBundleProvenance(bundle: TrialBundle): void {
    assert(bundle.trial.trialSubjectKind === "human", `trial ${bundle.trial.trialId} is excluded from human comparison`);
    const artifactById = new Map(bundle.artifacts.map((artifact) => [artifact.artifactId, artifact] as const));
    for (const artifact of bundle.artifacts) {
      assert(artifact.provenance === "trusted-human", `trial ${bundle.trial.trialId} contains non-human artifact provenance ${artifact.provenance}`);
    }
    for (const checkpoint of bundle.checkpoints) {
      if (!checkpoint.learnerArtifactRef) continue;
      const artifact = artifactById.get(checkpoint.learnerArtifactRef.artifactId);
      assert(artifact?.provenance === "trusted-human" && checkpoint.trustedLearnerProvenance !== undefined, `trial ${bundle.trial.trialId} has an untrusted learner artifact boundary`);
    }
  }

  private assertSyntheticBundleProvenance(bundle: TrialBundle): void {
    assert(bundle.trial.trialSubjectKind === "synthetic", `trial ${bundle.trial.trialId} is excluded from synthetic behavioral report`);
    const artifactById = new Map(bundle.artifacts.map((artifact) => [artifact.artifactId, artifact] as const));
    for (const artifact of bundle.artifacts) {
      assert(artifact.provenance === "deterministic-fixture" || artifact.provenance === "ai-simulation", `trial ${bundle.trial.trialId} contains non-synthetic artifact provenance ${artifact.provenance}`);
    }
    for (const checkpoint of bundle.checkpoints) {
      if (!checkpoint.learnerArtifactRef) continue;
      const artifact = artifactById.get(checkpoint.learnerArtifactRef.artifactId);
      assert(
        (artifact?.provenance === "deterministic-fixture" || artifact?.provenance === "ai-simulation")
          && checkpoint.trustedLearnerProvenance === undefined,
        `trial ${bundle.trial.trialId} has a human or unclassified learner artifact boundary`,
      );
    }
  }

  private loadHumanExportBundles(input: {
    readonly protocolId: string;
    readonly protocolVersion: number;
    readonly packId: string;
    readonly packVersion: number;
    readonly participantId: string;
    readonly trialIds?: readonly string[];
  }): readonly TrialBundle[] {
    const trialRows = input.trialIds
      ? input.trialIds.map((trialId) => ({ trialId }))
      : this.store.listTrialsByProtocolPackAndSubjectKind(input.protocolId, input.protocolVersion, input.packId, input.packVersion, "human", input.participantId).map((trial) => ({ trialId: trial.trialId }));
    const bundles: TrialBundle[] = [];
    for (const row of trialRows) {
      const entry = this.loadTrialBundle(row.trialId);
      assert(entry.bundle, `Unknown or corrupt trial ${row.trialId}`);
      assert(
        entry.bundle.trial.protocolId === input.protocolId
          && entry.bundle.trial.protocolVersion === input.protocolVersion
          && entry.bundle.trial.packId === input.packId
          && entry.bundle.trial.packVersion === input.packVersion
          && entry.bundle.trial.participantId === input.participantId,
        `trial ${row.trialId} is outside the requested export scope`,
      );
      this.assertHumanBundleProvenance(entry.bundle);
      bundles.push(entry.bundle);
    }
    return bundles;
  }

  comparisonReport(protocolId: string, protocolVersion: number, packId: string, packVersion: number, participantId: string, seed: string): ComparisonReport {
    const protocol = this.loadProtocol(protocolId, protocolVersion);
    const pack = this.loadPack(packId, packVersion);
    const trials = this.store.listTrialsByProtocolPackAndSubjectKind(protocolId, protocolVersion, packId, packVersion, "human", participantId);
    const bundles: TrialBundle[] = [];
    for (const trial of trials) {
      const entry = this.loadTrialBundle(trial.trialId);
      if (entry.bundle) {
        this.assertHumanBundleProvenance(entry.bundle);
        bundles.push(entry.bundle);
      }
    }
    return buildComparisonReport({ protocol, pack, seed, participantId, generatedAt: this.now(), bundles });
  }

  syntheticBehavioralReport(protocolId: string, protocolVersion: number, packId: string, packVersion: number, participantId: string, seed: string): SyntheticBehavioralReport {
    const protocol = this.loadProtocol(protocolId, protocolVersion);
    const pack = this.loadPack(packId, packVersion);
    const trials = this.store.listTrialsByProtocolPackAndSubjectKind(protocolId, protocolVersion, packId, packVersion, "synthetic", participantId);
    const bundles: TrialBundle[] = [];
    for (const trial of trials) {
      const entry = this.loadTrialBundle(trial.trialId);
      if (entry.bundle) {
        this.assertSyntheticBundleProvenance(entry.bundle);
        bundles.push(entry.bundle);
      }
    }
    return buildSyntheticBehavioralReport({ protocol, pack, seed, participantId, generatedAt: this.now(), bundles });
  }

  previewExport(input: {
    readonly mode: "summary" | "research";
    readonly protocolId: string;
    readonly protocolVersion: number;
    readonly packId: string;
    readonly packVersion: number;
    readonly participantId: string;
    readonly seed: string;
    readonly outputDirectory: string;
    readonly trialIds?: readonly string[];
  }): ExportPreview {
    const protocol = this.loadProtocol(input.protocolId, input.protocolVersion);
    const pack = this.loadPack(input.packId, input.packVersion);
    const trials = this.loadHumanExportBundles(input);
    const report = buildComparisonReport({ protocol, pack, seed: input.seed, participantId: input.participantId, generatedAt: this.now(), bundles: trials });
    const files: ExportPreviewFile[] = input.mode === "summary"
      ? [{ path: "summary.json", description: "Privacy-first summary export" }, { path: "manifest.json", description: "File manifest" }]
      : [
          { path: "summary.json", description: "Summary export" },
          { path: "manifest.json", description: "Exact file manifest" },
          { path: "consent.json", description: "Consent and acknowledgement record" },
          { path: "redaction-report.json", description: "Redaction and scan report" },
          ...trials.map((bundle) => ({ path: `trials/${bundle.trial.trialId}.json`, description: `Selected trial ${bundle.trial.trialId}` })),
        ];
    const summary = buildSummaryJson({ protocol, pack, report, appVersion: "0.2.0", nodeVersion: process.version, protocolHash: this.store.hashProtocol(protocol), packHash: this.store.hashPack(pack) });
    const findings = input.mode === "research"
      ? scanJson(summary as JsonValue)
      : [];
    const redactedBundles = trials.map((bundle) => redactedResearchBundle(bundle));
    const selectedStrings = input.mode === "research"
      ? scanJson({ trials: redactedBundles } as unknown as JsonValue)
      : [];
    const allFindings = [...findings, ...selectedStrings];
    const summaryText = JSON.stringify(summary, null, 2);
    const trialTexts = input.mode === "research"
      ? Object.fromEntries(trials.map((bundle) => [`trials/${bundle.trial.trialId}.json`, JSON.stringify(redactedResearchBundle(bundle), null, 2)]))
      : {};
    const fileHashes: Record<string, string> = {
      "summary.json": sha256Hex(summaryText),
      ...Object.fromEntries(Object.entries(trialTexts).map(([path, text]) => [path, sha256Hex(text)])),
    };
    const snapshotHash = sha256Hex(JSON.stringify({
      protocolHash: this.store.hashProtocol(protocol),
      packHash: this.store.hashPack(pack),
      report,
      selectedTrials: trials.map((bundle) => bundle.trial),
      selectedCheckpoints: trials.flatMap((bundle) => bundle.checkpoints),
      selectedArtifacts: trials.flatMap((bundle) => bundle.artifacts),
      selectedObservations: trials.flatMap((bundle) => bundle.observations),
      selectedIncidents: trials.flatMap((bundle) => bundle.incidents),
      selectedFeedback: trials.flatMap((bundle) => bundle.feedback),
      fileHashes,
    }));
    const previewId = sha256Hex([input.mode, input.protocolId, input.protocolVersion, input.packId, input.packVersion, input.participantId, input.seed, input.trialIds?.join(",") ?? "all", snapshotHash].join("|"));
    return {
      exportId: previewId,
      mode: input.mode,
      generatedAt: this.now(),
      consentRequired: input.mode === "research",
      targetDirectory: input.outputDirectory,
      files,
      includedFields: input.mode === "summary"
        ? ["protocol IDs/versions", "pack IDs/versions", "aggregated rubric vectors", "durations and counts", "critical incident categories", "missing-data indicators", "environment/app version", "hashes instead of raw materials"]
        : ["summary fields", "selected pseudonymized artifacts/events", "manifest", "consent record", "export timestamp", "redaction report"],
      excludedFields: input.mode === "summary"
        ? ["raw conversation", "learner artifact text", "raw voice", "absolute paths", "names/emails", "secrets"]
        : ["unselected raw materials"],
      secretsScan: {
        passed: allFindings.length === 0,
        findings: allFindings.map((finding) => ({ kind: "potential-secret", path: finding.path, sample: finding.value })),
      },
      snapshotHash,
      fileManifest: files.map((file) => file.path),
      fileHashes,
    };
  }

  exportBundle(input: {
    readonly mode: "summary" | "research";
    readonly protocolId: string;
    readonly protocolVersion: number;
    readonly packId: string;
    readonly packVersion: number;
    readonly participantId: string;
    readonly seed: string;
    readonly outputDirectory: string;
    readonly previewId?: string;
    readonly confirm?: boolean;
    readonly trialIds?: readonly string[];
  }): ExportResult {
    const preview = this.previewExport(input);
    if (!input.previewId || input.previewId !== preview.exportId) {
      throw new Error("export requires previewId from an unchanged preview");
    }
    if (input.mode === "research") {
      if (input.confirm !== true) throw new Error("research export requires explicit confirmation");
      if (!preview.secretsScan.passed) throw new Error(`research export blocked by sensitive content: ${preview.secretsScan.findings.map((item) => `${item.path}: ${item.sample}`).join("; ")}`);
    }
    mkdirSync(input.outputDirectory, { recursive: true });
    const protocol = this.loadProtocol(input.protocolId, input.protocolVersion);
    const pack = this.loadPack(input.packId, input.packVersion);
    const trials = this.loadHumanExportBundles(input);
    const report = buildComparisonReport({ protocol, pack, seed: input.seed, participantId: input.participantId, generatedAt: this.now(), bundles: trials });
    const summary = buildSummaryJson({ protocol, pack, report, appVersion: "0.2.0", nodeVersion: process.version, protocolHash: this.store.hashProtocol(protocol), packHash: this.store.hashPack(pack) });
    const filesWritten: string[] = [];
    writeFileSync(join(input.outputDirectory, "summary.json"), JSON.stringify(summary, null, 2));
    filesWritten.push("summary.json");
    writeFileSync(join(input.outputDirectory, "manifest.json"), JSON.stringify({ exportId: preview.exportId, snapshotHash: preview.snapshotHash, mode: input.mode, files: preview.fileManifest, fileHashes: preview.fileHashes, generatedAt: preview.generatedAt }, null, 2));
    filesWritten.push("manifest.json");
    if (input.mode === "research") {
      const consent = { exportId: preview.exportId, acknowledged: true, ackText: "I understand this export contains pseudonymized data and may include selected artifacts/events.", exportAt: this.now() };
      writeFileSync(join(input.outputDirectory, "consent.json"), JSON.stringify(consent, null, 2));
      filesWritten.push("consent.json");
      const redactionReport = {
        findings: preview.secretsScan.findings,
        note: "Pseudonymized does not mean anonymized.",
      };
      writeFileSync(join(input.outputDirectory, "redaction-report.json"), JSON.stringify(redactionReport, null, 2));
      filesWritten.push("redaction-report.json");
      for (const bundle of trials) {
        const file = join(input.outputDirectory, "trials", `${bundle.trial.trialId}.json`);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, JSON.stringify(redactedResearchBundle(bundle), null, 2));
        filesWritten.push(relative(input.outputDirectory, file));
      }
    }
    return { exportId: preview.exportId, mode: input.mode, outputDirectory: input.outputDirectory, generatedAt: preview.generatedAt, files: filesWritten };
  }
}

/** Capability-bound ingress for actual learner artifacts. Keep this out of any
 * AI-facing tool registry; the service's public writer rejects calls without
 * the module-private capability. */
export class TrustedEvaluationIngress {
  constructor(private readonly service: EvaluationService) {}

  recordArtifact(checkpointId: string, input: { readonly kind: "text" | "voice" | "map" | "canvas"; readonly content: string; readonly provenanceNote?: string }): { readonly artifact: LearnerArtifact; readonly checkpoint: Checkpoint } {
    return this.service.recordTrustedLearnerArtifact(checkpointId, input, TRUSTED_HUMAN_INGRESS);
  }
}

/** Synthetic/test-only ingress. Provenance is fixed when the capability is
 * created and cannot be supplied by a learner/tutor-facing writer. */
export class SyntheticEvaluationIngress {
  constructor(private readonly service: EvaluationService, private readonly provenance: "deterministic-fixture" | "ai-simulation") {}

  recordArtifact(checkpointId: string, input: { readonly kind: "text" | "voice" | "map" | "canvas"; readonly content: string; readonly provenanceNote?: string }): { readonly artifact: LearnerArtifact; readonly checkpoint: Checkpoint } {
    return this.service.recordSyntheticLearnerArtifact(checkpointId, { ...input, provenance: this.provenance }, SYNTHETIC_TEST_INGRESS);
  }
}
