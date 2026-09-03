import type { StudyStore } from "../../src/db/store.js";
import {
  SQLiteHarnessRepository,
  StudyHarness,
  parseCriterionAssessments,
  parseTargetDefinitions,
} from "../../src/harness/index.js";
import type { AttemptKind, HelpKind, Subject } from "../../src/harness/types.js";
import type { StudyToolDefinition } from "./study-tools.js";

function runtime(store: StudyStore): StudyHarness {
  return new StudyHarness(new SQLiteHarnessRepository(store));
}
const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const string = (description?: string) => ({ type: "string", ...(description ? { description } : {}) });
const session = { sessionId: string("Harness v2 session id") };

function subject(value: unknown): Subject {
  if (value === "general" || value === "history" || value === "law" || value === "economics") return value;
  throw new Error("subject must be general, history, law, or economics");
}
function attemptKind(value: unknown): AttemptKind {
  if (value === "baseline" || value === "retrieval" || value === "transfer") return value;
  throw new Error("kind must be baseline, retrieval, or transfer");
}
function helpKind(value: unknown): HelpKind {
  if (value === "process_prompt" || value === "content_hint" || value === "worked_example" || value === "answer") return value;
  throw new Error("invalid help kind");
}
function remediationKind(value: unknown): "explanation" | "example" | "exercise" | "source" {
  if (value === "explanation" || value === "example" || value === "exercise" || value === "source") return value;
  throw new Error("invalid remediation kind");
}
function stringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) throw new Error("targetIds must be an array of strings");
  return value;
}

