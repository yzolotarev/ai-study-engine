import type { StudyStore } from "../../src/db/store.js";
import { SQLiteHarnessRepository, StudyHarness } from "../../src/harness/index.js";
import type { ArtifactAuthor, AttemptKind, CriterionAssessmentInput, HelpKind, Subject, TargetDefinition } from "../../src/harness/types.js";
import type { StudyToolDefinition } from "./study-tools.js";

function runtime(store: StudyStore): StudyHarness {
  return new StudyHarness(new SQLiteHarnessRepository(store));
}
const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const string = (description?: string) => ({ type: "string", ...(description ? { description } : {}) });
const session = { sessionId: string("Harness v2 session id") };

export const HARNESS_TOOLS: readonly StudyToolDefinition[] = [
  {
    name: "study_v2_start",
    description: "Start a Harness v2 goal. This records a draft; it is not learner confirmation or evidence.",
    parameters: object({ learnerId: string(), capability: string(), targetTask: string(), successCriteria: string(), subject: { type: "string", enum: ["general", "history", "law", "economics"] }, retentionDays: { type: "integer", minimum: 1 } }, ["learnerId", "capability", "targetTask", "successCriteria", "subject"]),
    handler: (store, p) => runtime(store).start(String(p.learnerId), { capability: String(p.capability), targetTask: String(p.targetTask), successCriteria: String(p.successCriteria), subject: String(p.subject) as Subject, ...(p.retentionDays === undefined ? {} : { retentionDays: Number(p.retentionDays) }) }),
  },
  {
    name: "study_v2_confirm",
    description: "Record the learner's literal confirmation of the Harness v2 goal.",
    parameters: object({ ...session, confirmation: string() }, ["sessionId", "confirmation"]),
    handler: (store, p) => runtime(store).confirm(String(p.sessionId), String(p.confirmation)),
  },
  {
    name: "study_v2_targets",
    description: "Generate deterministic subject targets, or record an explicit rubric. Generated targets are scaffolding, never learner evidence.",
    parameters: object({ ...session, targets: { type: "array", items: { type: "object", properties: { id: string(), description: string(), criteria: { type: "array", items: { type: "object", properties: { id: string(), description: string() }, required: ["id", "description"], additionalProperties: false } } }, required: ["id", "description", "criteria"], additionalProperties: false } } }, ["sessionId"]),
    handler: (store, p) => runtime(store).defineTargets(String(p.sessionId), Array.isArray(p.targets) ? p.targets as unknown as TargetDefinition[] : undefined),
  },
  {
    name: "study_v2_next",
    description: "Return the deterministic next Harness v2 stage from replayed journal state.",
    parameters: object(session, ["sessionId"]),
    handler: (store, p) => runtime(store).status(String(p.sessionId)).next,
  },
  {
    name: "study_v2_begin_attempt",
    description: "Begin baseline, retrieval, or novel transfer. Independence and delay are derived later; callers cannot declare them.",
    parameters: object({ ...session, kind: { type: "string", enum: ["baseline", "retrieval", "transfer"] }, targetIds: { type: "array", items: string() }, prompt: string() }, ["sessionId", "kind"]),
    handler: (store, p) => runtime(store).beginAttempt(String(p.sessionId), { kind: String(p.kind) as AttemptKind, ...(Array.isArray(p.targetIds) ? { targetIds: p.targetIds.map(String) } : {}), ...(p.prompt === undefined ? {} : { prompt: String(p.prompt) }) }),
  },
  {
    name: "study_v2_submit",
    description: "Submit an artifact with explicit authorship. AI/shared artifacts remain audit artifacts and never mastery evidence.",
    parameters: object({ ...session, attemptId: string(), content: string(), author: { type: "string", enum: ["learner", "ai", "shared"] } }, ["sessionId", "attemptId", "content"]),
    handler: (store, p) => runtime(store).submit(String(p.sessionId), String(p.attemptId), String(p.content), String(p.author ?? "learner") as ArtifactAuthor),
  },
  {
    name: "study_v2_assess",
    description: "Assess each rubric criterion using literal quotes from the submitted artifact. Does not accept an overall pass flag.",
    parameters: object({ ...session, attemptId: string(), assessments: { type: "array", items: { type: "object", properties: { criterionId: string(), met: { type: "boolean" }, quotes: { type: "array", items: string() }, note: string() }, required: ["criterionId", "met", "quotes"], additionalProperties: false } } }, ["sessionId", "attemptId", "assessments"]),
    handler: (store, p) => runtime(store).assess(String(p.sessionId), String(p.attemptId), (p.assessments ?? []) as CriterionAssessmentInput[]),
  },
  {
    name: "study_v2_gap",
    description: "Diagnose a specific failed rubric criterion as an explicit open gap.",
    parameters: object({ ...session, attemptId: string(), targetId: string(), criterionId: string(), diagnosis: string() }, ["sessionId", "attemptId", "targetId", "criterionId", "diagnosis"]),
    handler: (store, p) => runtime(store).openGap(String(p.sessionId), { attemptId: String(p.attemptId), targetId: String(p.targetId), criterionId: String(p.criterionId), diagnosis: String(p.diagnosis) }),
  },
  {
    name: "study_v2_remediate",
    description: "Record minimal remediation for an open gap. If delivered during an attempt it contaminates that attempt.",
    parameters: object({ ...session, gapId: string(), content: string(), kind: { type: "string", enum: ["explanation", "example", "exercise", "source"] } }, ["sessionId", "gapId", "content"]),
    handler: (store, p) => runtime(store).remediate(String(p.sessionId), String(p.gapId), String(p.content), String(p.kind ?? "explanation") as "explanation" | "example" | "exercise" | "source"),
  },
  {
    name: "study_v2_help",
    description: "Record help. Content hints, worked examples, and answers contaminate an active attempt; process prompts do not.",
    parameters: object({ ...session, attemptId: string(), kind: { type: "string", enum: ["process_prompt", "content_hint", "worked_example", "answer"] }, content: string() }, ["sessionId", "kind", "content"]),
    handler: (store, p) => runtime(store).help(String(p.sessionId), String(p.content), String(p.kind) as HelpKind, p.attemptId === undefined ? undefined : String(p.attemptId)),
  },
  {
    name: "study_v2_status",
    description: "Replay Harness v2 events and return projection, anomalies, next stage, and computed completion decision.",
    parameters: object(session, ["sessionId"]),
    handler: (store, p) => runtime(store).status(String(p.sessionId)),
  },
  {
    name: "study_v2_complete",
    description: "Record completion only when the replayed ledger satisfies the completion policy.",
    parameters: object(session, ["sessionId"]),
    handler: (store, p) => runtime(store).complete(String(p.sessionId)),
  },
];
