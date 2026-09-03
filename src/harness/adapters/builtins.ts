import { fingerprint } from "../fingerprints.js";
import type {
  GoalInput,
  HypothesisScaffold,
  HypothesisScaffoldRequest,
  Subject,
  TargetDefinition,
} from "../types.js";
import type { SubjectAdapter } from "./types.js";

const focus: Record<Subject, readonly string[]> = {
  general: ["state the core claim accurately", "explain the reasoning or mechanism", "apply it without copying a model answer"],
  history: ["state the relevant chronology and actors", "support a causal claim with specific evidence", "distinguish causes, context, and consequences"],
  law: ["identify the governing issue and rule", "apply the rule to material facts", "address a plausible counterargument and conclusion"],
  economics: ["define the relevant model and assumptions", "trace the causal mechanism", "apply the model to a changed scenario and note limitations"],
};

const commitQuestions: Record<Subject, string> = {
  general: "Before feedback, what result do you predict, and what observation would change your answer?",
  history: "Before feedback, which factor do you predict will matter most, and what fact would weaken that conclusion?",
  law: "Before feedback, what outcome do you predict, and what change in facts would change the decision?",
  economics: "Before feedback, in which direction do you predict the result will move, and when could it reverse?",
};

const reviseQuestions: Record<Subject, string> = {
  general: "Before remediation, what assumption do you think failed, what question remains, and what will you change in your model?",
  history: "Before remediation, what do you think caused the missed historical relationship, what question remains, and how will you revise your causal model?",
  law: "Before remediation, what do you think caused the missed legal issue, what question remains, and how will you revise your rule application?",
  economics: "Before remediation, what assumption or mechanism do you think failed, what question remains, and how will you revise the model?",
};

const commitFrames: Record<Subject, readonly string[]> = {
  general: ["Prediction: What result do you expect?", "Reason: Why?", "Confidence: How confident are you?", "Falsifier: What would change your answer?"],
  history: ["Prediction: Which factor will be most important?", "Mechanism: Through what causal pathway?", "Confidence: How confident are you?", "Falsifier: What fact would weaken your conclusion?"],
  law: ["Prediction: What outcome do you expect?", "Rule: Which rule or element is decisive?", "Confidence: How confident are you?", "Counterfactual: What changed fact would change the outcome?"],
  economics: ["Prediction: Which direction will the result move?", "Mechanism: Through what mechanism?", "Confidence: How confident are you?", "Boundary: Under what condition could the result reverse?"],
};

const reviseFrames: Record<Subject, readonly string[]> = {
  general: ["Current model: Which assumption failed?", "Open question: What must you resolve?", "Revision: What will you change?", "Next prediction: What follows from that change?"],
  history: ["Current model: Which causal assumption failed?", "Open question: What historical relationship must you resolve?", "Revision: What changes in your causal model?", "Next prediction: What follows from the revision?"],
  law: ["Current model: Which rule or factual assumption failed?", "Open question: What legal issue must you resolve?", "Revision: What changes in your rule application?", "Next prediction: What outcome follows from the revision?"],
  economics: ["Current model: Which assumption or mechanism failed?", "Open question: What economic relationship must you resolve?", "Revision: What changes in your model?", "Next prediction: What follows under the revised assumptions?"],
};

function makeAdapter(subject: Subject): SubjectAdapter {
  return {
    subject,
    defineTargets(goal: GoalInput): readonly TargetDefinition[] {
      const id = `target-${fingerprint([subject, goal.capability, goal.targetTask]).slice(0, 10)}`;
      return [{
        id,
        description: goal.targetTask,
        criteria: focus[subject].map((description, index) => ({ id: `${id}-c${index + 1}`, description })),
      }];
    },
    transferPrompt(goal: GoalInput, target: TargetDefinition): string {
      const stems: Record<Subject, string> = {
        general: "Use the same capability in a materially different example.",
        history: "Analyze a different episode with a comparable causal structure; do not reuse the baseline wording.",
        law: "Apply the rule to a novel fact pattern in which one material fact changes.",
        economics: "Apply the model after changing one assumption or exogenous condition.",
      };
      return `${stems[subject]} Target: ${target.description}. Goal: ${goal.capability}`;
    },
    hypothesisScaffold(request: HypothesisScaffoldRequest): HypothesisScaffold {
      const scaffold: HypothesisScaffold = {
        phase: request.phase,
        mode: request.mode,
        question: request.phase === "commit" ? commitQuestions[subject] : reviseQuestions[subject],
        responseFrame: [...(request.phase === "commit" ? commitFrames[subject] : reviseFrames[subject])],
        targetIds: [...request.targetIds],
        disclosurePolicy: "commit-before-feedback",
        ...(request.gapId === undefined ? {} : { gapId: request.gapId }),
        ...(request.attemptId === undefined ? {} : { attemptId: request.attemptId }),
      };
      return scaffold;
    },
  };
}

export const BUILTIN_ADAPTERS: Readonly<Record<Subject, SubjectAdapter>> = {
  general: makeAdapter("general"),
  history: makeAdapter("history"),
  law: makeAdapter("law"),
  economics: makeAdapter("economics"),
};

export function getAdapter(subject: Subject): SubjectAdapter {
  return BUILTIN_ADAPTERS[subject];
}
