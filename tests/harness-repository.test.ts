import assert from "node:assert/strict";
import test from "node:test";
import { StudyStore } from "../src/db/store.js";
import { SQLiteHarnessRepository, StudyHarness } from "../src/harness/index.js";

test("SQLite harness repository preserves v2 ids, schema, order, and replays state", () => {
  const store = new StudyStore(":memory:");
  let id = 0;
  let instant = Date.parse("2026-02-01T00:00:00Z");
  const repository = new SQLiteHarnessRepository(store);
  const harness = new StudyHarness(repository, {
    id: () => `sqlite-${++id}`,
    now: () => new Date(instant++).toISOString(),
  });
  const started = harness.start("sqlite-learner", {
    capability: "Apply supply and demand",
    targetTask: "Analyze a price-control scenario",
    successCriteria: "Correct model, mechanism, and transfer",
    subject: "economics",
  });
  harness.confirm(started.sessionId, "confirmed by learner");
  harness.defineTargets(started.sessionId);

  const rows = store.db.prepare(
    `SELECT event_id, schema_version, correlation_id, legacy_domain_event_id
     FROM study_events WHERE correlation_id = ? ORDER BY sequence`,
  ).all(started.sessionId) as unknown as Array<{
    event_id: string; schema_version: number; correlation_id: string; legacy_domain_event_id: string;
  }>;
  assert.deepEqual(rows.map((row) => row.event_id), ["sqlite-2", "sqlite-3", "sqlite-4"]);
  assert.ok(rows.every((row) => row.schema_version === 2));
  assert.ok(rows.every((row) => row.correlation_id === started.sessionId));
  assert.ok(rows.every((row) => row.legacy_domain_event_id === row.event_id));

  const replayed = harness.status(started.sessionId).projection;
  assert.equal(replayed.goal?.subject, "economics");
  assert.equal(replayed.goalConfirmedAt, "2026-02-01T00:00:00.001Z");
  assert.equal(Object.keys(replayed.targets).length, 1);
  assert.equal(replayed.anomalies.length, 0);
  store.close();
});

test("SQLite repository keeps invalid event order as replayable anomaly", () => {
  const store = new StudyStore(":memory:");
  let id = 0;
  const repository = new SQLiteHarnessRepository(store);
  const harness = new StudyHarness(repository, { id: () => `event-${++id}`, now: () => "2026-02-01T00:00:00Z" });
  const { sessionId } = harness.start("learner", {
    capability: "c", targetTask: "t", successCriteria: "s", subject: "general",
  });
  harness.submit(sessionId, "unknown-attempt", "learner text");
  const first = harness.status(sessionId).projection;
  const second = harness.status(sessionId).projection;
  assert.deepEqual(first.anomalies, second.anomalies);
  assert.equal(first.anomalies[0]?.code, "INVALID_SUBMISSION");
  assert.equal(repository.load(sessionId).length, 2);
  store.close();
});
