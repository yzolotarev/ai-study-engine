export interface GoalContractDraft {
  readonly capability: string;
  readonly targetTask: string;
  readonly successCriteria: string;
  readonly allowedHints?: readonly string[];
  readonly retentionDays?: number;
}

export interface GoalContract extends GoalContractDraft {
  readonly contractId: string;
  readonly learnerId: string;
  readonly learnerConfirmed: boolean;
  readonly createdAt: string;
  readonly confirmedAt?: string;
}

export function parseGoalContract(input: {
  capability?: string;
  targetTask?: string;
  successCriteria?: string;
  allowedHints?: readonly string[];
  retentionDays?: number;
}): GoalContractDraft {
  const capability = (input.capability ?? "").trim();
  const targetTask = (input.targetTask ?? "").trim();
  const successCriteria = (input.successCriteria ?? "").trim();
  if (capability.length === 0) {
    throw new Error("GoalContract requires a non-empty capability");
  }
  if (targetTask.length === 0) {
    throw new Error("GoalContract requires a non-empty targetTask");
  }
  if (successCriteria.length === 0) {
    throw new Error("GoalContract requires a non-empty successCriteria");
  }
  return {
    capability,
    targetTask,
    successCriteria,
    allowedHints: input.allowedHints,
    retentionDays: input.retentionDays,
  } as GoalContractDraft;
}