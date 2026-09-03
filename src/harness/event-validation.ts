import {
  HARNESS_SCHEMA_VERSION,
  PRE_HARDENING_SCHEMA_VERSION,
  type ArtifactAuthor,
  type AttemptKind,
  type AuditAnomaly,
  type CriterionAssessmentInput,
  type GoalInput,
  type HarnessActor,
  type HarnessEvent,
  type HelpKind,
  type Subject,
  type TargetDefinition,
} from "./types.js";

const ACTORS = new Set<HarnessActor>(["learner", "engine", "ai", "human_reviewer"]);
const SUBJECTS = new Set<Subject>(["general", "history", "law", "economics"]);
const ATTEMPT_KINDS = new Set<AttemptKind>(["baseline", "retrieval", "transfer"]);
const ARTIFACT_AUTHORS = new Set<ArtifactAuthor>(["learner", "ai", "shared"]);
const HELP_KINDS = new Set<HelpKind>(["process_prompt", "content_hint", "worked_example", "answer"]);
const REMEDIATION_KINDS = new Set(["explanation", "example", "exercise", "source"] as const);
const EVENT_TYPES = new Set<HarnessEvent["type"]>([
  "harness.session.started",
  "harness.goal.confirmed",
  "harness.targets.defined",
  "harness.attempt.started",
  "harness.help.provided",
  "harness.artifact.submitted",
  "harness.attempt.assessed",
  "harness.gap.opened",
  "harness.remediation.provided",
  "harness.gap.resolved",
  "harness.session.completed",
]);

export interface CorruptHarnessRecord {
  readonly __harnessCorruption: {
    readonly eventId: string;
    readonly eventType: string;
    readonly code: string;
    readonly detail: string;
  };
}

export interface EventDecodeResult {
  readonly event?: HarnessEvent;
  readonly anomaly?: AuditAnomaly;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const permitted = new Set(allowed);
  return Object.keys(value).every((key) => permitted.has(key));
}

function enumValue<T extends string>(value: unknown, allowed: ReadonlySet<T>): T | undefined {
  return typeof value === "string" && allowed.has(value as T) ? value as T : undefined;
}

function anomaly(raw: unknown, fallbackIndex: number, code: string, detail: string): EventDecodeResult {
  const value = record(raw);
  return {
    anomaly: {
      eventId: stringValue(value?.eventId) ?? `<malformed-${fallbackIndex}>`,
      eventType: stringValue(value?.type) ?? "<malformed>",
      code,
      detail,
    },
  };
}

function corruption(value: unknown): CorruptHarnessRecord["__harnessCorruption"] | undefined {
  const outer = record(value);
  const inner = record(outer?.__harnessCorruption);
  const eventId = stringValue(inner?.eventId);
  const eventType = stringValue(inner?.eventType);
  const code = stringValue(inner?.code);
  const detail = stringValue(inner?.detail);
  return eventId && eventType && code && detail ? { eventId, eventType, code, detail } : undefined;
}

function parseGoal(value: unknown): GoalInput | undefined {
  const item = record(value);
  if (!item || !exactKeys(item, ["capability", "targetTask", "successCriteria", "subject", "retentionDays"])) return undefined;
  const capability = stringValue(item.capability);
  const targetTask = stringValue(item.targetTask);
  const successCriteria = stringValue(item.successCriteria);
  const subject = enumValue(item.subject, SUBJECTS);
  const retentionDays = item.retentionDays;
  if (capability === undefined || targetTask === undefined || successCriteria === undefined || !subject) return undefined;
  if (retentionDays !== undefined && (typeof retentionDays !== "number" || !Number.isInteger(retentionDays))) return undefined;
  return {
    capability,
    targetTask,
    successCriteria,
    subject,
    ...(retentionDays === undefined ? {} : { retentionDays }),
  };
}

