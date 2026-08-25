import { fingerprint } from "../fingerprints.js";
import type { GoalInput, Subject, TargetDefinition } from "../types.js";
import type { SubjectAdapter } from "./types.js";

const focus: Record<Subject, readonly string[]> = {
  general: ["state the core claim accurately", "explain the reasoning or mechanism", "apply it without copying a model answer"],
  history: ["state the relevant chronology and actors", "support a causal claim with specific evidence", "distinguish causes, context, and consequences"],
  law: ["identify the governing issue and rule", "apply the rule to material facts", "address a plausible counterargument and conclusion"],
  economics: ["define the relevant model and assumptions", "trace the causal mechanism", "apply the model to a changed scenario and note limitations"],
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