export const HARNESS_TOOLS: readonly StudyToolDefinition[] = [
  {
    name: "study_v2_start",
    description: "Start a Harness v2 goal draft. This is not learner confirmation or evidence.",
    parameters: object({ learnerId: string(), capability: string(), targetTask: string(), successCriteria: string(), subject: { type: "string", enum: ["general", "history", "law", "economics"] }, retentionDays: { type: "integer", minimum: 1 } }, ["learnerId", "capability", "targetTask", "successCriteria", "subject"]),
    handler: (store, p) => runtime(store).start(String(p.learnerId), { capability: String(p.capability), targetTask: String(p.targetTask), successCriteria: String(p.successCriteria), subject: subject(p.subject), ...(p.retentionDays === undefined ? {} : { retentionDays: Number(p.retentionDays) }) }),
  },
  {
    name: "study_v2_request_learner_input",
    description: "Return the learner action that must be performed through trusted CLI/manual ingress, including any optional prediction or model-revision scaffold. This tool records no learner event.",
    parameters: object(session, ["sessionId"]),
    handler: (store, p) => ({
      recorded: false,
      trustBoundary: "Use a human-operated trusted ingress; AI tools cannot confirm goals or submit learner artifacts.",
      next: runtime(store).status(String(p.sessionId)).next,
    }),
  },
  {
    name: "study_v2_targets",
    description: "Generate deterministic subject targets, or record an explicit rubric. Generated targets are scaffolding, never learner evidence.",
    parameters: object({ ...session, targets: { type: "array", items: { type: "object", properties: { id: string(), description: string(), criteria: { type: "array", items: { type: "object", properties: { id: string(), description: string() }, required: ["id", "description"], additionalProperties: false } } }, required: ["id", "description", "criteria"], additionalProperties: false } } }, ["sessionId"]),
    handler: (store, p) => {
      const targets = p.targets === undefined ? undefined : parseTargetDefinitions(p.targets);
      if (p.targets !== undefined && !targets) throw new Error("targets payload is malformed");
      return runtime(store).defineTargets(String(p.sessionId), targets);
    },
  },
  {
    name: "study_v2_next",
    description: "Return the deterministic next Harness v2 stage and optional non-persisted hypothesis scaffold from replayed journal state.",
    parameters: object(session, ["sessionId"]),
    handler: (store, p) => runtime(store).status(String(p.sessionId)).next,
  },
  {
    name: "study_v2_begin_attempt",
    description: "Begin baseline, retrieval, or transfer. Independence, ordering, and delay are derived by replay.",
    parameters: object({ ...session, kind: { type: "string", enum: ["baseline", "retrieval", "transfer"] }, targetIds: { type: "array", items: string() }, prompt: string() }, ["sessionId", "kind"]),
    handler: (store, p) => runtime(store).beginAttempt(String(p.sessionId), { kind: attemptKind(p.kind), ...(p.targetIds === undefined ? {} : { targetIds: stringArray(p.targetIds) }), ...(p.prompt === undefined ? {} : { prompt: String(p.prompt) }) }),
  },
  {
    name: "study_v2_submit",
    description: "Record AI or shared material for an attempt. This tool cannot create learner-authored evidence.",
    parameters: object({ ...session, attemptId: string(), content: string(), author: { type: "string", enum: ["ai", "shared"] } }, ["sessionId", "attemptId", "content", "author"]),
    handler: (store, p) => {
      if (p.author !== "ai" && p.author !== "shared") throw new Error("AI-facing submit accepts only ai or shared provenance");
      return runtime(store).recordArtifact(String(p.sessionId), String(p.attemptId), String(p.content), p.author);
    },
  },
  {
    name: "study_v2_assess",
    description: "Assess an existing trusted learner artifact using literal quotes. Does not accept an overall pass flag.",
    parameters: object({ ...session, attemptId: string(), assessments: { type: "array", items: { type: "object", properties: { criterionId: string(), met: { type: "boolean" }, quotes: { type: "array", items: string() }, note: string() }, required: ["criterionId", "met", "quotes"], additionalProperties: false } } }, ["sessionId", "attemptId", "assessments"]),
    handler: (store, p) => {
      const assessments = parseCriterionAssessments(p.assessments);
      if (!assessments) throw new Error("assessments payload is malformed");
      return runtime(store).assess(String(p.sessionId), String(p.attemptId), assessments);
    },
  },
  {
    name: "study_v2_gap",
    description: "Diagnose a specific failed rubric criterion as an explicit open gap.",
    parameters: object({ ...session, attemptId: string(), targetId: string(), criterionId: string(), diagnosis: string() }, ["sessionId", "attemptId", "targetId", "criterionId", "diagnosis"]),
    handler: (store, p) => runtime(store).openGap(String(p.sessionId), { attemptId: String(p.attemptId), targetId: String(p.targetId), criterionId: String(p.criterionId), diagnosis: String(p.diagnosis) }),
  },
  {
    name: "study_v2_remediate",
    description: "Record minimal remediation. If delivered during an active attempt it contaminates that attempt.",
    parameters: object({ ...session, gapId: string(), content: string(), kind: { type: "string", enum: ["explanation", "example", "exercise", "source"] } }, ["sessionId", "gapId", "content"]),
    handler: (store, p) => runtime(store).remediate(String(p.sessionId), String(p.gapId), String(p.content), remediationKind(p.kind ?? "explanation")),
  },
  {
    name: "study_v2_help",
    description: "Record help. Substantive help requires and contaminates an active unsubmitted attempt.",
    parameters: object({ ...session, attemptId: string(), kind: { type: "string", enum: ["process_prompt", "content_hint", "worked_example", "answer"] }, content: string() }, ["sessionId", "kind", "content"]),
    handler: (store, p) => runtime(store).help(String(p.sessionId), String(p.content), helpKind(p.kind), p.attemptId === undefined ? undefined : String(p.attemptId)),
  },
  {
    name: "study_v2_status",
    description: "Replay Harness v2 events and return projection, anomalies, next stage, and computed completion decision.",
    parameters: object(session, ["sessionId"]),
    handler: (store, p) => runtime(store).status(String(p.sessionId)),
  },
  {
    name: "study_v2_complete",
    description: "Record completion only when hardened replay satisfies policy and has no audit anomalies.",
    parameters: object(session, ["sessionId"]),
    handler: (store, p) => runtime(store).complete(String(p.sessionId)),
  },
];
