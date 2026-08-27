import { createHash } from "node:crypto";
import type { StudyStore } from "../db/store.js";
import type { CorruptHarnessRecord } from "./event-validation.js";
import { projectHarness } from "./projector.js";
import type { HarnessEvent } from "./types.js";

export interface HarnessRepository {
  append(event: HarnessEvent): void;
  load(sessionId: string): readonly unknown[];
}

export class MemoryHarnessRepository implements HarnessRepository {
  private readonly events: HarnessEvent[] = [];
  append(event: HarnessEvent): void { this.events.push(structuredClone(event)); }
  load(sessionId: string): readonly unknown[] {
    return structuredClone(this.events.filter((event) => event.sessionId === sessionId));
  }
}

interface EventRow {
  event_id: string;
  correlation_id: string;
  event_type: string;
  schema_version: number;
  payload_json: string;
  payload_hash: string | null;
  integrity_status: string;
  actor: string;
  occurred_at: string;
}

function corrupt(row: EventRow, code: string, detail: string): CorruptHarnessRecord {
  return {
    __harnessCorruption: {
      eventId: row.event_id,
      eventType: row.event_type,
      code,
      detail,
    },
  };
}

/** Persists hardened v3 beside legacy rows in the existing append-only ledger. */
export class SQLiteHarnessRepository implements HarnessRepository {
  constructor(private readonly store: StudyStore) {}

  append(event: HarnessEvent): void {
    const existing = this.load(event.sessionId);
    const projected = projectHarness(existing);
    const learnerId = event.type === "harness.session.started" ? event.payload.learnerId : projected.learnerId;
    if (!learnerId) throw new Error(`Cannot append ${event.type} before a valid harness.session.started`);
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
      provenance: { kind: "PRODUCT_DECISION", sourceIds: [], policyVersion: "harness-v3" },
    });
  }

  load(sessionId: string): readonly unknown[] {
    const rows = this.store.db.prepare(
      `SELECT event_id, correlation_id, event_type, schema_version, payload_json,
              payload_hash, integrity_status, actor, occurred_at
       FROM study_events
       WHERE correlation_id = ? AND event_type LIKE 'harness.%'
       ORDER BY sequence`,
    ).all(sessionId) as unknown as EventRow[];
    return rows.map((row): unknown => {
      if (row.integrity_status !== "verified") {
        return corrupt(row, "UNVERIFIED_EVENT", `integrity status is ${row.integrity_status}`);
      }
      const actualHash = createHash("sha256").update(row.payload_json).digest("hex");
      if (!row.payload_hash || row.payload_hash !== actualHash) {
        return corrupt(row, "PAYLOAD_HASH_MISMATCH", "stored payload hash does not match payload_json");
      }
      let payload: unknown;
      try {
        payload = JSON.parse(row.payload_json);
      } catch {
        return corrupt(row, "MALFORMED_STORED_JSON", "payload_json is not valid JSON");
      }
      return {
        eventId: row.event_id,
        sessionId: row.correlation_id,
        type: row.event_type,
        schemaVersion: row.schema_version,
        occurredAt: row.occurred_at,
        actor: row.actor === "user" ? "learner" : row.actor,
        payload,
      };
    });
  }
}
