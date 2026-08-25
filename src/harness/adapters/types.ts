import type { GoalInput, Subject, TargetDefinition } from "../types.js";

export interface SubjectAdapter {
  readonly subject: Subject;
  defineTargets(goal: GoalInput): readonly TargetDefinition[];
  transferPrompt(goal: GoalInput, target: TargetDefinition): string;
}
