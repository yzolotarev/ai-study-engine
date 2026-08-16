import type { AssessmentSnapshot } from "./types.js";

export type ObjectiveKind = "conceptual" | "procedural" | "reference";
export type Readiness = "insufficient" | "provisional" | "stable";

export interface ReadinessDecision {
  readiness: Readiness;
  reasons: string[];
}

export function deriveReadiness(kind: ObjectiveKind, evidence: AssessmentSnapshot): ReadinessDecision {
  const reasons: string[] = [];
  const d = evidence.dimensions;

  if (evidence.answerWasVisibleBeforeAttempt) {
    return { readiness: "insufficient", reasons: ["Attempt was contaminated by answer visibility"] };
  }
  if (evidence.criticalErrors.length > 0) {
    return { readiness: "insufficient", reasons: ["Critical errors remain"] };
  }

  if (kind === "conceptual") {
    if ((d.factualAccuracy ?? 0) < 2) reasons.push("Factual accuracy below 2");
    if ((d.freeGeneration ?? 0) < 2) reasons.push("Free generation below 2");
    if ((d.relationalStructure ?? 0) < 2) reasons.push("Relational structure below 2");
  } else if (kind === "procedural") {
    if ((d.application ?? 0) < 2) reasons.push("Application below 2");
  } else if ((d.freeGeneration ?? 0) < 2) {
    reasons.push("Required recall below 2");
  }

  if (reasons.length > 0) return { readiness: "insufficient", reasons };

  const hasStableEvidence = evidence.delayed || (d.transfer ?? 0) >= 2 || (d.reconstruction ?? 0) >= 3;
  return hasStableEvidence
    ? { readiness: "stable", reasons: ["Independent target evidence plus delayed/transfer evidence"] }
    : { readiness: "provisional", reasons: ["Immediate independent evidence passed; delayed verification remains"] };
}
