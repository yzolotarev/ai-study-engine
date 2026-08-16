import { join } from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { decideHelp, type HelpMode } from "../../src/core/help-controller.js";
import { selectNextAction } from "../../src/core/runtime-controller.js";
import { recommendForState } from "../../src/core/next-step.js";
import { STUDY_STATES, type HelpLevel, type StudyState, type TransitionEvidence } from "../../src/core/types.js";
import { StudyStore, type StudySessionView } from "../../src/db/store.js";
import { STUDY_TOOLS } from "./study-tools.js";

const LOCAL_USER_ID = "local-default";
const PRODUCT_PROVENANCE = {
  kind: "PRODUCT_DECISION" as const,
  sourceIds: [],
  policyVersion: "v1",
};

const EvidenceSchema = Type.Object({
  objectiveExplicit: Type.Optional(Type.Boolean()),
  independentAttempt: Type.Optional(Type.Boolean()),
  learnerQuestionOrRelation: Type.Optional(Type.Boolean()),
  concreteBackbone: Type.Optional(Type.Boolean()),
  learnerArtifact: Type.Optional(Type.Boolean()),
  targetRubricPassed: Type.Optional(Type.Boolean()),
  relationalEvidence: Type.Optional(Type.Boolean()),
  delayedOrTransferEvidence: Type.Optional(Type.Boolean()),
  gapQuestionExplicit: Type.Optional(Type.Boolean()),
  remediationPassed: Type.Optional(Type.Boolean()),
  competitiveStakes: Type.Optional(Type.Boolean()),
  userRequestedOverlearning: Type.Optional(Type.Boolean()),
  restartPointSaved: Type.Optional(Type.Boolean()),
});

function dbPath(cwd: string): string {
  return join(cwd, ".study-engine", "study-engine.sqlite");
}

function statusText(session: StudySessionView): string {
  return `study: ${session.currentState.toLowerCase()} · v${session.stateVersion}`;
}

function updateUi(ctx: ExtensionContext, session?: StudySessionView): void {
  if (!ctx.hasUI) return;
  if (!session) {
    ctx.ui.setStatus("study-engine", "study: idle");
    ctx.ui.setWidget("study-engine", undefined);
    return;
  }
  const next = recommendForState(session.currentState);
  ctx.ui.setStatus("study-engine", statusText(session));
  ctx.ui.setWidget("study-engine", [
    `Study · ${session.objectiveTitle}`,
    `${session.currentState}: ${next.action}`,
  ]);
}

function formatSession(session: StudySessionView): string {
  const next = recommendForState(session.currentState);
  return [
    `Objective: ${session.objectiveTitle}`,
    `Outcome: ${session.observableOutcome}`,
    `Target task: ${session.targetTask}`,
    `Assessment: ${session.assessmentFormat}`,
    `State: ${session.currentState} (v${session.stateVersion})`,
    `Next: ${next.action}`,
    `Learner artifact: ${next.learnerArtifact}`,
    `AI boundary: ${next.aiBoundary}`,
  ].join("\n");
}

