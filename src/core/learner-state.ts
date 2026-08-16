import type { OwnershipStatus, Readiness } from "./evidence-ledger.js";

export interface OperationAttemptView {
  operationId: string;
  operation: string;
  author: string;
  helpLevel: string;
  answerVisible: boolean;
  attemptIndependent: boolean;
  status: string;
  occurredAt: string;
}

export interface TargetAssessmentView {
  attemptId: string;
  notesJson: string | null;
  assessedAt: string;
}

export interface TargetState {
  targetId: string;
  ownershipStatus: OwnershipStatus;
  readiness: Readiness;
  reviewDueAt: string | null;
  lastAttemptIndependent: boolean;
  lastAttemptContaminated: boolean;
  lastAnswerVisible: boolean;
}

/**
 * Derives a target's learner-owned evidence state from raw attempt and
 * assessment rows. Pure: no DB, no AI. The transcription can never raise
 * ownership or readiness here.
 */
export function deriveTargetState(input: {
  targetId: string;
  operationAttempts: OperationAttemptView[];
  assessments: TargetAssessmentView[];
  reviewDueAt?: string | null;
}): TargetState {
  const last = input.operationAttempts[input.operationAttempts.length - 1];
  const lastAttemptIndependent = last?.attemptIndependent ?? false;
  const lastAnswerVisible = last?.answerVisible ?? false;
  const lastAttemptContaminated = last
    ? last.status === "contaminated" ||
      (last.helpLevel !== "none" && last.helpLevel !== "process_only")
    : false;

  let readiness: Readiness = "insufficient";
  for (const a of input.assessments) {
    if (!a.notesJson) continue;
    try {
      const parsed = JSON.parse(a.notesJson) as {
        criticalErrors?: unknown[];
        delayed?: boolean;
      };
      const noErrors =
        !parsed.criticalErrors ||
        (Array.isArray(parsed.criticalErrors) && parsed.criticalErrors.length === 0);
      if (parsed.delayed && noErrors) readiness = "stable";
      else if (noErrors && readiness !== "stable") readiness = "provisional";
    } catch {
      // ignore malformed assessment notes
    }
  }

  const ownershipStatus: OwnershipStatus =
    readiness === "stable"
      ? "verified_owned"
      : readiness === "provisional"
        ? "provisional_owned"
        : "unverified";

  return {
    targetId: input.targetId,
    ownershipStatus,
    readiness,
    reviewDueAt: input.reviewDueAt ?? null,
    lastAttemptIndependent,
    lastAttemptContaminated,
    lastAnswerVisible,
  };
}
