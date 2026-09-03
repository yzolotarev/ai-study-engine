import { evaluateCompletion } from "../completion-policy.js";
import { isIndependentEvidence, isNovelTransfer } from "../evidence-validity.js";
import { selectHypothesisScaffold } from "./hypothesis-stimulation.js";
import type { AttemptKind, HarnessProjection, HypothesisScaffold, NextAction } from "../types.js";

function commitScaffold(state: HarnessProjection, targetIds: readonly string[], attemptKind: AttemptKind, attemptId?: string): HypothesisScaffold | undefined {
  if (!state.goal) return undefined;
  return selectHypothesisScaffold(state.goal, {
    phase: "commit",
    attemptKind,
    targetIds,
    ...(attemptId === undefined ? {} : { attemptId }),
  });
}

function reviseScaffold(state: HarnessProjection, gapId: string, attemptId: string, targetId: string): HypothesisScaffold | undefined {
  if (!state.goal) return undefined;
  return selectHypothesisScaffold(state.goal, {
    phase: "revise",
    gapId,
    attemptId,
    targetIds: [targetId],
  });
}

export function selectHarnessNext(state: HarnessProjection): NextAction {
  if (state.completedAt) return { stage: "done", instruction: "This session is complete; no further evidence events are accepted." };
  if (state.anomalies.length > 0) return { stage: "done", instruction: "This session is fail-closed because its journal contains audit anomalies." };
  const attempts = Object.values(state.attempts);
  const awaitingSubmission = attempts.find((attempt) => !attempt.artifact);
  if (awaitingSubmission) {
    const scaffold = awaitingSubmission.kind === "baseline" || awaitingSubmission.kind === "transfer"
      ? commitScaffold(state, awaitingSubmission.targetIds, awaitingSubmission.kind, awaitingSubmission.id)
      : undefined;
    return {
      stage: "submit",
      attemptId: awaitingSubmission.id,
      instruction: "The learner must submit their artifact for the active attempt.",
      ...(scaffold === undefined ? {} : { hypothesisScaffold: scaffold }),
    };
  }
  const awaitingAssessment = attempts.find((attempt) => attempt.artifact?.author === "learner" && !attempt.assessment);
  if (awaitingAssessment) {
    return { stage: "assess", attemptId: awaitingAssessment.id, instruction: "Assess every rubric criterion using literal learner-artifact quotes." };
  }
  if (!state.goal) return { stage: "goal", instruction: "Start with an observable learner goal." };
  if (!state.goalConfirmedAt) return { stage: "confirm", instruction: "Ask the learner to explicitly confirm the goal contract." };
  const targets = Object.values(state.targets);
  if (targets.length === 0) return { stage: "targets", instruction: "Generate or define a non-empty rubric and target set." };

  for (const target of targets) {
    const baseline = Object.values(state.attempts).find((attempt) => attempt.kind === "baseline" && attempt.targetIds.includes(target.id)
      && !attempt.contaminated && attempt.artifact?.author === "learner" && attempt.assessment);
    if (!baseline) {
      const scaffold = commitScaffold(state, [target.id], "baseline");
      return {
        stage: "baseline",
        targetId: target.id,
        instruction: `Begin an unassisted baseline for ${target.description}.`,
        ...(scaffold === undefined ? {} : { hypothesisScaffold: scaffold }),
      };
    }
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
      const scaffold = reviseScaffold(state, openGap.id, openGap.attemptId, openGap.targetId);
      return {
        stage: "remediate",
        targetId: openGap.targetId,
        gapId: openGap.id,
        instruction: "Invite a learner model revision before providing remediation; then provide the smallest intervention.",
        ...(scaffold === undefined ? {} : { hypothesisScaffold: scaffold }),
      };
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
      if (!transfer) {
      const scaffold = commitScaffold(state, [target.id], "transfer");
      return {
        stage: "transfer",
        targetId: target.id,
        instruction: "Attempt a materially novel transfer task without help.",
        ...(scaffold === undefined ? {} : { hypothesisScaffold: scaffold }),
      };
    }
    }
  }

  const completion = evaluateCompletion(state);
  return completion.complete
    ? { stage: "complete", instruction: "Completion policy is satisfied; record completion." }
    : { stage: "delayed_retrieval", instruction: completion.reasons.join("; ") };
}
