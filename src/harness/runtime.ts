import { randomUUID } from "node:crypto";
import { getAdapter } from "./adapters/builtins.js";
import { evaluateCompletion } from "./completion-policy.js";
import { projectHarness } from "./projector.js";
import { selectHarnessNext } from "./policies/evidence-loop.js";
import type { HarnessRepository } from "./repository.js";
import {
  HARNESS_SCHEMA_VERSION,
  type AttemptKind,
  type CriterionAssessmentInput,
  type GoalInput,
  type HarnessActor,
  type HarnessEvent,
  type HarnessProjection,
  type HelpKind,
  type TargetDefinition,
} from "./types.js";

export interface HarnessRuntimeOptions {
  readonly now?: () => string;
  readonly id?: () => string;
}

const TRUSTED_CONFIRM = Symbol("trusted-learner-confirm");
const TRUSTED_SUBMIT = Symbol("trusted-learner-submit");

function nonEmpty(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be a non-empty string`);
}

function oneOf(value: unknown, allowed: readonly string[], name: string): asserts value is string {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(`${name} must be one of: ${allowed.join(", ")}`);
  }
}

/** Kernel runtime for engine/AI operations. Learner-authored events are absent
 * from this public surface and are available only through TrustedLearnerIngress. */
export class StudyHarness {
  private readonly now: () => string;
  private readonly id: () => string;

  constructor(private readonly repository: HarnessRepository, options: HarnessRuntimeOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.id = options.id ?? randomUUID;
  }

  private append<T extends HarnessEvent["type"]>(
    sessionId: string,
    type: T,
    actor: HarnessActor,
    payload: Extract<HarnessEvent, { type: T }>["payload"],
  ): HarnessProjection {
    const existing = this.repository.load(sessionId);
    const before = projectHarness(existing);
    if (before.anomalies.length > 0) {
      throw new Error(`Harness journal is fail-closed with ${before.anomalies.length} audit anomaly/anomalies`);
    }
    const eventId = this.id();
    const event = {
      eventId,
      sessionId,
      type,
      schemaVersion: HARNESS_SCHEMA_VERSION,
      occurredAt: this.now(),
      actor,
      payload,
    } as Extract<HarnessEvent, { type: T }>;
    const preview = projectHarness([...existing, event]);
    const ownAnomaly = preview.anomalies.find((item) => item.eventId === eventId);
    if (ownAnomaly) throw new Error(`${ownAnomaly.code}: ${ownAnomaly.detail}`);
    this.repository.append(event);
    return preview;
  }

  start(learnerId: string, goal: GoalInput): { sessionId: string; projection: HarnessProjection } {
    nonEmpty(learnerId, "learnerId");
    nonEmpty(goal?.capability, "goal.capability");
    nonEmpty(goal?.targetTask, "goal.targetTask");
    nonEmpty(goal?.successCriteria, "goal.successCriteria");
    oneOf(goal?.subject, ["general", "history", "law", "economics"], "goal.subject");
    if (goal.retentionDays !== undefined && (!Number.isInteger(goal.retentionDays) || goal.retentionDays < 1)) {
      throw new Error("goal.retentionDays must be a positive integer");
    }
    const sessionId = this.id();
    const projection = this.append(sessionId, "harness.session.started", "engine", { learnerId, goal });
    return { sessionId, projection };
  }

  [TRUSTED_CONFIRM](sessionId: string, confirmation: string): HarnessProjection {
    nonEmpty(sessionId, "sessionId");
    nonEmpty(confirmation, "confirmation");
    return this.append(sessionId, "harness.goal.confirmed", "learner", { confirmation });
  }

  [TRUSTED_SUBMIT](sessionId: string, attemptId: string, content: string) {
    nonEmpty(sessionId, "sessionId");
    nonEmpty(attemptId, "attemptId");
    nonEmpty(content, "content");
    const artifactId = this.id();
    const projection = this.append(sessionId, "harness.artifact.submitted", "learner", {
      attemptId,
      artifactId,
      author: "learner",
      content,
    });
    return { artifactId, projection };
  }

  defineTargets(sessionId: string, targets?: readonly TargetDefinition[]): HarnessProjection {
    nonEmpty(sessionId, "sessionId");
    const state = this.status(sessionId).projection;
    if (!state.goal) throw new Error(`Unknown or invalid harness session: ${sessionId}`);
    const definitions = targets ?? getAdapter(state.goal.subject).defineTargets(state.goal);
    return this.append(sessionId, "harness.targets.defined", "engine", {
      targets: definitions,
      generatedBy: targets ? "human" : "adapter",
    });
  }

  beginAttempt(sessionId: string, input: {
    kind: AttemptKind;
    targetIds?: readonly string[];
    prompt?: string;
  }): { attemptId: string; projection: HarnessProjection } {
    nonEmpty(sessionId, "sessionId");
    oneOf(input?.kind, ["baseline", "retrieval", "transfer"], "attempt kind");
    if (input.targetIds !== undefined && (!Array.isArray(input.targetIds) || input.targetIds.some((id) => typeof id !== "string"))) {
      throw new Error("targetIds must be an array of strings");
    }
    if (input.prompt !== undefined && typeof input.prompt !== "string") throw new Error("prompt must be a string");
    const state = this.status(sessionId).projection;
    const targetIds = input.targetIds ?? Object.keys(state.targets);
    let prompt = input.prompt;
    if (!prompt && state.goal && input.kind === "transfer" && targetIds[0]) {
      const target = state.targets[targetIds[0]];
      if (target) prompt = getAdapter(state.goal.subject).transferPrompt(state.goal, target);
    }
    prompt ??= input.kind === "baseline"
      ? `Without assistance, attempt: ${state.goal?.targetTask ?? "the target task"}`
      : `Without assistance, retrieve: ${state.goal?.targetTask ?? "the target task"}`;
    const attemptId = this.id();
    const projection = this.append(sessionId, "harness.attempt.started", "engine", {
      attemptId,
      kind: input.kind,
      targetIds,
      prompt,
    });
    return { attemptId, projection };
  }

  /** Record model/shared material. This method can never emit learner actor or authorship. */
  recordArtifact(sessionId: string, attemptId: string, content: string, author: "ai" | "shared") {
    nonEmpty(sessionId, "sessionId");
    nonEmpty(attemptId, "attemptId");
    nonEmpty(content, "content");
    oneOf(author, ["ai", "shared"], "artifact author");
    const artifactId = this.id();
    const projection = this.append(sessionId, "harness.artifact.submitted", "ai", {
      attemptId,
      artifactId,
      author,
      content,
    });
    return { artifactId, projection };
  }

  assess(sessionId: string, attemptId: string, assessments: readonly CriterionAssessmentInput[], actor: "ai" | "human_reviewer" = "ai") {
    nonEmpty(sessionId, "sessionId");
    nonEmpty(attemptId, "attemptId");
    if (!Array.isArray(assessments)) throw new Error("assessments must be an array");
    oneOf(actor, ["ai", "human_reviewer"], "assessment actor");
    let projection = this.append(sessionId, "harness.attempt.assessed", actor, { attemptId, assessments });
    const attempt = projection.attempts[attemptId];
    if (attempt?.assessment) {
      for (const gap of Object.values(projection.gaps)) {
        if (!gap.resolvedAt && gap.lastRemediatedAt && attempt.targetIds.includes(gap.targetId)
          && attempt.assessment.criteria[gap.criterionId]?.met === true
          && Date.parse(attempt.startedAt) > Date.parse(gap.lastRemediatedAt)) {
          projection = this.append(sessionId, "harness.gap.resolved", "engine", { gapId: gap.id, attemptId });
        }
      }
    }
    return projection;
  }

  openGap(sessionId: string, input: { attemptId: string; targetId: string; criterionId: string; diagnosis: string }) {
    nonEmpty(sessionId, "sessionId");
    nonEmpty(input?.attemptId, "attemptId");
    nonEmpty(input?.targetId, "targetId");
    nonEmpty(input?.criterionId, "criterionId");
    nonEmpty(input?.diagnosis, "diagnosis");
    const gapId = this.id();
    const projection = this.append(sessionId, "harness.gap.opened", "ai", { gapId, ...input });
    return { gapId, projection };
  }

  remediate(sessionId: string, gapId: string, content: string, kind: "explanation" | "example" | "exercise" | "source" = "explanation") {
    nonEmpty(sessionId, "sessionId");
    nonEmpty(gapId, "gapId");
    nonEmpty(content, "content");
    oneOf(kind, ["explanation", "example", "exercise", "source"], "remediation kind");
    return this.append(sessionId, "harness.remediation.provided", "ai", { gapId, content, kind });
  }

  help(sessionId: string, content: string, kind: HelpKind = "process_prompt", attemptId?: string) {
    nonEmpty(sessionId, "sessionId");
    nonEmpty(content, "content");
    oneOf(kind, ["process_prompt", "content_hint", "worked_example", "answer"], "help kind");
    if (attemptId !== undefined) nonEmpty(attemptId, "attemptId");
    return this.append(sessionId, "harness.help.provided", "ai", {
      ...(attemptId === undefined ? {} : { attemptId }),
      kind,
      content,
    });
  }

  complete(sessionId: string): {
    recorded: boolean;
    alreadyCompleted: boolean;
    decision: ReturnType<typeof evaluateCompletion>;
    projection: HarnessProjection;
  } {
    nonEmpty(sessionId, "sessionId");
    const before = this.status(sessionId).projection;
    const decision = evaluateCompletion(before);
    if (before.completedAt) return { recorded: true, alreadyCompleted: true, decision, projection: before };
    if (!decision.complete) return { recorded: false, alreadyCompleted: false, decision, projection: before };
    const projection = this.append(sessionId, "harness.session.completed", "engine", { completionFingerprint: decision.fingerprint });
    return { recorded: projection.completedAt !== undefined, alreadyCompleted: false, decision, projection };
  }

  status(sessionId: string) {
    const projection = projectHarness(this.repository.load(sessionId));
    return { projection, completion: evaluateCompletion(projection), next: selectHarnessNext(projection) };
  }
}

/** Explicit trust boundary for human-operated adapters. It is intentionally not
 * registered as an AI-callable Pi tool. */
export class TrustedLearnerIngress {
  constructor(private readonly harness: StudyHarness) {}

  confirmGoal(sessionId: string, confirmation: string): HarnessProjection {
    return this.harness[TRUSTED_CONFIRM](sessionId, confirmation);
  }

  submitArtifact(sessionId: string, attemptId: string, content: string) {
    return this.harness[TRUSTED_SUBMIT](sessionId, attemptId, content);
  }
}
