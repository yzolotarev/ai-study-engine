import { evaluateCompletion } from "../completion-policy.js";
import { isIndependentEvidence, isNovelTransfer } from "../evidence-validity.js";
import type { HarnessProjection, NextAction } from "../types.js";

export function selectHarnessNext(state: HarnessProjection): NextAction {
  if (!state.goal) return { stage: "goal", instruction: "Start with an observable learner goal." };
  if (!state.goalConfirmedAt) return { stage: "confirm", instruction: "Ask the learner to explicitly confirm the goal contract." };
  const targets = Object.values(state.targets);
  if (targets.length === 0) return { stage: "targets", instruction: "Generate or define a non-empty rubric and target set." };

  for (const target of targets) {
    const baseline = Object.values(state.attempts).find((attempt) => attempt.kind === "baseline" && attempt.targetIds.includes(target.id)
      && !attempt.contaminated && attempt.artifact?.author === "learner" && attempt.assessment);
    if (!baseline) return { stage: "baseline", targetId: target.id, instruction: `Begin an unassisted baseline for ${target.description}.` };
    for (const criterion of target.criteria) {
      if (baseline.assessment?.criteria[criterion.id]?.met === false
        && !Object.values(state.gaps).some((gap) => gap.attemptId === baseline.id && gap.criterionId === criterion.id)) {
        return { stage: "diagnose", targetId: target.id, instruction: `Record a precise gap for criterion ${criterion.id}.` };
      }
    }
  }

  const openGap = Object.values(state.gaps).find((gap) => !gap.resolvedAt);
  if (openGap) {
    if (openGap.remediationCount === 0) {
      return { stage: "remediate", targetId: openGap.targetId, gapId: openGap.id, instruction: "Provide the smallest intervention that addresses this gap, then remove help." };
    }
    return { stage: "reattempt", targetId: openGap.targetId, gapId: openGap.id, instruction: "Begin a fresh independent retrieval attempt for this gap." };
  }

  for (const target of targets) {
    const retrievals = Object.values(state.attempts)
      .filter((attempt) => attempt.kind === "retrieval" && attempt.targetIds.includes(target.id) && isIndependentEvidence(attempt))
      .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
    const retrieval = retrievals[0];
    if (!retrieval) return { stage: "reattempt", targetId: target.id, instruction: "Begin a clean independent target retrieval." };
    if (state.goal.retentionDays !== undefined) {
      const dueAtMs = Date.parse(retrieval.assessment?.assessedAt ?? retrieval.startedAt) + state.goal.retentionDays * 86_400_000;
      const delayed = retrievals.some((attempt) => attempt.id !== retrieval.id && Date.parse(attempt.startedAt) >= dueAtMs);
      if (!delayed) {
        return { stage: "delayed_retrieval", targetId: target.id, instruction: `A second independent retrieval must occur no earlier than ${new Date(dueAtMs).toISOString()}.` };
      }
    } else {
      const transfer = Object.values(state.attempts).find((attempt) => attempt.targetIds.includes(target.id) && isNovelTransfer(attempt, retrieval));
      if (!transfer) return { stage: "transfer", targetId: target.id, instruction: "Attempt a materially novel transfer task without help." };
    }
  }

  const completion = evaluateCompletion(state);
  return completion.complete
    ? { stage: "complete", instruction: "Completion policy is satisfied; record completion." }
    : { stage: "delayed_retrieval", instruction: completion.reasons.join("; ") };
}
