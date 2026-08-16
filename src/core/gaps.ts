import type { GapState } from "./types.js";

const GAP_TRANSITIONS: Readonly<Record<GapState, readonly GapState[]>> = {
  open: ["cause_hypothesized", "remediating", "deferred"],
  cause_hypothesized: ["remediating", "open", "deferred"],
  remediating: ["provisional_closed", "open", "deferred"],
  provisional_closed: ["verified_closed", "reopened"],
  verified_closed: ["reopened"],
  reopened: ["cause_hypothesized", "remediating", "deferred"],
  deferred: ["open", "reopened"],
};

export interface GapTransitionEvidence {
  independentReattempt?: boolean;
  relevantRubricPassed?: boolean;
  delayedOrVariedEvidence?: boolean;
}

export function canTransitionGap(
  from: GapState,
  to: GapState,
  evidence: GapTransitionEvidence = {},
): { allowed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!GAP_TRANSITIONS[from].includes(to)) {
    reasons.push(`Gap transition ${from} → ${to} is not allowed`);
    return { allowed: false, reasons };
  }
  if (to === "provisional_closed") {
    if (!evidence.independentReattempt) reasons.push("Gap closure requires a new independent reattempt");
    if (!evidence.relevantRubricPassed) reasons.push("Gap closure requires the relevant rubric to pass");
  }
  if (to === "verified_closed" && !evidence.delayedOrVariedEvidence) {
    reasons.push("Verified closure requires delayed or meaningfully varied evidence");
  }
  return { allowed: reasons.length === 0, reasons };
}
