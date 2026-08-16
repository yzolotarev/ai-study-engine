import type { Provenance } from "./provenance.js";

export const STUDY_STATES = [
  "ONBOARD",
  "OUTCOME",
  "BASELINE_PROBE",
  "PRIME_L1",
  "AIM",
  "SHOOT_ENCODE",
  "SKIN",
  "REFERENCE",
  "RETRIEVE",
  "GAP",
  "REMEDIATE",
  "INTERLEAVE",
  "DELAY",
  "META",
  "BREAK",
  "OVERLEARN",
  "COMPLETE",
  "PAUSED",
] as const;

export type StudyState = (typeof STUDY_STATES)[number];

export type PacerType = "procedural" | "analogous" | "conceptual" | "evidence" | "reference";
export type HelpLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface TransitionEvidence {
  objectiveExplicit?: boolean;
  independentAttempt?: boolean;
  learnerQuestionOrRelation?: boolean;
  concreteBackbone?: boolean;
  learnerArtifact?: boolean;
  targetRubricPassed?: boolean;
  relationalEvidence?: boolean;
  delayedOrTransferEvidence?: boolean;
  gapQuestionExplicit?: boolean;
  remediationPassed?: boolean;
  competitiveStakes?: boolean;
  userRequestedOverlearning?: boolean;
  restartPointSaved?: boolean;
}

export interface TransitionRequest {
  from: StudyState;
  to: StudyState;
  evidence: TransitionEvidence;
}

export interface DomainEvent<T = unknown> {
  id: string;
  userId: string;
  studySessionId?: string;
  attemptBranchId: string;
  parentEventId?: string;
  type: string;
  schemaVersion: number;
  payload: T;
  actor: "user" | "engine" | "ai" | "human_reviewer";
  provenance: Provenance;
  createdAt: string;
}

export interface MasteryDimensions {
  factualAccuracy?: 0 | 1 | 2 | 3;
  freeGeneration?: 0 | 1 | 2 | 3;
  relationalStructure?: 0 | 1 | 2 | 3;
  reconstruction?: 0 | 1 | 2 | 3;
  application?: 0 | 1 | 2 | 3;
  transfer?: 0 | 1 | 2 | 3;
  communication?: 0 | 1 | 2 | 3;
}

export interface AssessmentSnapshot {
  dimensions: MasteryDimensions;
  criticalErrors: string[];
  answerWasVisibleBeforeAttempt: boolean;
  delayed: boolean;
}

export type GapState =
  | "open"
  | "cause_hypothesized"
  | "remediating"
  | "provisional_closed"
  | "verified_closed"
  | "reopened"
  | "deferred";
