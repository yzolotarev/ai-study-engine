import type { HelpLevel } from "./types.js";

export type HelpMode = "familiarity" | "encoding" | "retrieval" | "assessment" | "remediation" | "reference";

export interface HelpContext {
  mode: HelpMode;
  currentLevel: HelpLevel;
  materiallyDistinctFailedAttempts: number;
  degradationSignals: number;
  explicitAnswerRequest: boolean;
  explicitSurrender: boolean;
  blockingPrerequisite: boolean;
}

export interface HelpDecision {
  level: HelpLevel;
  contaminateAttempt: boolean;
  action:
    | "request_attempt"
    | "metacognitive_cue"
    | "direction_cue"
    | "one_fact"
    | "partial_step_or_context"
    | "direct_answer"
    | "teaching_reset";
  reasons: string[];
  requiredFollowUps: Array<"paraphrase" | "explain_relation" | "analogous_task" | "delayed_retrieval" | "independent_reattempt">;
}

const ACTION_BY_LEVEL: Record<HelpLevel, HelpDecision["action"]> = {
  0: "request_attempt",
  1: "metacognitive_cue",
  2: "direction_cue",
  3: "one_fact",
  4: "partial_step_or_context",
  5: "direct_answer",
  6: "teaching_reset",
};

function clampHelpLevel(value: number): HelpLevel {
  return Math.max(0, Math.min(6, value)) as HelpLevel;
}

export function decideHelp(context: HelpContext): HelpDecision {
  const reasons: string[] = [];
  let level = context.currentLevel;

  if (context.mode === "assessment") {
    level = 0;
    reasons.push("Assessment mode does not permit instructional help");
  } else if (context.mode === "reference") {
    level = 5;
    reasons.push("Reference lookup permits a direct factual answer");
  } else if (context.blockingPrerequisite) {
    level = 6;
    reasons.push("A blocking prerequisite requires lowering the layer and rebuilding");
  } else if (context.explicitAnswerRequest || context.explicitSurrender) {
    level = 5;
    reasons.push("The learner explicitly requested or surrendered to the answer");
  } else if (context.mode === "familiarity" && level < 3) {
    level = 3;
    reasons.push("Familiarity mode permits one concise fact or layman scaffold");
  } else if (context.mode === "retrieval" && context.materiallyDistinctFailedAttempts === 0) {
    level = 0;
    reasons.push("Retrieval requires an attempt before help");
  } else if (context.degradationSignals >= 2 || context.materiallyDistinctFailedAttempts >= 2) {
    level = clampHelpLevel(level + 1);
    reasons.push(
      context.degradationSignals >= 2
        ? "Multiple degradation signals justify one help-level escalation"
        : "Two materially distinct failed attempts justify one help-level escalation",
    );
  } else {
    reasons.push("No escalation condition was met");
  }

  const contaminateAttempt = level >= 3;
  const requiredFollowUps: HelpDecision["requiredFollowUps"] =
    level >= 5
      ? ["paraphrase", "explain_relation", "analogous_task", "delayed_retrieval"]
      : level >= 3
        ? ["independent_reattempt"]
        : [];
  return { level, contaminateAttempt, action: ACTION_BY_LEVEL[level], reasons, requiredFollowUps };
}

/**
 * Runtime helper: the minimal pedagogically safe help level.
 * Level 0 is the default. Help is escalated ONLY on an explicit answer
 * request, an explicit surrender, or a blocking prerequisite. It never
 * auto-escalates from familiarity/retrieval modes the way decideHelp() does.
 */
export function chooseMinimalHelp(input: {
  targetId?: string;
  level0: boolean;
  currentLevel: number;
  blockingPrerequisite: boolean;
  explicitAnswerRequest: boolean;
  explicitSurrender: boolean;
}): HelpDecision {
  const reasons: string[] = [];
  let level: HelpLevel = input.level0 ? 0 : clampHelpLevel(input.currentLevel);

  if (input.blockingPrerequisite) {
    level = 6;
    reasons.push("A blocking prerequisite requires lowering the layer and rebuilding");
  } else if (input.explicitAnswerRequest || input.explicitSurrender) {
    level = 5;
    reasons.push("The learner explicitly requested or surrendered to the answer");
  } else if (input.level0 && level === 0) {
    reasons.push("Minimal help: level 0 unless overridden by an explicit request");
  } else {
    reasons.push("No escalation condition was met; kept the current level");
  }

  const contaminateAttempt = level >= 3;
  const requiredFollowUps: HelpDecision["requiredFollowUps"] =
    level >= 5
      ? ["paraphrase", "explain_relation", "analogous_task", "delayed_retrieval"]
      : level >= 3
        ? ["independent_reattempt"]
        : [];
  return { level, contaminateAttempt, action: ACTION_BY_LEVEL[level], reasons, requiredFollowUps };
}
