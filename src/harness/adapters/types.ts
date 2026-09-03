import type { GoalInput, HypothesisScaffold, HypothesisScaffoldRequest, Subject, TargetDefinition } from "../types.js";

export interface SubjectAdapter {
  readonly subject: Subject;
  defineTargets(goal: GoalInput): readonly TargetDefinition[];
  transferPrompt(goal: GoalInput, target: TargetDefinition): string;
  hypothesisScaffold(request: HypothesisScaffoldRequest): HypothesisScaffold;
}
