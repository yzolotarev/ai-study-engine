import { getAdapter } from "../adapters/builtins.js";
import type {
  AttemptKind,
  GoalInput,
  HypothesisMode,
  HypothesisScaffold,
  HypothesisScaffoldRequest,
  Subject,
} from "../types.js";

function modeFor(subject: Subject, phase: HypothesisScaffold["phase"], attemptKind?: AttemptKind): HypothesisMode {
  if (phase === "revise") {
    return subject === "history" ? "causal"
      : subject === "law" ? "contrast"
        : subject === "economics" ? "boundary" : "mechanism";
  }
  if (attemptKind === "transfer") {
    return subject === "history" ? "causal"
      : subject === "law" ? "contrast"
        : subject === "economics" ? "mechanism" : "prediction";
  }
  return subject === "history" ? "causal"
    : subject === "law" ? "contrast"
      : subject === "economics" ? "mechanism" : "prediction";
}

export interface HypothesisSelection extends Omit<HypothesisScaffoldRequest, "mode"> {
  readonly attemptKind?: AttemptKind;
}

/**
 * Selects a deterministic learner-prediction scaffold. This is policy output:
 * it never appends an event, changes projection, or contributes to mastery.
 */
export function selectHypothesisScaffold(goal: GoalInput, selection: HypothesisSelection): HypothesisScaffold {
  const request: HypothesisScaffoldRequest = {
    phase: selection.phase,
    mode: modeFor(goal.subject, selection.phase, selection.attemptKind),
    targetIds: [...selection.targetIds],
    ...(selection.gapId === undefined ? {} : { gapId: selection.gapId }),
    ...(selection.attemptId === undefined ? {} : { attemptId: selection.attemptId }),
  };
  return getAdapter(goal.subject).hypothesisScaffold(request);
}
