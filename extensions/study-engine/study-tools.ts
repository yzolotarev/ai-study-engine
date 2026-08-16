import { StudyStore } from "../../src/db/store.js";
import { CONCEPTUAL_DIALOGUE_V1 } from "../../src/protocols/conceptual-dialogue.js";
import { nextMove } from "../../src/core/protocol-executor.js";
import { parseGoalContract } from "../../src/core/goal-contract.js";
import { enforceProvenance } from "../../src/core/provenance-enforcement.js";
import { assessArtifact } from "../../src/core/assessment-rubric.js";
import { loadLocalConfig, runCaptureThenTranscribe } from "../../src/adapters/tldraw-bridge.js";
import { selectNextAction } from "../../src/core/runtime-controller.js";
import { chooseMinimalHelp } from "../../src/core/help-controller.js";
import { deriveReadiness, type ObjectiveKind } from "../../src/core/mastery.js";
import { computeReviewDueAt } from "../../src/core/review-scheduler.js";
import type { AssessmentSnapshot, MasteryDimensions } from "../../src/core/types.js";

export interface StudyToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
  readonly handler: (store: StudyStore, params: Record<string, unknown>) => unknown;
}

export const STUDY_TOOLS: readonly StudyToolDefinition[] = [
  {
    name: "study_start",
    description:
      "Start a new study session. Captures the learner-originated goal contract and returns the first protocol move.",
    parameters: {
      type: "object",
      properties: {
        capability: { type: "string", description: "What the learner wants to be able to do" },
        targetTask: { type: "string", description: "How the capability will be verified" },
        successCriteria: { type: "string", description: "What counts as success" },
      },
      required: ["capability", "targetTask", "successCriteria"],
    },
    handler: (store, params) => {
      const capability = String(params.capability ?? "");
      const targetTask = String(params.targetTask ?? "");
      const successCriteria = String(params.successCriteria ?? "");

      const draft = parseGoalContract({ capability, targetTask, successCriteria });

      const learnerId = "learner-1";
      store.ensureUser(learnerId);

      const objectiveId = store.createObjective({
        userId: learnerId,
        title: draft.capability,
        observableOutcome: draft.targetTask,
        targetTask: draft.targetTask,
        assessmentFormat: "oral",
        stakes: "normal",
        provenance: { kind: "PRODUCT_DECISION", sourceIds: [], policyVersion: "v1" },
      });

      const session = store.createSession(learnerId, objectiveId);

      const contractId = `contract-${session.id}`;
      store.saveGoalContract({
        contractId,
        learnerId,
        capability: draft.capability,
        targetTask: draft.targetTask,
        successCriteria: draft.successCriteria,
        learnerConfirmed: true,
        createdAt: new Date().toISOString(),
        confirmedAt: new Date().toISOString(),
        ...(draft.allowedHints !== undefined ? { allowedHints: draft.allowedHints } : {}),
        ...(draft.retentionDays !== undefined ? { retentionDays: draft.retentionDays } : {}),
      } as any);

      store.linkSessionContract(session.id, contractId);

      const firstMove = nextMove(CONCEPTUAL_DIALOGUE_V1, []);

      return {
        contractId,
        sessionId: session.id,
        protocolId: CONCEPTUAL_DIALOGUE_V1.protocolId,
        protocolVersion: CONCEPTUAL_DIALOGUE_V1.version,
        firstMove: firstMove
          ? {
              nodeId: firstMove.nodeId,
              operation: firstMove.operation,
              instruction: firstMove.instruction,
            }
          : undefined,
      };
    },
  },
  {
    name: "study_status",
    description:
      "Return the current study session status including protocol position and contamination state.",
    parameters: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "The study session ID" },
      },
      required: ["sessionId"],
    },
    handler: (store, params) => {
      const sessionId = String(params.sessionId ?? "");
      const session = store.getSession(sessionId);
      if (!session) {
        return { error: `Session not found: ${sessionId}` };
      }

      const contaminationRows = store.db
        .prepare(
          `SELECT target_id, scope, status, contaminating_help_level, opened_at
           FROM contamination_records
           WHERE study_session_id = ? AND status = 'contaminated'`,
        )
        .all(sessionId) as unknown as Array<{
        target_id: string;
        scope: string;
        status: string;
        contaminating_help_level: string;
        opened_at: string;
      }>;

      const completedArtifacts = store.db
        .prepare(
          `SELECT operation, target_id, status
           FROM operation_attempts
           WHERE study_session_id = ?`,
        )
        .all(sessionId) as unknown as Array<{
        operation: string;
        target_id: string;
        status: string;
      }>;

      return {
        sessionId,
        currentState: session.currentState,
        stateVersion: session.stateVersion,
        protocolId: CONCEPTUAL_DIALOGUE_V1.protocolId,
        protocolVersion: CONCEPTUAL_DIALOGUE_V1.version,
        contaminationCount: contaminationRows.length,
        contaminatedTargets: contaminationRows.map((row) => ({
          targetId: row.target_id,
          scope: row.scope,
          helpLevel: row.contaminating_help_level,
          openedAt: row.opened_at,
        })),
        operationCount: completedArtifacts.length,
        completedOperations: completedArtifacts.map((row) => ({
          operation: row.operation,
          targetId: row.target_id,
          status: row.status,
        })),
      };
    },
  },
  {
    name: "study_record_artifact",
    description:
      "Record a learner-produced artifact and advance the protocol if the required evidence is complete.",
    parameters: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "The study session ID" },
        artifactType: { type: "string", description: "The type of artifact produced" },
        artifactJson: { type: "string", description: "The artifact content as JSON" },
      },
      required: ["sessionId", "artifactType", "artifactJson"],
    },
    handler: (store, params) => {
      const sessionId = String(params.sessionId ?? "");
      const artifactType = String(params.artifactType ?? "");
      const artifactJson = String(params.artifactJson ?? "{}");
      const targetId = params.targetId !== undefined ? String(params.targetId) : undefined;

      const session = store.getSession(sessionId);
      if (!session) {
        return { error: `Session not found: ${sessionId}` };
      }

      // Map the artifact type (an evidence token) to its protocol node.
      const node = CONCEPTUAL_DIALOGUE_V1.nodes.find((n) => n.requiredEvidence.includes(artifactType));
      if (!node) {
        return { error: `Unknown artifactType '${artifactType}'` };
      }

      // Evidence comes from the database only. Compute the current move from the
      // evidence recorded BEFORE this artifact (mirrors the prior contract where
      // the caller's completedArtifacts were pre-record evidence). Caller-supplied
      // completedArtifacts are intentionally ignored.
      const completedBefore = store.getValidProtocolEvidence(sessionId);
      const currentMove = nextMove(CONCEPTUAL_DIALOGUE_V1, completedBefore);
      if (!currentMove) {
        // Protocol already complete; still persist this artifact's evidence.
        store.recordProtocolEvidence({ sessionId, nodeId: node.nodeId, evidenceToken: artifactType });
        const completedAfter = store.getValidProtocolEvidence(sessionId);
        return { status: "protocol_complete", sessionId, evidence: completedAfter, protocolComplete: true };
      }

      const contaminationStatus = targetId ? store.getContaminationStatus(targetId) : undefined;

      const enforcement = enforceProvenance(currentMove, contaminationStatus?.status);

      const opInput: Parameters<typeof store.recordOperation>[0] = {
        sessionId,
        operation: currentMove.operation,
        author: "learner",
        helpLevel: enforcement.contaminationBlocked ? "none" : currentMove.maxHelpLevel,
        contaminationScope: "target",
        artifactJson,
        confidence: "high",
        status: enforcement.contaminationBlocked ? "contaminated" : "clean",
      };
      if (targetId) opInput.targetId = targetId;
      const operationId = store.recordOperation(opInput);

      // Persist this artifact's evidence in SQLite (the source of truth).
      store.recordProtocolEvidence({ sessionId, nodeId: node.nodeId, evidenceToken: artifactType });
      const completedAfter = store.getValidProtocolEvidence(sessionId);
      const nextMoveAfter = nextMove(CONCEPTUAL_DIALOGUE_V1, completedAfter);

      const parsedContent: Record<string, unknown> = JSON.parse(artifactJson);
      const assessment = assessArtifact({
        artifactId: operationId,
        protocolNodeId: currentMove.nodeId,
        content: parsedContent,
      });

      return {
        status: "recorded",
        sessionId,
        operationId,
        artifactType,
        evidence: completedAfter,
        contaminationBlocked: enforcement.contaminationBlocked,
        enforcedHelpLevel: enforcement.enforcedHelpLevel,
        assessment: {
          score: assessment.score,
          maxScore: assessment.maxScore,
          passed: assessment.passed,
          feedback: assessment.feedback,
        },
        currentMove: {
          nodeId: enforcement.move.nodeId,
          operation: enforcement.move.operation,
          instruction: enforcement.move.instruction,
        },
        nextMove: nextMoveAfter
          ? {
              nodeId: nextMoveAfter.nodeId,
              operation: nextMoveAfter.operation,
              instruction: nextMoveAfter.instruction,
            }
          : undefined,
        protocolComplete: !nextMoveAfter,
      };
    },
  },
  {
    name: "study_capture_canvas",
    description:
      "Run Capture Core then Gemma transcription; record a NON-canonical, NON-learner-owned canvas artifact. Capture must precede interpretation.",
    parameters: {
      type: "object",
      properties: { sessionId: { type: "string", description: "The study session ID" } },
      required: ["sessionId"],
    },
    handler: (store, params) => {
      const sessionId = String(params.sessionId ?? "");
      const session = store.getSession(sessionId);
      if (!session) return { error: `Session not found: ${sessionId}` };
      const cfg = loadLocalConfig();
      const result = runCaptureThenTranscribe(cfg);
      if (!result.ok || !result.runId) {
        return {
          error: "capture_pipeline_failed",
          detail: result.error ?? "unknown",
          runId: result.runId ?? null,
          canonical: false,
          learnerOwned: false,
        };
      }
      store.recordCanvasArtifact({
        runId: result.runId,
        sessionId,
        captureJson: JSON.stringify(result.captureJson ?? {}),
        screenshotSha256: result.screenshotSha256 ?? "",
        model: cfg.model,
      });
      store.attachCanvasTranscription({
        runId: result.runId,
        transcriptionJson: JSON.stringify(result.transcriptionJson ?? {}),
      });
      return {
        runId: result.runId,
        canonical: false,
        learnerOwned: false,
        captureVerified: result.captureVerified,
        transcribed: result.transcribed,
        note: "AI transcription is non-canonical and non-learner-owned. Confirm literal observations before interpretation.",
      };
    },
  },
  {
    name: "study_confirm_canvas",
    description:
      "Learner confirms LITERAL observations from the latest AI transcription. Cannot create relations or explanations.",
    parameters: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        observationIds: {
          type: "array",
          items: { type: "string" },
          description: "Literal observation ids from the transcription (texts/objects/visual_marks/visible_symbols)",
        },
        note: { type: "string" },
      },
      required: ["sessionId", "observationIds"],
    },
    handler: (store, params) => {
      const sessionId = String(params.sessionId ?? "");
      const observationIds = Array.isArray(params.observationIds)
        ? params.observationIds.map((x) => String(x))
        : [];
      const note = params.note !== undefined ? String(params.note) : null;
      const artifact = store.getLatestCanvasArtifact(sessionId);
      if (!artifact || !artifact.runId) return { error: "no_canvas_artifact", sessionId };
      const ok = store.confirmCanvasLiteral({ runId: artifact.runId, observationIds, note });
      if (!ok) return { error: "invalid_observation_ids_or_status", sessionId, runId: artifact.runId };
      return { confirmed: true, observationIds, canonical: false, learnerOwned: false };
    },
  },
  {
    name: "study_select_next",
    description: "Runtime controller: the single source of truth for the next action, derived from DB-persisted evidence.",
    parameters: {
      type: "object",
      properties: { sessionId: { type: "string" } },
      required: ["sessionId"],
    },
    handler: (store, params) => {
      const sessionId = String(params.sessionId ?? "");
      return selectNextAction(store, { sessionId });
    },
  },
  {
    name: "study_record_attempt",
    description:
      "Record a study attempt with contamination metadata. Protocol advancement comes from SQLite evidence, never caller-supplied completion.",
    parameters: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        targetId: { type: "string" },
        operation: { type: "string" },
        author: { type: "string" },
        helpLevel: { type: "string" },
        answerVisible: { type: "boolean" },
        attemptIndependent: { type: "boolean" },
        artifactJson: { type: "string" },
      },
      required: ["sessionId", "operation", "author", "helpLevel", "answerVisible"],
    },
    handler: (store, params) => {
      const sessionId = String(params.sessionId ?? "");
      const operation = String(params.operation ?? "");
      const author = String(params.author ?? "learner");
      const helpLevel = String(params.helpLevel ?? "none");
      const answerVisible = Boolean(params.answerVisible);
      const attemptIndependent =
        params.attemptIndependent !== undefined ? Boolean(params.attemptIndependent) : !answerVisible;
      const targetId = params.targetId !== undefined ? String(params.targetId) : undefined;
      const artifactJson =
        params.artifactJson !== undefined ? String(params.artifactJson) : JSON.stringify({ operation });
      const opInput: Parameters<typeof store.recordOperation>[0] = {
        sessionId,
        operation: operation as Parameters<typeof store.recordOperation>[0]["operation"],
        author: author as Parameters<typeof store.recordOperation>[0]["author"],
        helpLevel: helpLevel as Parameters<typeof store.recordOperation>[0]["helpLevel"],
        answerVisible,
        attemptIndependent,
        contaminationScope: "target",
        artifactJson,
        confidence: "high",
        status: answerVisible ? "contaminated" : "clean",
      };
      if (targetId) opInput.targetId = targetId;
      const operationId = store.recordOperation(opInput);
      return { operationId, answerVisible, attemptIndependent, contaminated: answerVisible };
    },
  },
  {
    name: "study_record_assessment",
    description:
      "Record an assessment (mastery dimensions) for a target and derive readiness + schedule a spaced review. Never raises mastery on its own for contaminated attempts.",
    parameters: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        targetId: { type: "string" },
        attemptId: { type: "string" },
        dimensions: { type: "object" },
        criticalErrors: { type: "array", items: { type: "string" } },
        answerWasVisibleBeforeAttempt: { type: "boolean" },
        delayed: { type: "boolean" },
      },
      required: ["sessionId", "targetId", "dimensions"],
    },
    handler: (store, params) => {
      const sessionId = String(params.sessionId ?? "");
      const targetId = String(params.targetId ?? "");
      const dimensionsRaw =
        typeof params.dimensions === "object" && params.dimensions !== null
          ? (params.dimensions as Record<string, unknown>)
          : {};
      const dimensions: MasteryDimensions = {};
      const DIM_KEYS = [
        "factualAccuracy",
        "freeGeneration",
        "relationalStructure",
        "reconstruction",
        "application",
        "transfer",
        "communication",
      ] as const;
      for (const k of DIM_KEYS) {
        const v = dimensionsRaw[k];
        if (typeof v === "number") (dimensions as Record<string, number>)[k] = v;
      }
      const criticalErrors = Array.isArray(params.criticalErrors)
        ? params.criticalErrors.map(String)
        : [];

      let answerWasVisibleBeforeAttempt =
        params.answerWasVisibleBeforeAttempt !== undefined
          ? Boolean(params.answerWasVisibleBeforeAttempt)
          : false;
      if (params.answerWasVisibleBeforeAttempt === undefined) {
        const ops = store.getOperationAttempts(targetId);
        const last = ops[ops.length - 1];
        if (last) answerWasVisibleBeforeAttempt = last.answerVisible;
      }
      const delayed = params.delayed !== undefined ? Boolean(params.delayed) : false;

      const snapshot: AssessmentSnapshot = { dimensions, criticalErrors, answerWasVisibleBeforeAttempt, delayed };

      const kind: ObjectiveKind = "conceptual";
      const decision = deriveReadiness(kind, snapshot);

      const attemptId = String(params.attemptId ?? store.startAttempt({ sessionId, targetId }));
      store.submitAttempt(attemptId, JSON.stringify(snapshot));
      store.recordAssessment(attemptId, [
        {
          type: "readiness",
          score: decision.readiness === "stable" ? 3 : decision.readiness === "provisional" ? 2 : 1,
          confidence: 1,
          notes: JSON.stringify(snapshot),
        },
      ]);

      const ownership: "unverified" | "provisional_owned" | "verified_owned" =
        delayed && decision.readiness !== "insufficient"
          ? "verified_owned"
          : decision.readiness !== "insufficient"
            ? "provisional_owned"
            : "unverified";
      store.upsertTargetEvidenceState({
        sessionId,
        targetId,
        readiness: decision.readiness,
        ownershipStatus: ownership,
      });

      const contract = store.getGoalContractForSession(sessionId);
      const dueAt = computeReviewDueAt(contract?.retentionDays);
      store.createPersistentReview({ sessionId, targetId, dueAt });

      return { targetId, readiness: decision.readiness, reasons: decision.reasons, ownership, reviewDueAt: dueAt };
    },
  },
  {
    name: "study_request_help",
    description:
      "Compute the minimal pedagogically safe help level. Returns level + action + reasons. Delivery of higher help is recorded as contamination on the attempt.",
    parameters: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        targetId: { type: "string" },
        currentLevel: { type: "number" },
        explicitAnswerRequest: { type: "boolean" },
        explicitSurrender: { type: "boolean" },
        blockingPrerequisite: { type: "boolean" },
      },
      required: ["sessionId"],
    },
    handler: (store, params) => {
      const sessionId = String(params.sessionId ?? "");
      const targetId = params.targetId !== undefined ? String(params.targetId) : undefined;
      const decision = chooseMinimalHelp({
        level0: true,
        currentLevel: typeof params.currentLevel === "number" ? params.currentLevel : 0,
        blockingPrerequisite: Boolean(params.blockingPrerequisite),
        explicitAnswerRequest: Boolean(params.explicitAnswerRequest),
        explicitSurrender: Boolean(params.explicitSurrender),
        ...(targetId ? { targetId } : {}),
      });
      store.recordNextActionDecision({
        sessionId,
        actionType: "request_help",
        contextJson: JSON.stringify({
          targetId: targetId ?? null,
          currentLevel: typeof params.currentLevel === "number" ? params.currentLevel : 0,
        }),
        decisionJson: JSON.stringify(decision),
      });
      return decision;
    },
  },
  {
    name: "study_open_gap",
    description: "Turn a failure into a precise, open gap. AI classifies but does not erase the gap.",
    parameters: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        targetId: { type: "string" },
      },
      required: ["sessionId"],
    },
    handler: (store, params) => {
      const sessionId = String(params.sessionId ?? "");
      const targetId = params.targetId !== undefined ? String(params.targetId) : undefined;
      const gapInput: Parameters<typeof store.openGap>[0] = { sessionId };
      if (targetId) gapInput.targetId = targetId;
      const gapId = store.openGap(gapInput);
      return { gapId, status: "open" };
    },
  },
  {
    name: "study_reviews",
    description: "List due and scheduled spaced reviews for the session.",
    parameters: {
      type: "object",
      properties: { sessionId: { type: "string" } },
      required: ["sessionId"],
    },
    handler: (store, params) => {
      const sessionId = String(params.sessionId ?? "");
      const nowIso = new Date().toISOString();
      const due = store.getDueReviewItems(sessionId, nowIso);
      return { sessionId, dueReviews: due, dueCount: due.length };
    },
  },
];