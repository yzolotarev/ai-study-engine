import type { StudyState } from "./types.js";

export interface NextStepRecommendation {
  state: StudyState;
  action: string;
  learnerArtifact: string;
  aiBoundary: string;
}

const RECOMMENDATIONS: Record<StudyState, Omit<NextStepRecommendation, "state">> = {
  ONBOARD: {
    action: "Create a learner profile and choose a real learning objective.",
    learnerArtifact: "A chosen objective.",
    aiBoundary: "AI may explain the workflow but must not invent the objective.",
  },
  OUTCOME: {
    action: "State what you must be able to do and how it will be tested.",
    learnerArtifact: "Observable outcome and target task.",
    aiBoundary: "AI may offer assessment formats, not choose the desired capability.",
  },
  BASELINE_PROBE: {
    action: "Attempt a broad diagnostic without studying first.",
    learnerArtifact: "An unassisted baseline response.",
    aiBoundary: "AI hides answers and uses recognition only for rough screening.",
  },
  PRIME_L1: {
    action: "Skim the material and name the main ideas or questions.",
    learnerArtifact: "At least one question or tentative relationship.",
    aiBoundary: "AI may give familiarity scaffolds, not a finished relational map.",
  },
  AIM: {
    action: "Group the keywords and build a concrete, possibly wrong backbone.",
    learnerArtifact: "Learner-owned groups, questions, and hypotheses.",
    aiBoundary: "AI provides a canvas and prompts but does not choose the groups.",
  },
  SHOOT_ENCODE: {
    action: "Study specifically to answer the questions in your backbone.",
    learnerArtifact: "Updated relationships, explanation, or performed procedure.",
    aiBoundary: "AI retrieves sources and scaffolds exact gaps without summarizing everything.",
  },
  SKIN: {
    action: "Rechunk, prioritize, remove clutter, and repair weak relationships.",
    learnerArtifact: "A revised learner-owned structure.",
    aiBoundary: "AI checks criteria only after the learner revision.",
  },
  REFERENCE: {
    action: "Decide which detail must be remembered and which can be stored.",
    learnerArtifact: "A justified memorize-or-store decision.",
    aiBoundary: "AI stores details and estimates review debt; no mass card creation.",
  },
  RETRIEVE: {
    action: "Explain, reconstruct, or perform the target without the source.",
    learnerArtifact: "An independent target-format attempt.",
    aiBoundary: "AI hides the answer until the attempt ends.",
  },
  GAP: {
    action: "Turn the failure into one precise question.",
    learnerArtifact: "A concrete gap question.",
    aiBoundary: "AI classifies the gap but does not erase it with an instant answer.",
  },
  REMEDIATE: {
    action: "Study the smallest useful context and attempt the target again.",
    learnerArtifact: "A new independent reattempt.",
    aiBoundary: "AI uses the minimum sufficient help and records contamination.",
  },
  INTERLEAVE: {
    action: "Apply or compare the same idea in a meaningfully different form.",
    learnerArtifact: "Performance across a controlled variation.",
    aiBoundary: "AI varies the relevant dimension, not random difficulty.",
  },
  DELAY: {
    action: "Leave the knowledge alone until the review window.",
    learnerArtifact: "No immediate artifact; the next evidence must be delayed.",
    aiBoundary: "AI schedules a loose window instead of forcing busywork.",
  },
  META: {
    action: "Choose one observable adjustment for the next attempt.",
    learnerArtifact: "One testable change.",
    aiBoundary: "AI records and later tests it; no long reflection bureaucracy.",
  },
  BREAK: {
    action: "Stop high-load work and preserve the exact restart point.",
    learnerArtifact: "A restart cue.",
    aiBoundary: "AI must not fill the break with another cognitive task.",
  },
  OVERLEARN: {
    action: "Run extra high-standard target trials only because excellence requires them.",
    learnerArtifact: "Performance at the externally required standard.",
    aiBoundary: "AI may not enable overlearning by default.",
  },
  COMPLETE: {
    action: "Keep the result and remaining uncertainty auditable.",
    learnerArtifact: "A demonstrated outcome plus explicit open gaps.",
    aiBoundary: "AI must not erase uncertainty or claim unsupported acceleration.",
  },
  PAUSED: {
    action: "Resume from the saved restart point.",
    learnerArtifact: "The first concrete action after resuming.",
    aiBoundary: "AI restores state instead of reconstructing it from memory.",
  },
};

export function recommendForState(state: StudyState): NextStepRecommendation {
  return { state, ...RECOMMENDATIONS[state] };
}
