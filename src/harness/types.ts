export const HARNESS_SCHEMA_VERSION = 3 as const;
export const PRE_HARDENING_SCHEMA_VERSION = 2 as const;

export type HarnessActor = "learner" | "engine" | "ai" | "human_reviewer";
export type Subject = "general" | "history" | "law" | "economics";
export type AttemptKind = "baseline" | "retrieval" | "transfer";
export type ArtifactAuthor = "learner" | "ai" | "shared";
export type HelpKind = "process_prompt" | "content_hint" | "worked_example" | "answer";
export type HypothesisMode = "prediction" | "mechanism" | "causal" | "contrast" | "boundary" | "method-selection";

export interface HypothesisScaffold {
  readonly phase: "commit" | "revise";
  readonly mode: HypothesisMode;
  readonly question: string;
  readonly responseFrame: readonly string[];
  readonly targetIds: readonly string[];
  readonly gapId?: string;
  readonly attemptId?: string;
  readonly disclosurePolicy: "commit-before-feedback";
}

export interface HypothesisScaffoldRequest {
  readonly phase: HypothesisScaffold["phase"];
  readonly mode: HypothesisMode;
  readonly targetIds: readonly string[];
  readonly gapId?: string;
  readonly attemptId?: string;
}

export interface GoalInput {
  readonly capability: string;
  readonly targetTask: string;
  readonly successCriteria: string;
  readonly subject: Subject;
  readonly retentionDays?: number;
}

export interface RubricCriterion {
  readonly id: string;
  readonly description: string;
}

export interface TargetDefinition {
  readonly id: string;
  readonly description: string;
  readonly criteria: readonly RubricCriterion[];
}

export interface CriterionAssessmentInput {
  readonly criterionId: string;
  readonly met: boolean;
  readonly quotes: readonly string[];
  readonly note?: string;
}

interface EventBase<T extends string, P> {
  readonly eventId: string;
  readonly sessionId: string;
  readonly type: T;
  readonly schemaVersion: typeof HARNESS_SCHEMA_VERSION;
  readonly occurredAt: string;
  readonly actor: HarnessActor;
  readonly payload: P;
}

export type HarnessEvent =
  | EventBase<"harness.session.started", { readonly learnerId: string; readonly goal: GoalInput }>
  | EventBase<"harness.goal.confirmed", { readonly confirmation: string }>
  | EventBase<"harness.targets.defined", { readonly targets: readonly TargetDefinition[]; readonly generatedBy: "adapter" | "human" }>
  | EventBase<"harness.attempt.started", {
      readonly attemptId: string;
      readonly kind: AttemptKind;
      readonly targetIds: readonly string[];
      readonly prompt: string;
    }>
  | EventBase<"harness.help.provided", { readonly attemptId?: string; readonly kind: HelpKind; readonly content: string }>
  | EventBase<"harness.artifact.submitted", {
      readonly attemptId: string;
      readonly artifactId: string;
      readonly author: ArtifactAuthor;
      readonly content: string;
    }>
  | EventBase<"harness.attempt.assessed", {
      readonly attemptId: string;
      readonly assessments: readonly CriterionAssessmentInput[];
    }>
  | EventBase<"harness.gap.opened", {
      readonly gapId: string;
      readonly attemptId: string;
      readonly targetId: string;
      readonly criterionId: string;
      readonly diagnosis: string;
    }>
  | EventBase<"harness.remediation.provided", {
      readonly gapId: string;
      readonly content: string;
      readonly kind: "explanation" | "example" | "exercise" | "source";
    }>
  | EventBase<"harness.gap.resolved", { readonly gapId: string; readonly attemptId: string }>
  | EventBase<"harness.session.completed", { readonly completionFingerprint: string }>;

export interface AuditAnomaly {
  readonly eventId: string;
  readonly eventType: string;
  readonly code: string;
  readonly detail: string;
}

export interface ProjectedAttempt {
  readonly id: string;
  readonly kind: AttemptKind;
  readonly targetIds: readonly string[];
  readonly prompt: string;
  readonly startedAt: string;
  readonly contaminated: boolean;
  readonly contaminationEventIds: readonly string[];
  readonly artifact?: {
    readonly id: string;
    readonly author: ArtifactAuthor;
    readonly content: string;
    readonly submittedAt: string;
  };
  readonly assessment?: {
    readonly assessedAt: string;
    readonly criteria: Readonly<Record<string, { readonly met: boolean; readonly quotes: readonly string[] }>>;
    readonly allMet: boolean;
  };
}

export interface ProjectedGap {
  readonly id: string;
  readonly attemptId: string;
  readonly targetId: string;
  readonly criterionId: string;
  readonly diagnosis: string;
  readonly openedAt: string;
  readonly remediationCount: number;
  readonly lastRemediatedAt?: string;
  readonly resolvedByAttemptId?: string;
  readonly resolvedAt?: string;
}

export interface HarnessProjection {
  readonly sessionId?: string;
  readonly learnerId?: string;
  readonly goal?: GoalInput;
  readonly goalConfirmedAt?: string;
  readonly targets: Readonly<Record<string, TargetDefinition>>;
  readonly attempts: Readonly<Record<string, ProjectedAttempt>>;
  readonly gaps: Readonly<Record<string, ProjectedGap>>;
  readonly anomalies: readonly AuditAnomaly[];
  readonly completedAt?: string;
  readonly completionFingerprint?: string;
}

export interface CompletionDecision {
  readonly complete: boolean;
  readonly reasons: readonly string[];
  readonly qualifyingAttemptIds: readonly string[];
  readonly fingerprint: string;
}

export interface NextAction {
  readonly stage: "goal" | "confirm" | "targets" | "baseline" | "submit" | "assess" | "diagnose" | "remediate" | "reattempt" | "transfer" | "delayed_retrieval" | "complete" | "done";
  readonly instruction: string;
  readonly targetId?: string;
  readonly gapId?: string;
  readonly attemptId?: string;
  /** Optional policy scaffold; it is not an event, evidence, or completion input. */
  readonly hypothesisScaffold?: HypothesisScaffold;
}
