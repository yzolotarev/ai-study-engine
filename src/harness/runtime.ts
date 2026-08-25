import { randomUUID } from "node:crypto";
import { getAdapter } from "./adapters/builtins.js";
import { evaluateCompletion } from "./completion-policy.js";
import { projectHarness } from "./projector.js";
import { selectHarnessNext } from "./policies/evidence-loop.js";
import type { HarnessRepository } from "./repository.js";
import {
  HARNESS_SCHEMA_VERSION,
  type ArtifactAuthor,
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
    this.repository.append({
      eventId: this.id(),
      sessionId,
      type,
      schemaVersion: HARNESS_SCHEMA_VERSION,
      occurredAt: this.now(),
      actor,
      payload,
    } as Extract<HarnessEvent, { type: T }>);
    return this.status(sessionId).projection;
  }

  start(learnerId: string, goal: GoalInput): { sessionId: string; projection: HarnessProjection } {
    const sessionId = this.id();
    const projection = this.append(sessionId, "harness.session.started", "engine", { learnerId, goal });
    return { sessionId, projection };
  }

  confirm(sessionId: string, confirmation: string): HarnessProjection {
    return this.append(sessionId, "harness.goal.confirmed", "learner", { confirmation });
  }

  defineTargets(sessionId: string, targets?: readonly TargetDefinition[]): HarnessProjection {
    const state = this.status(sessionId).projection;
    if (!state.goal) throw new Error(`Unknown harness session: ${sessionId}`);
    return this.append(sessionId, "harness.targets.defined", "engine", {
      targets: targets ?? getAdapter(state.goal.subject).defineTargets(state.goal),
      generatedBy: targets ? "human" : "adapter",
    });
  }

  beginAttempt(sessionId: string, input: {
    kind: AttemptKind;
    targetIds?: readonly string[];
    prompt?: string;
  }): { attemptId: string; projection: HarnessProjection } {
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

  submit(sessionId: string, attemptId: string, content: string, author: ArtifactAuthor = "learner") {
    const artifactId = this.id();
    const projection = this.append(sessionId, "harness.artifact.submitted", author === "learner" ? "learner" : "ai", {
      attemptId,
      artifactId,
      author,
      content,
    });
    return { artifactId, projection };
  }

  assess(sessionId: string, attemptId: string, assessments: readonly CriterionAssessmentInput[], actor: "ai" | "human_reviewer" = "ai") {
    let projection = this.append(sessionId, "harness.attempt.assessed", actor, { attemptId, assessments });
    const attempt = projection.attempts[attemptId];
    if (attempt?.assessment) {
      for (const gap of Object.values(projection.gaps)) {
        if (!gap.resolvedAt && gap.remediationCount > 0 && attempt.targetIds.includes(gap.targetId)
          && attempt.assessment.criteria[gap.criterionId]?.met === true) {
          projection = this.append(sessionId, "harness.gap.resolved", "engine", { gapId: gap.id, attemptId });
        }
      }
    }
    return projection;
  }

  openGap(sessionId: string, input: { attemptId: string; targetId: string; criterionId: string; diagnosis: string }) {
    const gapId = this.id();
    const projection = this.append(sessionId, "harness.gap.opened", "ai", { gapId, ...input });
    return { gapId, projection };
  }

  remediate(sessionId: string, gapId: string, content: string, kind: "explanation" | "example" | "exercise" | "source" = "explanation") {
    return this.append(sessionId, "harness.remediation.provided", "ai", { gapId, content, kind });
  }

  help(sessionId: string, content: string, kind: HelpKind = "process_prompt", attemptId?: string) {
    return this.append(sessionId, "harness.help.provided", "ai", {
      ...(attemptId ? { attemptId } : {}),
      kind,
      content,
    });
  }

  complete(sessionId: string): { recorded: boolean; decision: ReturnType<typeof evaluateCompletion>; projection: HarnessProjection } {
    const before = this.status(sessionId).projection;
    const decision = evaluateCompletion(before);
    if (!decision.complete) return { recorded: false, decision, projection: before };
    const projection = this.append(sessionId, "harness.session.completed", "engine", { completionFingerprint: decision.fingerprint });
    return { recorded: projection.completedAt !== undefined, decision, projection };
  }

  status(sessionId: string) {
    const projection = projectHarness(this.repository.load(sessionId));
    return { projection, completion: evaluateCompletion(projection), next: selectHarnessNext(projection) };
  }
}
