import { evaluateCompletion } from "./completion-policy.js";
import { decodeHarnessEvent } from "./event-validation.js";
import { isIndependentEvidence, validateAssessment } from "./evidence-validity.js";
import type {
  AuditAnomaly,
  HarnessEvent,
  HarnessProjection,
  ProjectedAttempt,
  ProjectedGap,
  TargetDefinition,
} from "./types.js";

interface MutableAttempt {
  id: string;
  kind: ProjectedAttempt["kind"];
  targetIds: string[];
  prompt: string;
  startedAt: string;
  contaminated: boolean;
  contaminationEventIds: string[];
  artifact?: NonNullable<ProjectedAttempt["artifact"]>;
  assessment?: NonNullable<ProjectedAttempt["assessment"]>;
}

interface MutableGap {
  id: string;
  attemptId: string;
  targetId: string;
  criterionId: string;
  diagnosis: string;
  openedAt: string;
  remediationCount: number;
  lastRemediatedAt?: string;
  resolvedByAttemptId?: string;
  resolvedAt?: string;
}

function anomaly(list: AuditAnomaly[], event: HarnessEvent, code: string, detail: string): void {
  list.push({ eventId: event.eventId, eventType: event.type, code, detail });
}

function rubricFor(targets: Record<string, TargetDefinition>, attempt: MutableAttempt) {
  return attempt.targetIds.flatMap((id) => targets[id]?.criteria ?? []);
}

function activeAttempt(attempts: Record<string, MutableAttempt>): MutableAttempt | undefined {
  return Object.values(attempts).reverse().find((attempt) => !attempt.artifact);
}

function awaitingLearnerAssessment(attempts: Record<string, MutableAttempt>): MutableAttempt | undefined {
  return Object.values(attempts).reverse().find((attempt) => attempt.artifact?.author === "learner" && !attempt.assessment);
}

/** Pure, fail-closed replay. Invalid events are retained as anomalies but do not
 * mutate evidence-bearing state. Array order is ledger order; timestamps never reorder history. */
