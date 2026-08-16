// Pure, DB-free and AI-free evidence rules for the study engine.
// These functions are the canonical "what counts as evidence" logic and are
// unit-tested without a database or a vision model.

export type OwnershipStatus = "unverified" | "provisional_owned" | "verified_owned";
export type Readiness = "insufficient" | "provisional" | "stable";

export interface AttemptLike {
  answerVisible: boolean;
  attemptIndependent?: boolean;
  helpLevel?: string;
  status?: string;
}

export function isAttemptIndependent(attempt: AttemptLike): boolean {
  if (attempt.answerVisible) return false;
  return attempt.attemptIndependent ?? true;
}

/** Contamination = answer was visible, or help exceeded process-only scaffolding. */
export function isAttemptContaminated(attempt: AttemptLike): boolean {
  if (attempt.answerVisible) return true;
  if (attempt.helpLevel && attempt.helpLevel !== "none" && attempt.helpLevel !== "process_only") {
    return true;
  }
  return false;
}

/**
 * A gap may be considered closed only on stable, verified-owned LEARNER evidence.
 * An AI transcription can NEVER close a gap.
 */
export function canCloseGap(readiness: Readiness, ownershipStatus: OwnershipStatus): boolean {
  return readiness === "stable" && ownershipStatus === "verified_owned";
}

export interface ObservationGroups {
  texts?: Array<{ id?: string }>;
  objects?: Array<{ id?: string }>;
  visual_marks?: Array<{ id?: string }>;
  visible_symbols?: Array<{ id?: string }>;
}

export function extractObservationIds(transcription: ObservationGroups): Set<string> {
  const ids = new Set<string>();
  for (const group of ["texts", "objects", "visual_marks", "visible_symbols"] as const) {
    const items = transcription[group] ?? [];
    for (const item of items) {
      if (item && item.id) ids.add(item.id);
    }
  }
  return ids;
}

/**
 * The learner may confirm ONLY literal observations that exist in the
 * transcription. Relations, explanations and groups are NOT in the
 * transcription, so they can never be "confirmed" here.
 */
export function literalsOnly(
  observationIds: string[],
  validIds: Set<string>,
): { valid: string[]; unknown: string[] } {
  const valid: string[] = [];
  const unknown: string[] = [];
  for (const id of observationIds) {
    (validIds.has(id) ? valid : unknown).push(id);
  }
  return { valid, unknown };
}

export interface ContaminationRecordLike {
  helpLevel: string;
  scope: string;
}

export function summarizeContamination(records: Array<ContaminationRecordLike>): {
  contaminatedCount: number;
  scopes: string[];
} {
  const contaminated = records.filter(
    (r) => r.helpLevel !== "none" && r.helpLevel !== "process_only",
  );
  return {
    contaminatedCount: contaminated.length,
    scopes: contaminated.map((r) => r.scope),
  };
}
