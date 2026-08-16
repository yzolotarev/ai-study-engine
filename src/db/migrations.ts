import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";

export interface Migration {
  version: number;
  name: string;
  sql: string;
  checksum: string;
}

function loadMigration(version: number, name: string, filename: string): Migration {
  const sql = readFileSync(new URL(`./migrations/${filename}`, import.meta.url), "utf8");
  return {
    version,
    name,
    sql,
    checksum: createHash("sha256").update(sql).digest("hex"),
  };
}

export const MIGRATIONS: readonly Migration[] = [
  loadMigration(1, "initial", "001_initial.sql"),
  loadMigration(2, "normalized_events", "002_normalized_events.sql"),
  loadMigration(3, "policy_kernel", "003_policy_kernel.sql"),
  loadMigration(4, "policy_parameters", "004_policy_parameters.sql"),
  loadMigration(5, "operation_provenance", "005_operation_provenance.sql"),
  loadMigration(6, "attempt_lifecycle", "006_attempt_lifecycle.sql"),
  loadMigration(7, "gap_lifecycle", "007_gap_lifecycle.sql"),
  loadMigration(8, "goal_contracts", "008_goal_contracts.sql"),
  loadMigration(9, "review_scheduler", "009_review_scheduler.sql"),
  loadMigration(10, "runtime_engine", "010_runtime_engine.sql"),
];

export const CURRENT_SCHEMA_VERSION = MIGRATIONS.at(-1)?.version ?? 0;

type MigrationRow = {
  version: number;
  name: string | null;
  checksum: string | null;
  status: string | null;
};

type TableInfoRow = { name: string };

function ensureMigrationTable(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT,
    checksum TEXT,
    status TEXT,
    applied_at TEXT NOT NULL
  )`);

  const columns = new Set(
    (db.prepare("PRAGMA table_info(schema_migrations)").all() as unknown as TableInfoRow[]).map((row) => row.name),
  );
  if (!columns.has("name")) db.exec("ALTER TABLE schema_migrations ADD COLUMN name TEXT");
  if (!columns.has("checksum")) db.exec("ALTER TABLE schema_migrations ADD COLUMN checksum TEXT");
  if (!columns.has("status")) db.exec("ALTER TABLE schema_migrations ADD COLUMN status TEXT");

  // v1 databases predate checksums. Preserve that fact instead of pretending
  // their historical schema was checksum-verified.
  db.prepare(
    `UPDATE schema_migrations
     SET name = COALESCE(name, 'legacy_adopted'),
         status = COALESCE(status, 'adopted_unverified')
     WHERE name IS NULL OR status IS NULL`,
  ).run();
}

function validateManifest(): void {
  let previous = 0;
  const versions = new Set<number>();
  for (const migration of MIGRATIONS) {
    if (versions.has(migration.version)) throw new Error(`Duplicate migration version ${migration.version}`);
    if (migration.version <= previous) throw new Error("Migrations must be ordered by increasing version");
    versions.add(migration.version);
    previous = migration.version;
  }
}

export function applyMigrations(db: DatabaseSync, appliedAt = () => new Date().toISOString()): number {
  validateManifest();
  ensureMigrationTable(db);

  const appliedRows = db
    .prepare("SELECT version, name, checksum, status FROM schema_migrations ORDER BY version")
    .all() as unknown as MigrationRow[];
  const knownVersions = new Set(MIGRATIONS.map((migration) => migration.version));

  for (const row of appliedRows) {
    if (!knownVersions.has(row.version)) {
      throw new Error(`Database contains unknown migration version ${row.version}`);
    }
    const expected = MIGRATIONS.find((migration) => migration.version === row.version);
    if (!expected) throw new Error(`Missing migration ${row.version} from manifest`);
    if (row.status === "verified" && row.checksum !== expected.checksum) {
      throw new Error(`Migration checksum mismatch at version ${row.version}`);
    }
  }

  const appliedVersions = new Set(appliedRows.map((row) => row.version));
  for (const migration of MIGRATIONS) {
    if (appliedVersions.has(migration.version)) continue;
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(migration.sql);
      db.prepare(
        `INSERT INTO schema_migrations(version, name, checksum, status, applied_at)
         VALUES (?, ?, ?, 'verified', ?)`,
      ).run(migration.version, migration.name, migration.checksum, appliedAt());
      db.exec(`PRAGMA user_version = ${migration.version}`);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw new Error(`Migration ${migration.version} (${migration.name}) failed`, { cause: error });
    }
  }

  return CURRENT_SCHEMA_VERSION;
}