export function projectHarness(events: readonly unknown[]): HarnessProjection {
  let sessionId: string | undefined;
  let learnerId: string | undefined;
  let goal: HarnessProjection["goal"];
  let goalConfirmedAt: string | undefined;
  let completedAt: string | undefined;
  let completionFingerprint: string | undefined;
  const targets: Record<string, TargetDefinition> = {};
  const attempts: Record<string, MutableAttempt> = {};
  const gaps: Record<string, MutableGap> = {};
  const anomalies: AuditAnomaly[] = [];
  const eventIds = new Set<string>();
  let lastOccurredAt = Number.NEGATIVE_INFINITY;

  const snapshot = (): HarnessProjection => ({
    ...(sessionId ? { sessionId } : {}),
    ...(learnerId ? { learnerId } : {}),
    ...(goal ? { goal: structuredClone(goal) } : {}),
    ...(goalConfirmedAt ? { goalConfirmedAt } : {}),
    targets: structuredClone(targets),
    attempts: structuredClone(attempts),
    gaps: structuredClone(gaps),
    anomalies: structuredClone(anomalies),
    ...(completedAt ? { completedAt } : {}),
    ...(completionFingerprint ? { completionFingerprint } : {}),
  });

  for (const [index, rawEvent] of events.entries()) {
    const decoded = decodeHarnessEvent(rawEvent, index);
    if (!decoded.event) {
      if (decoded.anomaly) anomalies.push(decoded.anomaly);
      continue;
    }
    const event = decoded.event;
    if (eventIds.has(event.eventId)) {
      anomaly(anomalies, event, "DUPLICATE_EVENT_ID", "event id already occurred");
      continue;
    }
    eventIds.add(event.eventId);
    const occurredAtMs = Date.parse(event.occurredAt);
    if (occurredAtMs < lastOccurredAt) {
      anomaly(anomalies, event, "OUT_OF_ORDER_TIME", "ledger timestamps must not move backwards");
      continue;
    }
    lastOccurredAt = occurredAtMs;
    if (sessionId && event.sessionId !== sessionId) {
      anomaly(anomalies, event, "SESSION_MISMATCH", `expected ${sessionId}`);
      continue;
    }
    if (completedAt) {
      anomaly(anomalies, event, "SESSION_TERMINAL", "events after completion cannot change projected state");
      continue;
    }

    switch (event.type) {
      case "harness.session.started": {
        if (sessionId) {
          anomaly(anomalies, event, "DUPLICATE_START", "session already started");
          break;
        }
        const { goal: proposed, learnerId: proposedLearner } = event.payload;
        if (event.actor !== "engine" || !["general", "history", "law", "economics"].includes(proposed.subject)
          || !proposedLearner.trim() || !proposed.capability.trim() || !proposed.targetTask.trim() || !proposed.successCriteria.trim()) {
          anomaly(anomalies, event, "INVALID_GOAL", "goal and learner fields must be non-empty");
          break;
        }
        if (proposed.retentionDays !== undefined && (!Number.isInteger(proposed.retentionDays) || proposed.retentionDays < 1)) {
          anomaly(anomalies, event, "INVALID_RETENTION", "retentionDays must be a positive integer");
          break;
        }
        sessionId = event.sessionId;
        learnerId = proposedLearner;
        goal = proposed;
        break;
      }
      case "harness.goal.confirmed": {
        if (!goal || goalConfirmedAt) {
          anomaly(anomalies, event, "INVALID_CONFIRMATION_ORDER", "confirmation requires one unconfirmed goal");
          break;
        }
        if (event.actor !== "learner" || !event.payload.confirmation.trim()) {
          anomaly(anomalies, event, "INVALID_CONFIRMATION", "only a learner's explicit non-empty confirmation counts");
          break;
        }
        goalConfirmedAt = event.occurredAt;
        break;
      }
      case "harness.targets.defined": {
        if (!goalConfirmedAt || Object.keys(targets).length > 0 || !["engine", "human_reviewer"].includes(event.actor)) {
          anomaly(anomalies, event, "INVALID_TARGET_ORDER", "targets require confirmation, an authorized actor, and may be defined once");
          break;
        }
        if (event.payload.targets.length === 0) {
          anomaly(anomalies, event, "EMPTY_TARGETS", "empty target set cannot support completion");
          break;
        }
        const ids = new Set<string>();
        const globalCriterionIds = new Set<string>();
        let valid = true;
        for (const target of event.payload.targets) {
          const criterionIds = new Set(target.criteria.map((criterion) => criterion.id));
          if (!target.id.trim() || !target.description.trim() || ids.has(target.id) || target.criteria.length === 0
            || criterionIds.size !== target.criteria.length || target.criteria.some((criterion) =>
              !criterion.id.trim() || !criterion.description.trim() || globalCriterionIds.has(criterion.id))) {
            valid = false;
          }
          ids.add(target.id);
          for (const criterion of target.criteria) globalCriterionIds.add(criterion.id);
        }
        if (!valid) {
          anomaly(anomalies, event, "INVALID_TARGETS", "targets and criteria require unique non-empty ids and descriptions");
          break;
        }
        for (const target of event.payload.targets) targets[target.id] = target;
        break;
      }
      case "harness.attempt.started": {
        if (event.actor !== "engine" || !goalConfirmedAt || Object.keys(targets).length === 0 || attempts[event.payload.attemptId]) {
          anomaly(anomalies, event, "INVALID_ATTEMPT_START", "attempt requires targets and a unique id");
          break;
        }
        if (!event.payload.attemptId.trim() || !event.payload.prompt.trim() || event.payload.targetIds.length === 0
          || new Set(event.payload.targetIds).size !== event.payload.targetIds.length
          || event.payload.targetIds.some((id) => !targets[id])) {
          anomaly(anomalies, event, "INVALID_ATTEMPT_TARGET", "attempt must reference unique known targets and non-empty ids/prompt");
          break;
        }
        if (activeAttempt(attempts) || awaitingLearnerAssessment(attempts)) {
          anomaly(anomalies, event, "OVERLAPPING_ATTEMPT", "submit and assess the current learner attempt before starting another");
          break;
        }
        const targetAttempts = Object.values(attempts).filter((attempt) => attempt.targetIds.some((id) => event.payload.targetIds.includes(id)));
        if (event.payload.kind === "baseline" && targetAttempts.some((attempt) =>
          attempt.kind === "baseline" && !attempt.contaminated && attempt.assessment)) {
          anomaly(anomalies, event, "DUPLICATE_BASELINE", "a target may have only one clean assessed baseline");
          break;
        }
        const hasBaselineForEveryTarget = event.payload.targetIds.every((targetId) => Object.values(attempts).some((attempt) =>
          attempt.kind === "baseline" && attempt.targetIds.includes(targetId) && !attempt.contaminated
            && attempt.artifact?.author === "learner" && attempt.assessment));
        if (event.payload.kind !== "baseline" && !hasBaselineForEveryTarget) {
          anomaly(anomalies, event, "BASELINE_REQUIRED", "non-baseline evidence requires a clean assessed baseline for every target");
          break;
        }
        if (event.payload.kind === "transfer") {
          const retrievalExistsForEveryTarget = event.payload.targetIds.every((targetId) => Object.values(attempts).some((attempt) =>
            attempt.kind === "retrieval" && attempt.targetIds.includes(targetId) && isIndependentEvidence(attempt)
              && Date.parse(event.occurredAt) > Date.parse(attempt.assessment?.assessedAt ?? attempt.startedAt)));
          if (!retrievalExistsForEveryTarget) {
            anomaly(anomalies, event, "PRIMARY_RETRIEVAL_REQUIRED", "transfer must start after a passing assessed primary retrieval for every target");
            break;
          }
        }
        attempts[event.payload.attemptId] = {
          id: event.payload.attemptId,
          kind: event.payload.kind,
          targetIds: [...event.payload.targetIds],
          prompt: event.payload.prompt,
          startedAt: event.occurredAt,
          contaminated: false,
          contaminationEventIds: [],
        };
        break;
      }
      case "harness.help.provided": {
        const attempt = event.payload.attemptId ? attempts[event.payload.attemptId] : activeAttempt(attempts);
        const substantive = event.payload.kind !== "process_prompt";
        if (!["ai", "human_reviewer"].includes(event.actor)) {
          anomaly(anomalies, event, "INVALID_HELP_ACTOR", "help must be recorded by AI or a human reviewer");
          break;
        }
        if (event.payload.attemptId && !attempt) {
          anomaly(anomalies, event, "UNKNOWN_ATTEMPT", "help references an unknown attempt");
          break;
        }
        if (!event.payload.content.trim()) {
          anomaly(anomalies, event, "EMPTY_HELP", "help content is empty");
          break;
        }
        if (substantive && !attempt) {
          anomaly(anomalies, event, "HELP_WITHOUT_ACTIVE_ATTEMPT", "substantive help requires an active unsubmitted attempt");
          break;
        }
        if (attempt?.artifact) {
          anomaly(anomalies, event, "HELP_AFTER_SUBMISSION", "post-submission help cannot change a finished production attempt");
          break;
        }
        if (attempt && substantive) {
          attempt.contaminated = true;
          attempt.contaminationEventIds.push(event.eventId);
        }
        break;
      }
      case "harness.artifact.submitted": {
        const attempt = attempts[event.payload.attemptId];
        const actorMatchesAuthor = (event.payload.author === "learner" && event.actor === "learner")
          || (event.payload.author === "ai" && event.actor === "ai")
          || (event.payload.author === "shared" && ["ai", "human_reviewer"].includes(event.actor));
        const duplicateArtifactId = Object.values(attempts).some((candidate) => candidate.artifact?.id === event.payload.artifactId);
        if (!attempt || attempt.artifact || duplicateArtifactId || !actorMatchesAuthor || !event.payload.artifactId.trim() || !event.payload.content.trim()) {
          anomaly(anomalies, event, "INVALID_SUBMISSION", "submission requires matching actor/authorship, a known open attempt, and non-empty artifact");
          break;
        }
        attempt.artifact = {
          id: event.payload.artifactId,
          author: event.payload.author,
          content: event.payload.content,
          submittedAt: event.occurredAt,
        };
        break;
      }
      case "harness.attempt.assessed": {
        const attempt = attempts[event.payload.attemptId];
        if (!attempt || !attempt.artifact || attempt.assessment) {
          anomaly(anomalies, event, "INVALID_ASSESSMENT_ORDER", "assessment requires one submitted, unassessed attempt");
          break;
        }
        const validation = validateAssessment(attempt.artifact, rubricFor(targets, attempt), event.payload.assessments);
        if (!["ai", "human_reviewer"].includes(event.actor) || !validation.valid) {
          anomaly(anomalies, event, "INVALID_ASSESSMENT", event.actor === "learner" ? "learner cannot assess their own evidence" : validation.reasons.join("; "));
          break;
        }
        attempt.assessment = {
          assessedAt: event.occurredAt,
          criteria: validation.criteria,
          allMet: Object.values(validation.criteria).every((item) => item.met),
        };
        break;
      }
      case "harness.gap.opened": {
        const attempt = attempts[event.payload.attemptId];
        const criterion = attempt?.assessment?.criteria[event.payload.criterionId];
        const criterionBelongsToTarget = targets[event.payload.targetId]?.criteria.some((item) => item.id === event.payload.criterionId) === true;
        if (!["ai", "human_reviewer"].includes(event.actor) || !event.payload.gapId.trim() || !attempt
          || !attempt.targetIds.includes(event.payload.targetId) || !criterionBelongsToTarget || !criterion || criterion.met
          || gaps[event.payload.gapId] || !event.payload.diagnosis.trim()) {
          anomaly(anomalies, event, "INVALID_GAP", "gap must identify a failed assessed criterion");
          break;
        }
        gaps[event.payload.gapId] = {
          id: event.payload.gapId,
          attemptId: event.payload.attemptId,
          targetId: event.payload.targetId,
          criterionId: event.payload.criterionId,
          diagnosis: event.payload.diagnosis,
          openedAt: event.occurredAt,
          remediationCount: 0,
        };
        break;
      }
      case "harness.remediation.provided": {
        const gap = gaps[event.payload.gapId];
        if (!["ai", "human_reviewer"].includes(event.actor) || !gap || gap.resolvedAt || !event.payload.content.trim()) {
          anomaly(anomalies, event, "INVALID_REMEDIATION", "remediation requires an open gap and content");
          break;
        }
        gap.remediationCount += 1;
        gap.lastRemediatedAt = event.occurredAt;
        const active = activeAttempt(attempts);
        if (active) {
          active.contaminated = true;
          active.contaminationEventIds.push(event.eventId);
        }
        break;
      }
      case "harness.gap.resolved": {
        const gap = gaps[event.payload.gapId];
        const attempt = attempts[event.payload.attemptId];
        if (event.actor !== "engine" || !gap || gap.resolvedAt || gap.remediationCount === 0 || !gap.lastRemediatedAt
          || !attempt || attempt.kind === "baseline" || attempt.contaminated || attempt.artifact?.author !== "learner"
          || attempt.assessment?.criteria[gap.criterionId]?.met !== true
          || Date.parse(attempt.startedAt) <= Date.parse(gap.lastRemediatedAt)) {
          anomaly(anomalies, event, "INVALID_GAP_RESOLUTION", "resolution requires remediation and a clean passing attempt started after the latest remediation");
          break;
        }
        gap.resolvedByAttemptId = attempt.id;
        gap.resolvedAt = event.occurredAt;
        break;
      }
      case "harness.session.completed": {
        if (completedAt || event.actor !== "engine") {
          anomaly(anomalies, event, "DUPLICATE_COMPLETION", "session already completed or actor is unauthorized");
          break;
        }
        const decision = evaluateCompletion(snapshot());
        if (!decision.complete || decision.fingerprint !== event.payload.completionFingerprint) {
          anomaly(anomalies, event, "INVALID_COMPLETION", decision.reasons.join("; ") || "completion fingerprint mismatch");
          break;
        }
        completedAt = event.occurredAt;
        completionFingerprint = event.payload.completionFingerprint;
        break;
      }
    }
  }

  return snapshot();
}
