import type { StudyStore } from "../db/store.js";
import type { HarnessActor, HarnessEvent } from "./types.js";

export interface HarnessRepository {
  append(event: HarnessEvent): void;
  load(sessionId: string): readonly HarnessEvent[];
}

export class MemoryHarnessRepository implements HarnessRepository {
  private readonly events: HarnessEvent[] = [];
  append(event: HarnessEvent): void { this.events.push(event); }
  load(sessionId: string): readonly HarnessEvent[] { return this.events.filter((event) => event.sessionId === sessionId); }
}

interface EventRow {
  event_id: string;
  correlation_id: string;
  event_type: HarnessEvent["type"];
  schema_version: number;
  payload_json: string;
  actor: "user" | "engine" | "ai" | "human_reviewer";
  occurred_at: string;
}

/** Persists v2 beside legacy rows in the existing append-only study_events ledger. */
export class SQLiteHarnessRepository implements HarnessRepository {
  constructor(private readonly store: StudyStore) {}

  append(event: HarnessEvent): void {
    const existing = this.load(event.sessionId);
    const learnerId = event.type === "harness.session.started"
      ? event.payload.learnerId
      : existing[0]?.type === "harness.session.started" ? existing[0].payload.learnerId : undefined;
    if (!learnerId) throw new Error(`Cannot append ${event.type} before harness.session.started`);
    this.store.ensureUser(learnerId);
    this.store.appendEvent({
      eventId: event.eventId,
      schemaVersion: event.schemaVersion,
      userId: learnerId,
      attemptBranchId: event.sessionId,
      type: event.type,
      payload: event.payload,
      actor: event.actor === "learner" ? "user" : event.actor,
      occurredAt: event.occurredAt,
      provenance: { kind: "PRODUCT_DECISION", sourceIds: [], policyVersion: "harness-v2" },
    });
  }

  load(sessionId: string): readonly HarnessEvent[] {
    const rows = this.store.db.prepare(
      `SELECT event_id, correlation_id, event_type, schema_version, payload_json, actor, occurred_at
       FROM study_events
       WHERE correlation_id = ? AND event_type LIKE 'harness.%'
       ORDER BY sequence`,
    ).all(sessionId) as unknown as EventRow[];
    return rows.map((row) => ({
      eventId: row.event_id,
      sessionId: row.correlation_id,
      type: row.event_type,
      schemaVersion: row.schema_version,
      occurredAt: row.occurred_at,
      actor: row.actor === "user" ? "learner" : row.actor,
      payload: JSON.parse(row.payload_json),
    }) as HarnessEvent);
  }
}
