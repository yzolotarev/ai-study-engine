import type {
  CheckpointRubricVector,
  CriticalIncidentCategory,
  LearnerArtifact,
  RubricCriterion,
  ScorerKind,
} from "./types.js";

export function validateRubricVector(
  vector: unknown,
  rubric: readonly RubricCriterion[],
): vector is CheckpointRubricVector {
  if (!vector || typeof vector !== "object") return false;
  const candidate = vector as Partial<CheckpointRubricVector>;
  if (!candidate.criteria || typeof candidate.criteria !== "object" || Array.isArray(candidate.criteria)) return false;
  if (![candidate.metCount, candidate.unmetCount, candidate.unknownCount].every((value) => Number.isInteger(value) && Number(value) >= 0)) return false;
  const ids = rubric.map((criterion) => criterion.id);
  const keys = Object.keys(candidate.criteria as object);
  if (keys.length !== ids.length || keys.some((key) => !ids.includes(key))) return false;
  let met = 0;
  let unmet = 0;
  let unknown = 0;
  for (const id of ids) {
    const status = (candidate.criteria as Record<string, unknown>)[id];
    if (status === "met") met += 1;
    else if (status === "unmet") unmet += 1;
    else if (status === "unknown") unknown += 1;
    else return false;
  }
  return candidate.metCount === met && candidate.unmetCount === unmet && candidate.unknownCount === unknown;
}

export interface ScoringTaskSnapshot {
  readonly protocolId: string;
  readonly protocolVersion: number;
  readonly packId: string;
  readonly packVersion: number;
  readonly trialId: string;
  readonly checkpointId: string;
  readonly phase: "pretest" | "immediate" | "transfer" | "delayed";
  readonly taskId: string;
  readonly formId: string;
  readonly prompt: string;
  readonly presentedAt: string;
  readonly dueAt?: string;
  readonly microtopicId: string;
  readonly matchedSetId: string;
}

export interface ScoringReference {
  readonly scoringGuidance?: string;
  readonly referenceAnswer?: string;
  readonly referenceMaterials?: readonly string[];
}

export interface ScorerMetadata {
  readonly scorerKind: ScorerKind;
  readonly scorerId: string;
  readonly scorerVersion: string;
  readonly assessedAt: string;
}

export interface ScorerInput {
  readonly taskSnapshot: ScoringTaskSnapshot;
  readonly artifact: LearnerArtifact;
  readonly rubric: readonly RubricCriterion[];
  readonly reference?: ScoringReference;
  readonly scorerMetadata: ScorerMetadata;
}

export interface Scorer {
  readonly scorerKind: ScorerKind;
  readonly scorerId: string;
  readonly scorerVersion: string;
  score(input: ScorerInput): CheckpointRubricVector;
}

function vectorFromEntries(entries: readonly [string, "met" | "unmet" | "unknown"][]): CheckpointRubricVector {
  const criteria: Record<string, "met" | "unmet" | "unknown"> = {};
  let metCount = 0;
  let unmetCount = 0;
  let unknownCount = 0;
  for (const [criterionId, status] of entries) {
    criteria[criterionId] = status;
    if (status === "met") metCount += 1;
    else if (status === "unmet") unmetCount += 1;
    else unknownCount += 1;
  }
  return { criteria, metCount, unmetCount, unknownCount };
}

export class ManualTrustedScorer implements Scorer {
  readonly scorerKind = "trusted-human" as const;
  constructor(readonly scorerId: string, readonly scorerVersion: string, private readonly suppliedVector: CheckpointRubricVector) {}
  score(): CheckpointRubricVector {
    return this.suppliedVector;
  }
}

export class DeterministicFixtureScorer implements Scorer {
  readonly scorerKind = "deterministic" as const;
  constructor(readonly scorerId: string, readonly scorerVersion: string) {}
  score(input: ScorerInput): CheckpointRubricVector {
    const lower = input.artifact.content.toLowerCase();
    return vectorFromEntries(input.rubric.map((criterion) => {
      const tokens = criterion.id
        .toLowerCase()
        .split(/[^a-z0-9]+/i)
        .filter(Boolean);
      const matched = tokens.length > 0 && tokens.every((token) => lower.includes(token));
      return [criterion.id, matched ? "met" : "unmet"] as const;
    }));
  }
}

export class FutureAiSemanticScorer implements Scorer {
  readonly scorerKind = "ai-semantic" as const;
  constructor(readonly scorerId: string, readonly scorerVersion: string) {}
  score(): CheckpointRubricVector {
    throw new Error("AI semantic scoring is not wired to an external provider in v0");
  }
}

export function emptyCriticalIncidentVector(): Record<CriticalIncidentCategory, number> {
  return {
    lost_goal: 0,
    cold_baseline: 0,
    overload: 0,
    premature_help: 0,
    wrong_gap: 0,
    false_completion: 0,
    transcription_problem: 0,
    technical_wait: 0,
    user_stopped: 0,
    other: 0,
  };
}