export default function studyEngine(pi: ExtensionAPI) {
  pi.on("tool_call", async (event) => {
    if (["study_start", "study_status", "study_record_artifact"].includes(event.toolName)) {
      console.error(
        `[${event.toolName} raw Pi input]`,
        JSON.stringify(event.input, null, 2)
      );
    }
  });

  let store: StudyStore | undefined;

  const getStore = (cwd: string): StudyStore => {
    if (!store) {
      store = new StudyStore(dbPath(cwd));
      store.ensureUser(LOCAL_USER_ID, "ru-RU", Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
    }
    return store;
  };

  const activeSession = (ctx: ExtensionContext): StudySessionView | undefined =>
    getStore(ctx.cwd).getActiveSession(ctx.sessionManager.getSessionId());

  pi.on("session_start", (_event, ctx) => {
    updateUi(ctx, activeSession(ctx));
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (ctx.hasUI) {
      ctx.ui.setStatus("study-engine", undefined);
      ctx.ui.setWidget("study-engine", undefined);
    }
    store?.close();
    store = undefined;
  });

  pi.on("before_agent_start", (_event, ctx) => {
    const session = activeSession(ctx);
    if (!session) return;
    const next = recommendForState(session.currentState);
    return {
      systemPrompt: `${ctx.getSystemPrompt()}\n\n[AI STUDY ENGINE — CURRENT STATE]\nObjective: ${session.observableOutcome}\nTarget task: ${session.targetTask}\nState: ${session.currentState}\nRequired next action: ${next.action}\nLearner-owned artifact: ${next.learnerArtifact}\nBoundary: ${next.aiBoundary}\nNever treat recognition, confidence, or an answer-visible attempt as mastery.`,
    };
  });

  pi.registerCommand("study-start", {
    description: "Start a new evidence-driven study session",
    handler: async (args, ctx) => {
      const existing = activeSession(ctx);
      if (existing) {
        ctx.ui.notify(`An active study session already exists: ${existing.objectiveTitle}`, "warning");
        updateUi(ctx, existing);
        return;
      }

      const positional = args.split("|").map((part) => part.trim());
      let title = positional[0] || undefined;
      let outcome = positional[1] || undefined;
      let targetTask = positional[2] || undefined;
      let assessmentFormat = positional[3] || undefined;

      if (ctx.hasUI) {
        title ??= await ctx.ui.input("Study topic", "Example: Fractions");
        if (!title) return;
        outcome ??= await ctx.ui.input("Observable outcome", "What must you be able to do?");
        if (!outcome) return;
        targetTask ??= await ctx.ui.input("Target task", "What concrete task will prove it?");
        if (!targetTask) return;
        assessmentFormat ??= await ctx.ui.input("Assessment format", "oral, written, code, exam...");
        if (!assessmentFormat) return;
      }

      if (!title || !outcome || !targetTask || !assessmentFormat) {
        ctx.ui.notify("Usage: /study-start title | observable outcome | target task | assessment format", "error");
        return;
      }

      const database = getStore(ctx.cwd);
      const objectiveId = database.createObjective({
        userId: LOCAL_USER_ID,
        title,
        observableOutcome: outcome,
        targetTask,
        assessmentFormat,
        stakes: "normal",
        provenance: PRODUCT_PROVENANCE,
      });
      let session = database.createSession(LOCAL_USER_ID, objectiveId, ctx.sessionManager.getSessionId());
      session = database.transition({
        sessionId: session.id,
        expectedVersion: session.stateVersion,
        to: "BASELINE_PROBE",
        evidence: { objectiveExplicit: true },
        actor: "user",
        provenance: PRODUCT_PROVENANCE,
        note: "Objective captured by /study-start",
      });

      pi.setSessionName(`Study: ${title}`);
      pi.appendEntry("study-engine-checkpoint", {
        studySessionId: session.id,
        state: session.currentState,
        stateVersion: session.stateVersion,
      });
      updateUi(ctx, session);
      ctx.ui.notify("Study session created. Start with an unassisted baseline attempt.", "info");
    },
  });

  pi.registerCommand("study-status", {
    description: "Show current objective, phase, and next action",
    handler: async (_args, ctx) => {
      const session = activeSession(ctx);
      if (!session) {
        ctx.ui.notify("No active study session. Use /study-start.", "info");
        updateUi(ctx);
        return;
      }
      updateUi(ctx, session);
      if (ctx.hasUI) await ctx.ui.editor("Study status", formatSession(session));
      else console.log(formatSession(session));
    },
  });

  pi.registerCommand("study-next", {
    description: "Show the deterministic next action for the current phase",
    handler: async (_args, ctx) => {
      const session = activeSession(ctx);
      if (!session) {
        ctx.ui.notify("No active study session. Use /study-start.", "warning");
        return;
      }
      const next = recommendForState(session.currentState);
      ctx.ui.notify(next.action, "info");
      updateUi(ctx, session);
    },
  });

  pi.registerCommand("study-canvas", {
    description: "Run Capture Core + Gemma transcription and record a non-canonical canvas artifact",
    handler: async (_args, ctx) => {
      const session = activeSession(ctx);
      if (!session) {
        ctx.ui.notify("No active study session. Use /study-start.", "warning");
        return;
      }
      const database = getStore(ctx.cwd);
      const tool = STUDY_TOOLS.find((t) => t.name === "study_capture_canvas");
      if (!tool) {
        ctx.ui.notify("study_capture_canvas tool missing.", "error");
        return;
      }
      const result = tool.handler(database, { sessionId: session.id });
      ctx.ui.notify("Capture + transcription recorded (non-canonical, non-learner-owned).", "info");
      console.error("[study-canvas result]", JSON.stringify(result, null, 2));
      updateUi(ctx, session);
    },
  });

  pi.registerCommand("study-runtime", {
    description: "Runtime controller: the single source of truth for the next action",
    handler: async (_args, ctx) => {
      const session = activeSession(ctx);
      if (!session) {
        ctx.ui.notify("No active study session.", "warning");
        return;
      }
      const database = getStore(ctx.cwd);
      const action = selectNextAction(database, { sessionId: session.id });
      if (!action) {
        ctx.ui.notify("No active session.", "warning");
        return;
      }
      ctx.ui.notify(`${action.kind}: ${action.action}`, "info");
      updateUi(ctx, session);
    },
  });

  pi.registerCommand("study-review", {
    description: "List due and scheduled spaced reviews",
    handler: async (_args, ctx) => {
      const session = activeSession(ctx);
      if (!session) {
        ctx.ui.notify("No active study session.", "warning");
        return;
      }
      const database = getStore(ctx.cwd);
      const due = database.getDueReviewItems(session.id, new Date().toISOString());
      ctx.ui.notify(`Due reviews: ${due.length}`, "info");
      console.error("[study-review due]", JSON.stringify(due, null, 2));
    },
  });

  pi.registerCommand("study-end", {
    description: "Finalize the session and report open uncertainty",
    handler: async (_args, ctx) => {
      const session = activeSession(ctx);
      if (!session) {
        ctx.ui.notify("No active study session.", "warning");
        return;
      }
      const database = getStore(ctx.cwd);
      const action = selectNextAction(database, { sessionId: session.id });
      const msg = `Session ended.\n${formatSession(session)}\nRuntime verdict: ${action ? action.kind : "n/a"}\nAI must not erase remaining uncertainty.`;
      if (ctx.hasUI) await ctx.ui.editor("Study session ended", msg);
      else console.log(msg);
    },
  });

  pi.registerTool({
    name: "study_get_state",
    label: "Study State",
    description: "Read the current canonical study objective, state, next action, and state version",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const session = activeSession(ctx);
      if (!session) {
        return {
          content: [{ type: "text", text: "No active study session. Ask the user to run /study-start." }],
          details: { active: false },
        };
      }
      return {
        content: [{ type: "text", text: formatSession(session) }],
        details: { active: true, session },
      };
    },
  });

  pi.registerTool({
    name: "study_decide_help",
    label: "Study Help Decision",
    description:
      "Choose the maximum pedagogically safe help level for the current mode. Use before giving hints or answers.",
    parameters: Type.Object({
      mode: StringEnum(["familiarity", "encoding", "retrieval", "assessment", "remediation", "reference"] as const),
      currentLevel: Type.Integer({ minimum: 0, maximum: 6 }),
      materiallyDistinctFailedAttempts: Type.Integer({ minimum: 0 }),
      degradationSignals: Type.Integer({ minimum: 0 }),
      explicitAnswerRequest: Type.Boolean(),
      explicitSurrender: Type.Boolean(),
      blockingPrerequisite: Type.Boolean(),
    }),
    async execute(_toolCallId, params) {
      const decision = decideHelp({
        mode: params.mode as HelpMode,
        currentLevel: params.currentLevel as HelpLevel,
        materiallyDistinctFailedAttempts: params.materiallyDistinctFailedAttempts,
        degradationSignals: params.degradationSignals,
        explicitAnswerRequest: params.explicitAnswerRequest,
        explicitSurrender: params.explicitSurrender,
        blockingPrerequisite: params.blockingPrerequisite,
      });
      return {
        content: [{
          type: "text",
          text: `Maximum help: L${decision.level} (${decision.action}). Attempt contaminated: ${decision.contaminateAttempt ? "yes" : "no"}. ${decision.reasons.join(" ")}`,
        }],
        details: decision,
      };
    },
  });

  pi.registerTool({
    name: "study_transition",
    label: "Study Transition",
    description:
      "Request a guarded study-state transition. The deterministic core rejects transitions without required learner evidence.",
    parameters: Type.Object({
      to: StringEnum(STUDY_STATES),
      expectedVersion: Type.Integer({ minimum: 0 }),
      evidence: EvidenceSchema,
      note: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const session = activeSession(ctx);
      if (!session) throw new Error("No active study session");
      const updated = getStore(ctx.cwd).transition({
        sessionId: session.id,
        expectedVersion: params.expectedVersion,
        to: params.to as StudyState,
        evidence: params.evidence as TransitionEvidence,
        actor: "ai",
        provenance: PRODUCT_PROVENANCE,
        ...(params.note === undefined ? {} : { note: params.note }),
      });
      pi.appendEntry("study-engine-checkpoint", {
        studySessionId: updated.id,
        state: updated.currentState,
        stateVersion: updated.stateVersion,
      });
      updateUi(ctx, updated);
      return {
        content: [{ type: "text", text: `Transitioned to ${updated.currentState}.\n${recommendForState(updated.currentState).action}` }],
        details: { session: updated },
      };
    },
  });

  STUDY_TOOLS.forEach((tool) => {
    pi.registerTool({
      name: tool.name,
      label: tool.name,
      description: tool.description,
      parameters: tool.parameters as any,
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal: AbortSignal, _onUpdate: (update: unknown) => void, ctx: ExtensionContext) => {
        const result = tool.handler(getStore(ctx.cwd), params);
        console.error(`[${tool.name} result]`, JSON.stringify(result, null, 2));
        if (result && typeof result === 'object' && !Array.isArray(result) && !('content' in result)) {
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }
        return result;
      },
    } as any);
  });
}
