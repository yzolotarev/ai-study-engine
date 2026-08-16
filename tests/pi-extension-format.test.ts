import assert from "node:assert/strict";
import test from "node:test";
import studyEngineExtension from "../extensions/study-engine/pi-extension.js";

test("pi-extension exports a default function", () => {
  assert.equal(typeof studyEngineExtension, "function");
});

test("pi-extension registers tools and commands via ExtensionAPI", () => {
  const registeredTools: Array<{ name: string }> = [];
  const registeredCommands: Array<{ name: string }> = [];
  const eventHandlers: Array<{ event: string; handler: Function }> = [];

  const mockApi = {
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
    }): void {
      registeredTools.push({ name: tool.name });
    },
    registerCommand(name: string, _command: {
      description: string;
      handler: (args: string[], ctx: unknown) => Promise<void>;
    }): void {
      registeredCommands.push({ name });
    },
    on(event: string, handler: Function): void {
      eventHandlers.push({ event, handler });
    },
  };

  studyEngineExtension(mockApi);

  assert.equal(registeredTools.length, 3);
  assert.ok(registeredTools.some((t) => t.name === "study_start"));
  assert.ok(registeredTools.some((t) => t.name === "study_status"));
  assert.ok(registeredTools.some((t) => t.name === "study_record_artifact"));

  assert.equal(registeredCommands.length, 2);
  assert.ok(registeredCommands.some((c) => c.name === "study-start"));
  assert.ok(registeredCommands.some((c) => c.name === "study-status"));

  assert.ok(eventHandlers.some((h) => h.event === "tool_call"));
});

test("pi-extension tools have execute function with correct signature", () => {
  const registeredTools: Array<{
    name: string;
    execute: Function;
  }> = [];

  const mockApi = {
    registerTool(tool: {
      name: string;
      label: string;
      description: string;
      parameters: any;
      execute: Function;
    }): void {
      registeredTools.push({ name: tool.name, execute: tool.execute });
    },
    registerCommand(): void {},
    on(): void {},
  };

  studyEngineExtension(mockApi);

  for (const tool of registeredTools) {
    assert.equal(typeof tool.execute, "function");
    assert.equal(tool.execute.length, 5);
  }
});

test("pi-extension tools return string (JSON)", async () => {
  const registeredTools: Array<{
    name: string;
    execute: Function;
  }> = [];

  const mockApi = {
    registerTool(tool: {
      name: string;
      label: string;
      description: string;
      parameters: any;
      execute: Function;
    }): void {
      registeredTools.push({ name: tool.name, execute: tool.execute });
    },
    registerCommand(): void {},
    on(): void {},
  };

  studyEngineExtension(mockApi);

  const studyStart = registeredTools.find((t) => t.name === "study_start");
  assert.ok(studyStart);

  const result = await studyStart.execute(
    "tool-call-1",
    {
      capability: "test capability",
      targetTask: "test task",
      successCriteria: "test criteria",
    },
    new AbortController().signal,
    () => {},
    {}
  );

  assert.equal(typeof result, "string");
  const parsed = JSON.parse(result);
  assert.ok(parsed.contractId);
  assert.ok(parsed.sessionId);
});