export function parseTargetDefinitions(value: unknown): readonly TargetDefinition[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const targets: TargetDefinition[] = [];
  for (const rawTarget of value) {
    const target = record(rawTarget);
    if (!target || !exactKeys(target, ["id", "description", "criteria"]) || !Array.isArray(target.criteria)) return undefined;
    const id = stringValue(target.id);
    const description = stringValue(target.description);
    if (id === undefined || description === undefined) return undefined;
    const criteria: Array<{ id: string; description: string }> = [];
    for (const rawCriterion of target.criteria) {
      const criterion = record(rawCriterion);
      if (!criterion || !exactKeys(criterion, ["id", "description"])) return undefined;
      const criterionId = stringValue(criterion.id);
      const criterionDescription = stringValue(criterion.description);
      if (criterionId === undefined || criterionDescription === undefined) return undefined;
      criteria.push({ id: criterionId, description: criterionDescription });
    }
    targets.push({ id, description, criteria });
  }
  return targets;
}

function parseStringArray(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? [...value] : undefined;
}

export function parseCriterionAssessments(value: unknown): readonly CriterionAssessmentInput[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const assessments: CriterionAssessmentInput[] = [];
  for (const rawAssessment of value) {
    const item = record(rawAssessment);
    if (!item || !exactKeys(item, ["criterionId", "met", "quotes", "note"])) return undefined;
    const criterionId = stringValue(item.criterionId);
    const quotes = parseStringArray(item.quotes);
    const note = item.note;
    if (criterionId === undefined || typeof item.met !== "boolean" || !quotes || (note !== undefined && typeof note !== "string")) return undefined;
    assessments.push({ criterionId, met: item.met, quotes, ...(note === undefined ? {} : { note }) });
  }
  return assessments;
}

