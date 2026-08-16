import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { applyMigrations, CURRENT_SCHEMA_VERSION, MIGRATIONS } from "../src/db/migrations.js";

const requiredV1Tables = [
  "users",
  "objectives",
  "study_sessions",
  "knowledge_units",
  "knowledge_relations",
  "attempts",
  "assessment_evidence",
  "gaps",
  "sources",
  "claims",
  "review_items",
  "load_samples",
  "domain_events",
];

function tableNames(db: DatabaseSync): Set<string> {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as unknown as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

test("migrations apply a fresh database to the current schema", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  assert.equal(applyMigrations(db, () => "2026-08-15T00:00:00.000Z"), CURRENT_SCHEMA_VERSION);

  const tables = tableNames(db);
  for (const required of [
    ...requiredV1Tables,
    "study_events",
    "schema_migrations",
    "intervention_templates",
    "policy_definitions",
    "policy_bundles",
    "policy_bundle_members",
    "policy_activations",
    "observations",
    "policy_detections",
    "policy_interventions",
    "policy_parameters",
    "operation_attempts",
    "contamination_records",
    "contamination_closures",
    "attempts",
    "assessment_evidence",
    "gap_records",
    "goal_contracts",
    "review_schedule",
  ]) {
    assert.equal(tables.has(required), true, `missing table ${required}`);
  }

  const rows = db
    .prepare("SELECT version, name, status, checksum FROM schema_migrations ORDER BY version")
    .all() as unknown as Array<{ version: number; name: string; status: string; checksum: string }>;
  assert.deepEqual(rows.map(({ version, name, status }) => ({ version, name, status })), [
    { version: 1, name: "initial", status: "verified" },
    { version: 2, name: "normalized_events", status: "verified" },
    { version: 3, name: "policy_kernel", status: "verified" },
    { version: 4, name: "policy_parameters", status: "verified" },
    { version: 5, name: "operation_provenance", status: "verified" },
    { version: 6, name: "attempt_lifecycle", status: "verified" },
    { version: 7, name: "gap_lifecycle", status: "verified" },
    { version: 8, name: "goal_contracts", status: "verified" },
    { version: 9, name: "review_scheduler", status: "verified" },
    { version: 10, name: "runtime_engine", status: "verified" },
  ]);
  assert.equal(rows.every((row) => row.checksum.length === 64), true);
  assert.equal((db.prepare("PRAGMA user_version").get() as unknown as { user_version: number }).user_version, CURRENT_SCHEMA_VERSION);
  db.close();
});

test("migration runner adopts a legacy v1 database without claiming checksum verification", () => {
  const db = new DatabaseSync(":memory:");
  const legacySchema = readFileSync(new URL("../src/db/schema-v1-legacy.sql", import.meta.url), "utf8");
  db.exec(legacySchema);
  db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (1, ?)").run("legacy-time");
  db.prepare(
    `INSERT INTO users(id, locale, timezone, created_at, updated_at)
     VALUES ('legacy-user', 'ru-RU', 'UTC', 'legacy-time', 'legacy-time')`,
  ).run();
  db.prepare(
    `INSERT INTO domain_events(
       id, user_id, attempt_branch_id, event_type, schema_version,
       payload_json, actor, provenance_json, created_at
     ) VALUES ('legacy-event', 'legacy-user', 'legacy-branch', 'legacy_type', 1,
               '{}', 'engine', '{"kind":"PRODUCT_DECISION","sourceIds":[]}', 'legacy-time')`,
  ).run();

  applyMigrations(db, () => "migration-time");

  const rows = db
    .prepare("SELECT version, name, checksum, status FROM schema_migrations ORDER BY version")
    .all() as unknown as Array<{ version: number; name: string; checksum: string | null; status: string }>;
  assert.deepEqual(rows.map((row) => ({ ...row })), [
    { version: 1, name: "legacy_adopted", checksum: null, status: "adopted_unverified" },
    { version: 2, name: "normalized_events", checksum: MIGRATIONS[1]?.checksum ?? "", status: "verified" },
    { version: 3, name: "policy_kernel", checksum: MIGRATIONS[2]?.checksum ?? "", status: "verified" },
    { version: 4, name: "policy_parameters", checksum: MIGRATIONS[3]?.checksum ?? "", status: "verified" },
    { version: 5, name: "operation_provenance", checksum: MIGRATIONS[4]?.checksum ?? "", status: "verified" },
    { version: 6, name: "attempt_lifecycle", checksum: MIGRATIONS[5]?.checksum ?? "", status: "verified" },
    { version: 7, name: "gap_lifecycle", checksum: MIGRATIONS[6]?.checksum ?? "", status: "verified" },
    { version: 8, name: "goal_contracts", checksum: MIGRATIONS[7]?.checksum ?? "", status: "verified" },
    { version: 9, name: "review_scheduler", checksum: MIGRATIONS[8]?.checksum ?? "", status: "verified" },
    { version: 10, name: "runtime_engine", checksum: MIGRATIONS[9]?.checksum ?? "", status: "verified" },
  ]);
  assert.equal(tableNames(db).has("study_events"), true);
  const backfilled = db
    .prepare("SELECT event_id, payload_hash, integrity_status FROM study_events WHERE event_id = 'legacy-event'")
    .get() as unknown as { event_id: string; payload_hash: string | null; integrity_status: string };
  assert.deepEqual({ ...backfilled }, {
    event_id: "legacy-event",
    payload_hash: null,
    integrity_status: "legacy_unverified",
  });
  db.close();
});

test("migration runner rejects verified migration drift", () => {
  const db = new DatabaseSync(":memory:");
  applyMigrations(db);
  db.prepare("UPDATE schema_migrations SET checksum = 'tampered' WHERE version = 2").run();
  assert.throws(() => applyMigrations(db), /checksum mismatch/i);
  db.close();
});