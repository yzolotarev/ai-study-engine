import { fingerprint } from "./fingerprints.js";
import { elapsedDays, isIndependentEvidence, isNovelTransfer } from "./evidence-validity.js";
import type { CompletionDecision, HarnessProjection, ProjectedAttempt } from "./types.js";

function covers(attempt: ProjectedAttempt, targetId: string): boolean {
  return attempt.targetIds.includes(targetId);
}

export function evaluateCompletion(state: HarnessProjection): CompletionDecision {
  const reasons: string[] = [];
  const qualifying = new Set<string>();
  const targets = Object.values(state.targets);
  const attempts = Object.values(state.attempts);

  if (!state.goal) reasons.push("goal is missing");
  if (!state.goalConfirmedAt) reasons.push("learner confirmation is missing");
  if (targets.length === 0) reasons.push("target set is empty");
  const openGaps = Object.values(state.gaps).filter((gap) => !gap.resolvedAt);
  if (openGaps.length > 0) reasons.push(`${openGaps.length} gap(s) remain open`);

  for (const target of targets) {
    const baseline = attempts.find((attempt) => attempt.kind === "baseline" && covers(attempt, target.id)
      && !attempt.contaminated && attempt.artifact?.author === "learner" && attempt.assessment);
    if (!baseline) {
      reasons.push(`target ${target.id} has no clean assessed baseline`);
    } else {
      for (const criterion of target.criteria) {
        if (baseline.assessment?.criteria[criterion.id]?.met === false) {
          const gap = Object.values(state.gaps).find((candidate) =>
            candidate.attemptId === baseline.id && candidate.targetId === target.id && candidate.criterionId === criterion.id,
          );
          if (!gap) reasons.push(`target ${target.id} has undiagnosed baseline failure ${criterion.id}`);
          else if (!gap.resolvedAt) reasons.push(`baseline gap ${gap.id} is unresolved`);
        }
      }
    }

    const cleanRetrievals = attempts
      .filter((attempt) => attempt.kind === "retrieval" && covers(attempt, target.id) && isIndependentEvidence(attempt))
      .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
    const primary = cleanRetrievals[0];
    if (!primary) {
      reasons.push(`target ${target.id} has no independent passing retrieval`);
      continue;
    }
    qualifying.add(primary.id);

    const requiredDelay = state.goal?.retentionDays ?? 1;
    const delayed = cleanRetrievals.find((attempt) =>
      attempt.id !== primary.id
      && elapsedDays(primary.assessment?.assessedAt ?? primary.startedAt, attempt.startedAt) >= requiredDelay,
    );
    const transfer = attempts.find((attempt) =>
      covers(attempt, target.id) && isNovelTransfer(attempt, primary),
    );

    if (state.goal?.retentionDays !== undefined) {
      if (!delayed) reasons.push(`target ${target.id} lacks retrieval after ${state.goal.retentionDays} real day(s)`);
      else qualifying.add(delayed.id);
    } else if (!transfer && !delayed) {
      reasons.push(`target ${target.id} lacks novel transfer or real delayed retrieval`);
    } else {
      if (transfer) qualifying.add(transfer.id);
      if (delayed) qualifying.add(delayed.id);
    }
  }

  const qualifyingAttemptIds = [...qualifying].sort();
  const complete = reasons.length === 0;
  return {
    complete,
    reasons,
    qualifyingAttemptIds,
    fingerprint: fingerprint({ sessionId: state.sessionId, complete, reasons, qualifyingAttemptIds }),
  };
}
