import { Type } from "@sinclair/typebox";
import { StudyStore } from "../../src/db/store.js";
import { STUDY_TOOLS } from "./study-tools.js";

interface PiExtensionAPI {
  registerTool(tool: {
    name: string;
    label: string;
    description: string;
    parameters: any;
    execute: (
      toolCallId: string,
      params: Record<string, unknown>,
      signal: AbortSignal,
      onUpdate: (update: unknown) => void,
      ctx: unknown
    ) => Promise<string>;
  }): void;

  registerCommand(name: string, command: {
    description: string;
    handler: (args: string[], ctx: unknown) => Promise<void>;
  }): void;

  on(event: "tool_call", handler: (event: {
    toolName: string;
    input: Record<string, unknown>;
  }) => Promise<void>): void;
}

let sharedStore: StudyStore | undefined;

function getStore(): StudyStore {
  if (!sharedStore) {
    sharedStore = new StudyStore("study-engine.db");
  }
  return sharedStore;
}

export default function studyEngineExtension(pi: PiExtensionAPI): void {
  pi.on("tool_call", async (event) => {
    if (["study_start", "study_status", "study_record_artifact"].includes(event.toolName)) {
      console.error(
        `[${event.toolName} raw Pi input]`,
        JSON.stringify(event.input, null, 2)
      );
    }
  });

  pi.registerTool({
    name: "study_start",
    label: "Study Start",
    description: "Start a new study session with a learner-originated goal. Requires three fields from the learner: capability (what they want to be able to do), targetTask (how it will be verified), and successCriteria (what counts as success). The learner must own these definitions.",
    parameters: Type.Object({
      capability: Type.String({
        description: "What the learner wants to be able to do",
      }),
      targetTask: Type.String({
        description: "How the capability will be verified",
      }),
      successCriteria: Type.String({
        description: "What counts as success",
      }),
    }),
    async execute(
      _toolCallId: string,
      params: Record<string, unknown>,
      _signal: AbortSignal,
      _onUpdate: (update: unknown) => void,
      _ctx: unknown
    ): Promise<string> {
      const store = getStore();
      const tool = STUDY_TOOLS.find((t) => t.name === "study_start");
      if (!tool) {
        throw new Error("study_start tool not found");
      }
      const result = tool.handler(store, params);
      console.error("[study_start result]", JSON.stringify(result, null, 2));
      return JSON.stringify(result);
    },
  });

  pi.registerTool({
    name: "study_status",
    label: "Study Status",
    description: "Get the current status of a study session including contamination info and operation history",
    parameters: Type.Object({
      sessionId: Type.String({
        description: "The study session ID",
      }),
    }),
    async execute(
      _toolCallId: string,
      params: Record<string, unknown>,
      _signal: AbortSignal,
      _onUpdate: (update: unknown) => void,
      _ctx: unknown
    ): Promise<string> {
      const store = getStore();
      const tool = STUDY_TOOLS.find((t) => t.name === "study_status");
      if (!tool) {
        throw new Error("study_status tool not found");
      }
      const result = tool.handler(store, params);
      console.error("[study_status result]", JSON.stringify(result, null, 2));
      return JSON.stringify(result);
    },
  });

  pi.registerTool({
    name: "study_record_artifact",
    label: "Study Record Artifact",
    description: "Record a learner-produced artifact and advance the protocol. Returns the next move or protocol completion status.",
    parameters: Type.Object({
      sessionId: Type.String({
        description: "The study session ID",
      }),
      artifactType: Type.String({
        description: "The type of artifact produced",
      }),
      artifactJson: Type.String({
        description: "The artifact content as JSON string",
      }),
      targetId: Type.Optional(Type.String({
        description: "The target ID for this artifact",
      })),
      completedArtifacts: Type.Optional(Type.String({
        description: "JSON array of already completed artifact types",
      })),
    }),
    async execute(
      _toolCallId: string,
      params: Record<string, unknown>,
      _signal: AbortSignal,
      _onUpdate: (update: unknown) => void,
      _ctx: unknown
    ): Promise<string> {
      const store = getStore();
      const tool = STUDY_TOOLS.find((t) => t.name === "study_record_artifact");
      if (!tool) {
        throw new Error("study_record_artifact tool not found");
      }
      const result = tool.handler(store, params);
      console.error("[study_record_artifact result]", JSON.stringify(result, null, 2));
      return JSON.stringify(result);
    },
  });

  pi.registerCommand("study-start", {
    description: "Start a new study session (interactive command)",
    handler: async (_args: string[], ctx: unknown) => {
      const store = getStore();
      const tool = STUDY_TOOLS.find((t) => t.name === "study_start");
      if (!tool) return;
      const result = tool.handler(store, {
        capability: "pending learner input",
        targetTask: "pending learner input",
        successCriteria: "pending learner input",
      });
      const ui = ctx as { ui?: { notify?: (msg: string, level: string) => void } };
      ui.ui?.notify?.(
        `Study session ready. Protocol: ${JSON.stringify(result)}`,
        "info"
      );
    },
  });

  pi.registerCommand("study-status", {
    description: "Show current study session status (interactive command)",
    handler: async (_args: string[], ctx: unknown) => {
      const ui = ctx as { ui?: { notify?: (msg: string, level: string) => void } };
      ui.ui?.notify?.(
        "Use study_status tool with a sessionId to see details.",
        "info"
      );
    },
  });
}