export function decodeHarnessEvent(raw: unknown, fallbackIndex: number): EventDecodeResult {
  const corrupt = corruption(raw);
  if (corrupt) return { anomaly: corrupt };

  const value = record(raw);
  if (!value || !exactKeys(value, ["eventId", "sessionId", "type", "schemaVersion", "occurredAt", "actor", "payload"])) {
    return anomaly(raw, fallbackIndex, "MALFORMED_EVENT", "event must be an object with only the canonical envelope fields");
  }
  const eventId = stringValue(value.eventId);
  const sessionId = stringValue(value.sessionId);
  const typeText = stringValue(value.type);
  const occurredAt = stringValue(value.occurredAt);
  const actor = enumValue(value.actor, ACTORS);
  if (!eventId?.trim() || !sessionId?.trim() || !typeText || !occurredAt || !actor || typeof value.schemaVersion !== "number") {
    return anomaly(raw, fallbackIndex, "MALFORMED_EVENT", "event envelope contains invalid ids, actor, schema, or timestamp fields");
  }
  if (value.schemaVersion === PRE_HARDENING_SCHEMA_VERSION) {
    return anomaly(raw, fallbackIndex, "PRE_HARDENING_SCHEMA", "schema-v2 Harness events are pre-release and cannot prove hardened mastery");
  }
  if (value.schemaVersion !== HARNESS_SCHEMA_VERSION) {
    return anomaly(raw, fallbackIndex, "UNSUPPORTED_SCHEMA", `schema version ${String(value.schemaVersion)} is not supported`);
  }
  if (!Number.isFinite(Date.parse(occurredAt))) {
    return anomaly(raw, fallbackIndex, "INVALID_TIME", "occurredAt is not an ISO-compatible timestamp");
  }
  const type = enumValue(typeText, EVENT_TYPES);
  if (!type) return anomaly(raw, fallbackIndex, "UNKNOWN_EVENT_TYPE", `unknown Harness event type ${typeText}`);
  const payload = record(value.payload);
  if (!payload) return anomaly(raw, fallbackIndex, "MALFORMED_PAYLOAD", `${type} payload must be an object`);
  const base = { eventId, sessionId, schemaVersion: HARNESS_SCHEMA_VERSION, occurredAt, actor };

  switch (type) {
    case "harness.session.started": {
      if (!exactKeys(payload, ["learnerId", "goal"])) break;
      const learnerId = stringValue(payload.learnerId);
      const goal = parseGoal(payload.goal);
      if (learnerId !== undefined && goal) return { event: { ...base, type, payload: { learnerId, goal } } };
      break;
    }
    case "harness.goal.confirmed": {
      if (!exactKeys(payload, ["confirmation"])) break;
      const confirmation = stringValue(payload.confirmation);
      if (confirmation !== undefined) return { event: { ...base, type, payload: { confirmation } } };
      break;
    }
    case "harness.targets.defined": {
      if (!exactKeys(payload, ["targets", "generatedBy"])) break;
      const targets = parseTargetDefinitions(payload.targets);
      const generatedBy = enumValue(payload.generatedBy, new Set(["adapter", "human"] as const));
      if (targets && generatedBy) return { event: { ...base, type, payload: { targets, generatedBy } } };
      break;
    }
    case "harness.attempt.started": {
      if (!exactKeys(payload, ["attemptId", "kind", "targetIds", "prompt"])) break;
      const attemptId = stringValue(payload.attemptId);
      const kind = enumValue(payload.kind, ATTEMPT_KINDS);
      const targetIds = parseStringArray(payload.targetIds);
      const prompt = stringValue(payload.prompt);
      if (attemptId !== undefined && kind && targetIds && prompt !== undefined) {
        return { event: { ...base, type, payload: { attemptId, kind, targetIds, prompt } } };
      }
      break;
    }
    case "harness.help.provided": {
      if (!exactKeys(payload, ["attemptId", "kind", "content"])) break;
      const attemptId = payload.attemptId === undefined ? undefined : stringValue(payload.attemptId);
      const kind = enumValue(payload.kind, HELP_KINDS);
      const content = stringValue(payload.content);
      if ((payload.attemptId === undefined || attemptId !== undefined) && kind && content !== undefined) {
        return { event: { ...base, type, payload: { ...(attemptId === undefined ? {} : { attemptId }), kind, content } } };
      }
      break;
    }
    case "harness.artifact.submitted": {
      if (!exactKeys(payload, ["attemptId", "artifactId", "author", "content"])) break;
      const attemptId = stringValue(payload.attemptId);
      const artifactId = stringValue(payload.artifactId);
      const author = enumValue(payload.author, ARTIFACT_AUTHORS);
      const content = stringValue(payload.content);
      if (attemptId !== undefined && artifactId !== undefined && author && content !== undefined) {
        return { event: { ...base, type, payload: { attemptId, artifactId, author, content } } };
      }
      break;
    }
    case "harness.attempt.assessed": {
      if (!exactKeys(payload, ["attemptId", "assessments"])) break;
      const attemptId = stringValue(payload.attemptId);
      const assessments = parseCriterionAssessments(payload.assessments);
      if (attemptId !== undefined && assessments) return { event: { ...base, type, payload: { attemptId, assessments } } };
      break;
    }
    case "harness.gap.opened": {
      if (!exactKeys(payload, ["gapId", "attemptId", "targetId", "criterionId", "diagnosis"])) break;
      const gapId = stringValue(payload.gapId);
      const attemptId = stringValue(payload.attemptId);
      const targetId = stringValue(payload.targetId);
      const criterionId = stringValue(payload.criterionId);
      const diagnosis = stringValue(payload.diagnosis);
      if (gapId !== undefined && attemptId !== undefined && targetId !== undefined && criterionId !== undefined && diagnosis !== undefined) {
        return { event: { ...base, type, payload: { gapId, attemptId, targetId, criterionId, diagnosis } } };
      }
      break;
    }
    case "harness.remediation.provided": {
      if (!exactKeys(payload, ["gapId", "content", "kind"])) break;
      const gapId = stringValue(payload.gapId);
      const content = stringValue(payload.content);
      const kind = enumValue(payload.kind, REMEDIATION_KINDS);
      if (gapId !== undefined && content !== undefined && kind) return { event: { ...base, type, payload: { gapId, content, kind } } };
      break;
    }
    case "harness.gap.resolved": {
      if (!exactKeys(payload, ["gapId", "attemptId"])) break;
      const gapId = stringValue(payload.gapId);
      const attemptId = stringValue(payload.attemptId);
      if (gapId !== undefined && attemptId !== undefined) return { event: { ...base, type, payload: { gapId, attemptId } } };
      break;
    }
    case "harness.session.completed": {
      if (!exactKeys(payload, ["completionFingerprint"])) break;
      const completionFingerprint = stringValue(payload.completionFingerprint);
      if (completionFingerprint !== undefined) return { event: { ...base, type, payload: { completionFingerprint } } };
      break;
    }
  }
  return anomaly(raw, fallbackIndex, "MALFORMED_PAYLOAD", `${type} payload has invalid fields or enum values`);
}
