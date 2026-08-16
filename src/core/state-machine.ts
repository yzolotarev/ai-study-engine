import type { StudyState, TransitionRequest } from "./types.js";

const ALLOWED: Readonly<Record<StudyState, readonly StudyState[]>> = {
  ONBOARD: ["OUTCOME", "PAUSED"],
  OUTCOME: ["BASELINE_PROBE", "PRIME_L1", "PAUSED"],
  BASELINE_PROBE: ["PRIME_L1", "GAP", "PAUSED"],
  PRIME_L1: ["AIM", "GAP", "BREAK", "PAUSED"],
  AIM: ["SHOOT_ENCODE", "GAP", "BREAK", "PAUSED"],
  SHOOT_ENCODE: ["SKIN", "REFERENCE", "GAP", "BREAK", "PAUSED"],
  SKIN: ["RETRIEVE", "SHOOT_ENCODE", "REFERENCE", "GAP", "BREAK", "PAUSED"],
  REFERENCE: ["SHOOT_ENCODE", "SKIN", "RETRIEVE", "PAUSED"],
  RETRIEVE: ["GAP", "INTERLEAVE", "DELAY", "META", "OVERLEARN", "COMPLETE", "PAUSED"],
  GAP: ["REMEDIATE", "SHOOT_ENCODE", "REFERENCE", "DELAY", "PAUSED"],
  REMEDIATE: ["RETRIEVE", "GAP", "BREAK", "PAUSED"],
  INTERLEAVE: ["GAP", "DELAY", "META", "OVERLEARN", "COMPLETE", "BREAK", "PAUSED"],
  DELAY: ["RETRIEVE", "PAUSED"],
  META: ["PRIME_L1", "AIM", "SHOOT_ENCODE", "RETRIEVE", "DELAY", "COMPLETE", "PAUSED"],
  BREAK: ["PRIME_L1", "AIM", "SHOOT_ENCODE", "SKIN", "RETRIEVE", "REMEDIATE", "PAUSED"],
  OVERLEARN: ["GAP", "DELAY", "COMPLETE", "BREAK", "PAUSED"],
  COMPLETE: ["RETRIEVE", "GAP", "PAUSED"],
  PAUSED: ["OUTCOME", "PRIME_L1", "AIM", "SHOOT_ENCODE", "SKIN", "RETRIEVE", "REMEDIATE", "DELAY"],
};

export interface TransitionDecision {
  allowed: boolean;
  reasons: string[];
}

export function evaluateTransition(request: TransitionRequest): TransitionDecision {
  const reasons: string[] = [];
  const { from, to, evidence } = request;

  if (!ALLOWED[from].includes(to)) {
    reasons.push(`Transition ${from} → ${to} is not in the state graph`);
    return { allowed: false, reasons };
  }

  if (from === "OUTCOME" && (to === "BASELINE_PROBE" || to === "PRIME_L1") && !evidence.objectiveExplicit) {
    reasons.push("An observable objective and target task are required");
  }
  if (from === "PRIME_L1" && to === "AIM" && !evidence.learnerQuestionOrRelation) {
    reasons.push("The learner must produce a question or tentative relation before AIM");
  }
  if (from === "AIM" && to === "SHOOT_ENCODE" && !evidence.concreteBackbone) {
    reasons.push("A concrete learner-owned backbone is required before detailed encoding");
  }
  if (from === "SHOOT_ENCODE" && to === "SKIN" && !evidence.learnerArtifact) {
    reasons.push("SKIN requires a learner artifact or recorded explanation to revise");
  }
  if (from === "SKIN" && to === "RETRIEVE" && !evidence.learnerArtifact) {
    reasons.push("Retrieval requires prior learner encoding evidence");
  }
  if (to === "REMEDIATE" && !evidence.gapQuestionExplicit) {
    reasons.push("Remediation requires a precise gap question");
  }
  if (from === "REMEDIATE" && to === "RETRIEVE" && !evidence.remediationPassed) {
    reasons.push("A remediation attempt is required before returning to retrieval");
  }
  if ((from === "RETRIEVE" || from === "INTERLEAVE") && to === "COMPLETE") {
    if (!evidence.independentAttempt) reasons.push("Completion requires an independent attempt");
    if (!evidence.targetRubricPassed) reasons.push("Completion requires target-rubric evidence");
  }
  if (to === "OVERLEARN" && !evidence.competitiveStakes && !evidence.userRequestedOverlearning) {
    reasons.push("Overlearning is disabled unless stakes require it or the user explicitly requests it");
  }
  if (to === "PAUSED" && from !== "ONBOARD" && !evidence.restartPointSaved) {
    reasons.push("Pausing requires a saved restart point");
  }

  return { allowed: reasons.length === 0, reasons };
}

export function assertTransition(request: TransitionRequest): void {
  const decision = evaluateTransition(request);
  if (!decision.allowed) throw new Error(decision.reasons.join("; "));
}

export function allowedTargets(state: StudyState): readonly StudyState[] {
  return ALLOWED[state];
}
