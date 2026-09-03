import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { stableStringify, sha256Hex } from "./hash.js";
import { EVALUATION_STORE_SCHEMA_VERSION } from "./types.js";
import type {
  LearnerArtifactProvenance,
  CriticalIncident,
  EvaluationProtocol,
  InterventionObservation,
  LearnerArtifact,
  LearningTrial,
  PolicyVariant,
  Checkpoint,
  StudyPack,
  SubjectiveFeedback,
  TrialSubjectKind,
} from "./types.js";

interface JsonRow {
  json: string;
}

interface ColumnInfoRow {
  name: string;
}

interface IndexInfoRow {
  readonly name: string;
  readonly unique: number;
}

interface IndexColumnRow {
  readonly name: string;
}

interface ProvenanceMigrationRow {
  readonly id: string;
  readonly json: string;
  readonly provenance: string;
}

export type EvaluationDatasetKind = "human" | "synthetic" | "mixed";
export interface EvaluationStoreOptions {
  readonly datasetKind?: EvaluationDatasetKind;
}

export interface EvaluationDeletionResult {
  readonly tombstoneId: string;
  readonly participantHash: string;
  readonly deletedTrials: number;
  readonly deletedCheckpoints: number;
  readonly deletedArtifacts: number;
  readonly deletedObservations: number;
  readonly deletedIncidents: number;
  readonly deletedFeedback: number;
}

interface AuditEventRow {
  readonly event_seq: number;
  readonly entity_type: string;
  readonly entity_id: string;
  readonly event_type: string;
  readonly payload_json: string;
  readonly payload_hash: string;
  readonly previous_hash: string | null;
  readonly event_hash: string;
  readonly created_at: string;
}

interface EncryptedBackupEnvelope {
  readonly magic: "AI-STUDY-ENGINE-ENCRYPTED-BACKUP-V1";
  readonly kdf: "scrypt";
  readonly cipher: "aes-256-gcm";
  readonly salt: string;
  readonly iv: string;
  readonly tag: string;
  readonly ciphertext: string;
}

const TRIAL_SUBJECT_KINDS = new Set<TrialSubjectKind>(["human", "synthetic", "legacy-unclassified"]);
const ARTIFACT_PROVENANCE_KINDS = new Set<LearnerArtifactProvenance>(["trusted-human", "deterministic-fixture", "ai-simulation", "legacy-unclassified"]);

function isTrialSubjectKind(value: unknown): value is TrialSubjectKind {
  return typeof value === "string" && TRIAL_SUBJECT_KINDS.has(value as TrialSubjectKind);
}

function isArtifactProvenance(value: unknown): value is LearnerArtifactProvenance {
  return typeof value === "string" && ARTIFACT_PROVENANCE_KINDS.has(value as LearnerArtifactProvenance);
}

export class EvaluationStore {
  readonly db: DatabaseSync;
  readonly path: string;
  readonly datasetKind: EvaluationDatasetKind;

  constructor(path: string, options: EvaluationStoreOptions = {}) {
    this.path = path;
    this.datasetKind = options.datasetKind ?? "mixed";
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS evaluation_store_schema (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        version INTEGER NOT NULL,
        migrated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS evaluation_dataset (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        kind TEXT NOT NULL CHECK (kind IN ('human', 'synthetic', 'mixed'))
      );
      CREATE TABLE IF NOT EXISTS evaluation_audit_events (
        event_seq INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        previous_hash TEXT,
        event_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS evaluation_deletion_tombstones (
        tombstone_id TEXT PRIMARY KEY,
        participant_hash TEXT NOT NULL,
        deleted_at TEXT NOT NULL,
        deleted_trials INTEGER NOT NULL,
        deleted_checkpoints INTEGER NOT NULL,
        deleted_artifacts INTEGER NOT NULL,
        deleted_observations INTEGER NOT NULL,
        deleted_incidents INTEGER NOT NULL,
        deleted_feedback INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS evaluation_protocols (
        protocol_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        definition_hash TEXT NOT NULL,
        json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (protocol_id, version)
      );
      CREATE TABLE IF NOT EXISTS study_packs (
        pack_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        definition_hash TEXT NOT NULL,
        json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (pack_id, version)
      );
      CREATE TABLE IF NOT EXISTS policy_variants (
        policy_id TEXT NOT NULL,
        policy_version INTEGER NOT NULL,
        json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (policy_id, policy_version)
      );
      CREATE TABLE IF NOT EXISTS evaluation_trials (
        trial_id TEXT PRIMARY KEY,
        trial_subject_kind TEXT NOT NULL DEFAULT 'legacy-unclassified'
          CHECK (trial_subject_kind IN ('human', 'synthetic', 'legacy-unclassified')),
        protocol_id TEXT,
        protocol_version INTEGER,
        pack_id TEXT,
        pack_version INTEGER,
        participant_id TEXT,
        policy_id TEXT,
        policy_version INTEGER,
        microtopic_id TEXT,
        matched_set_id TEXT,
        assignment_seed TEXT,
        assignment_order INTEGER,
        started_at TEXT,
        ended_at TEXT,
        retention_due_at TEXT,
        status TEXT,
        json TEXT NOT NULL,
        created_at TEXT,
        updated_at TEXT,
        UNIQUE (protocol_id, protocol_version, pack_id, pack_version, participant_id, microtopic_id)
      );
      CREATE TABLE IF NOT EXISTS evaluation_checkpoints (
        checkpoint_id TEXT PRIMARY KEY,
        attempt_id TEXT,
        trial_id TEXT,
        phase TEXT,
        presented_at TEXT,
        assessed_at TEXT,
        due_at TEXT,
        status TEXT,
        json TEXT NOT NULL,
        created_at TEXT,
        updated_at TEXT
      );
      CREATE TABLE IF NOT EXISTS evaluation_artifacts (
        artifact_id TEXT PRIMARY KEY,
        artifact_provenance TEXT NOT NULL DEFAULT 'legacy-unclassified'
          CHECK (artifact_provenance IN ('trusted-human', 'deterministic-fixture', 'ai-simulation', 'legacy-unclassified')),
        checkpoint_id TEXT,
        content_hash TEXT,
        json TEXT NOT NULL,
        created_at TEXT,
        updated_at TEXT,
        UNIQUE (checkpoint_id, content_hash)
      );
      CREATE TABLE IF NOT EXISTS evaluation_observations (
        observation_id TEXT PRIMARY KEY,
        trial_id TEXT,
        checkpoint_id TEXT,
        json TEXT NOT NULL,
        created_at TEXT,
        updated_at TEXT
      );
      CREATE TABLE IF NOT EXISTS critical_incidents (
        incident_id TEXT PRIMARY KEY,
        trial_id TEXT,
        checkpoint_id TEXT,
        artifact_id TEXT,
        turn_id TEXT,
        category TEXT,
        learner_note TEXT,
        json TEXT NOT NULL,
        created_at TEXT,
        updated_at TEXT
      );
      CREATE TABLE IF NOT EXISTS subjective_feedback (
        feedback_id TEXT PRIMARY KEY,
        trial_id TEXT,
        json TEXT NOT NULL,
        created_at TEXT,
        updated_at TEXT
      );
    `);
    const dataset = this.db.prepare(`SELECT kind FROM evaluation_dataset WHERE singleton = 1`).get() as { kind?: EvaluationDatasetKind } | undefined;
    if (!dataset) this.db.prepare(`INSERT INTO evaluation_dataset (singleton, kind) VALUES (1, ?)`).run(this.datasetKind);
    else if (dataset.kind !== this.datasetKind && dataset.kind !== "mixed" && this.datasetKind !== "mixed") throw new Error(`evaluation dataset kind ${dataset.kind} conflicts with requested ${this.datasetKind}`);
    this.ensureProvenanceSchema();
    this.seedAuditEvents();
  }

  close(): void {
    this.db.close();
  }

  integrityCheck(): { readonly ok: boolean; readonly result: string; readonly schemaVersion: number } {
    const row = this.db.prepare("PRAGMA integrity_check").get() as { integrity_check?: string } | undefined;
    const result = row?.integrity_check ?? "unknown";
    const schema = this.db.prepare(`SELECT version FROM evaluation_store_schema WHERE singleton = 1`).get() as { version?: number } | undefined;
    const audit = this.auditIntegrity();
    const combined = audit.ok ? result : `${result}; ${audit.result}`;
    return { ok: result === "ok" && schema?.version === EVALUATION_STORE_SCHEMA_VERSION && audit.ok, result: combined, schemaVersion: schema?.version ?? -1 };
  }

  backupTo(destination: string): void {
    if (this.path === ":memory:") throw new Error("in-memory evaluation stores cannot be backed up");
    if (!destination || destination === ":memory:") throw new Error("backup destination must be a file path");
    mkdirSync(dirname(destination), { recursive: true });
    const escaped = destination.replaceAll("'", "''");
    this.db.exec(`VACUUM INTO '${escaped}'`);
  }

  /**
   * Create an opt-in encrypted backup.  The passphrase is never persisted in
   * the store; callers must retain it separately to restore the snapshot.
   */
  backupToEncrypted(destination: string, passphrase: string): void {
    if (this.path === ":memory:") throw new Error("in-memory evaluation stores cannot be backed up");
    if (!destination || destination === ":memory:") throw new Error("backup destination must be a file path");
    if (typeof passphrase !== "string" || passphrase.length < 12) throw new Error("encrypted backup passphrase must be at least 12 characters");
    if (existsSync(destination)) throw new Error(`backup destination already exists: ${destination}`);
    mkdirSync(dirname(destination), { recursive: true });
    const tempDir = mkdtempSync(`${dirname(destination)}/.evaluation-backup-`);
    const tempDb = `${tempDir}/snapshot.sqlite`;
    try {
      this.backupTo(tempDb);
      const plaintext = readFileSync(tempDb);
      const salt = randomBytes(16);
      const iv = randomBytes(12);
      const key = scryptSync(passphrase, salt, 32);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const envelope: EncryptedBackupEnvelope = {
        magic: "AI-STUDY-ENGINE-ENCRYPTED-BACKUP-V1",
        kdf: "scrypt",
        cipher: "aes-256-gcm",
        salt: salt.toString("base64"),
        iv: iv.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
        ciphertext: ciphertext.toString("base64"),
      };
      writeFileSync(destination, `${JSON.stringify(envelope)}\n`, { flag: "wx", mode: 0o600 });
      chmodSync(destination, 0o600);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  private auditEntitySpecs(): readonly { readonly table: string; readonly keyColumns: readonly string[] }[] {
    return [
      { table: "evaluation_protocols", keyColumns: ["protocol_id", "version"] },
      { table: "study_packs", keyColumns: ["pack_id", "version"] },
      { table: "policy_variants", keyColumns: ["policy_id", "policy_version"] },
      { table: "evaluation_trials", keyColumns: ["trial_id"] },
      { table: "evaluation_checkpoints", keyColumns: ["checkpoint_id"] },
      { table: "evaluation_artifacts", keyColumns: ["artifact_id"] },
      { table: "evaluation_observations", keyColumns: ["observation_id"] },
      { table: "critical_incidents", keyColumns: ["incident_id"] },
      { table: "subjective_feedback", keyColumns: ["feedback_id"] },
    ];
  }

  private appendAuditEvent(table: string, entityId: string, eventType: string, payload: unknown, createdAt = this.now()): void {
    const payloadJson = stableStringify(payload as never);
    const payloadHash = sha256Hex(payloadJson);
    const previousRow = this.db.prepare(`SELECT event_hash FROM evaluation_audit_events ORDER BY event_seq DESC LIMIT 1`).get() as { event_hash?: string } | undefined;
    const previousHash = previousRow?.event_hash ?? null;
    const eventHash = sha256Hex([previousHash ?? "", table, entityId, eventType, payloadHash, createdAt].join("|"));
    const eventId = `evaluation-event-${eventHash.slice(0, 32)}`;
    this.db.prepare(`INSERT OR IGNORE INTO evaluation_audit_events
      (event_id, entity_type, entity_id, event_type, payload_json, payload_hash, previous_hash, event_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(eventId, table, entityId, eventType, payloadJson, payloadHash, previousHash, eventHash, createdAt);
  }

  private seedAuditEvents(): void {
    for (const spec of this.auditEntitySpecs()) {
      const rows = this.db.prepare(`SELECT ${spec.keyColumns.join(", ")}, json FROM ${spec.table}`).all() as unknown as Record<string, string>[];
      for (const row of rows) {
        const entityId = stableStringify(Object.fromEntries(spec.keyColumns.map((key) => [key, row[key]])) as never);
        const exists = this.db.prepare(`SELECT 1 FROM evaluation_audit_events WHERE entity_type = ? AND entity_id = ? LIMIT 1`).get(spec.table, entityId);
        if (!exists) this.appendAuditEvent(spec.table, entityId, "snapshot", { json: row.json });
      }
    }
  }

  /** Explicitly delete one participant's local records after a typed confirmation. */
  deleteParticipantData(participantId: string, confirmation: string): EvaluationDeletionResult {
    if (!participantId.trim()) throw new Error("participantId is required");
    if (confirmation !== `DELETE ${participantId}`) throw new Error("deletion requires exact typed confirmation string DELETE <participantId>");
    const participantHash = sha256Hex(participantId);
    const trials = this.db.prepare(`SELECT trial_id FROM evaluation_trials WHERE participant_id = ?`).all(participantId) as unknown as { trial_id: string }[];
    const trialIds = trials.map((row) => row.trial_id);
    const count = (table: string, column: string): number => {
      if (trialIds.length === 0) return 0;
      const placeholders = trialIds.map(() => "?").join(", ");
      return Number((this.db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column} IN (${placeholders})`).get(...trialIds) as { count?: number }).count ?? 0);
    };
    const checkpointIds = trialIds.length === 0 ? [] : (this.db.prepare(`SELECT checkpoint_id FROM evaluation_checkpoints WHERE trial_id IN (${trialIds.map(() => "?").join(", ")})`).all(...trialIds) as unknown as { checkpoint_id: string }[]).map((row) => row.checkpoint_id);
    const artifactCount = checkpointIds.length === 0 ? 0 : Number((this.db.prepare(`SELECT COUNT(*) AS count FROM evaluation_artifacts WHERE checkpoint_id IN (${checkpointIds.map(() => "?").join(", ")})`).get(...checkpointIds) as { count?: number }).count ?? 0);
    const observations = count("evaluation_observations", "trial_id");
    const incidents = count("critical_incidents", "trial_id");
    const feedback = count("subjective_feedback", "trial_id");
    const deletedAt = this.now();
    const tombstoneId = `deletion-${sha256Hex([participantHash, deletedAt, String(trialIds.length)].join("|")).slice(0, 24)}`;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (trialIds.length > 0) {
        const placeholders = trialIds.map(() => "?").join(", ");
        for (const trialId of trialIds) {
          const row = this.db.prepare(`SELECT json FROM evaluation_trials WHERE trial_id = ?`).get(trialId) as { json?: string } | undefined;
          if (row?.json) this.appendAuditEvent("evaluation_trials", stableStringify({ trial_id: trialId } as never), "deleted", { previousJson: row.json }, deletedAt);
        }
        if (checkpointIds.length > 0) {
          const checkpointPlaceholders = checkpointIds.map(() => "?").join(", ");
          for (const checkpointId of checkpointIds) {
            const row = this.db.prepare(`SELECT json FROM evaluation_checkpoints WHERE checkpoint_id = ?`).get(checkpointId) as { json?: string } | undefined;
            if (row?.json) this.appendAuditEvent("evaluation_checkpoints", stableStringify({ checkpoint_id: checkpointId } as never), "deleted", { previousJson: row.json }, deletedAt);
          }
          const artifactRows = this.db.prepare(`SELECT artifact_id, json FROM evaluation_artifacts WHERE checkpoint_id IN (${checkpointPlaceholders})`).all(...checkpointIds) as unknown as { artifact_id: string; json: string }[];
          for (const row of artifactRows) this.appendAuditEvent("evaluation_artifacts", stableStringify({ artifact_id: row.artifact_id } as never), "deleted", { previousJson: row.json }, deletedAt);
          this.db.prepare(`DELETE FROM evaluation_artifacts WHERE checkpoint_id IN (${checkpointPlaceholders})`).run(...checkpointIds);
          this.db.prepare(`DELETE FROM evaluation_checkpoints WHERE checkpoint_id IN (${checkpointPlaceholders})`).run(...checkpointIds);
        }
        for (const spec of [
          { table: "evaluation_observations", column: "trial_id", id: "observation_id" },
          { table: "critical_incidents", column: "trial_id", id: "incident_id" },
          { table: "subjective_feedback", column: "trial_id", id: "feedback_id" },
        ] as const) {
          const rows = this.db.prepare(`SELECT ${spec.id}, json FROM ${spec.table} WHERE ${spec.column} IN (${placeholders})`).all(...trialIds) as unknown as { [key: string]: string }[];
          for (const row of rows) this.appendAuditEvent(spec.table, stableStringify({ [spec.id]: row[spec.id]! } as never), "deleted", { previousJson: row.json }, deletedAt);
        }
        this.db.prepare(`DELETE FROM evaluation_observations WHERE trial_id IN (${placeholders})`).run(...trialIds);
        this.db.prepare(`DELETE FROM critical_incidents WHERE trial_id IN (${placeholders})`).run(...trialIds);
        this.db.prepare(`DELETE FROM subjective_feedback WHERE trial_id IN (${placeholders})`).run(...trialIds);
        this.db.prepare(`DELETE FROM evaluation_trials WHERE trial_id IN (${placeholders})`).run(...trialIds);
      }
      this.db.prepare(`INSERT INTO evaluation_deletion_tombstones (tombstone_id, participant_hash, deleted_at, deleted_trials, deleted_checkpoints, deleted_artifacts, deleted_observations, deleted_incidents, deleted_feedback)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(tombstoneId, participantHash, deletedAt, trialIds.length, checkpointIds.length, artifactCount, observations, incidents, feedback);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return { tombstoneId, participantHash, deletedTrials: trialIds.length, deletedCheckpoints: checkpointIds.length, deletedArtifacts: artifactCount, deletedObservations: observations, deletedIncidents: incidents, deletedFeedback: feedback };
  }

  auditIntegrity(): { readonly ok: boolean; readonly result: string; readonly eventCount: number } {
    const events = this.db.prepare(`SELECT event_seq, entity_type, entity_id, event_type, payload_json, payload_hash, previous_hash, event_hash, created_at FROM evaluation_audit_events ORDER BY event_seq`).all() as unknown as AuditEventRow[];
    let previous: string | null = null;
    for (const row of events) {
      if (row.previous_hash !== previous) return { ok: false, result: `audit chain previous hash mismatch at event ${row.event_seq}`, eventCount: events.length };
      const payloadHash = sha256Hex(row.payload_json);
      if (payloadHash !== row.payload_hash) return { ok: false, result: `audit payload hash mismatch at event ${row.event_seq}`, eventCount: events.length };
      const expected = sha256Hex([row.previous_hash ?? "", row.entity_type, row.entity_id, row.event_type, row.payload_hash, row.created_at].join("|"));
      if (expected !== row.event_hash) return { ok: false, result: `audit event hash mismatch at event ${row.event_seq}`, eventCount: events.length };
      previous = row.event_hash;
    }
    for (const spec of this.auditEntitySpecs()) {
      const currentRows = this.db.prepare(`SELECT ${spec.keyColumns.join(", ")}, json FROM ${spec.table}`).all() as unknown as Record<string, string>[];
      const currentIds = new Set(currentRows.map((row) => stableStringify(Object.fromEntries(spec.keyColumns.map((key) => [key, row[key]])) as never)));
      for (const row of currentRows) {
        const entityId = stableStringify(Object.fromEntries(spec.keyColumns.map((key) => [key, row[key]])) as never);
        const latest = this.db.prepare(`SELECT event_type, payload_json FROM evaluation_audit_events WHERE entity_type = ? AND entity_id = ? ORDER BY event_seq DESC LIMIT 1`).get(spec.table, entityId) as { event_type?: string; payload_json?: string } | undefined;
        if (!latest || latest.event_type === "deleted") return { ok: false, result: `audit missing current snapshot for ${spec.table}:${entityId}`, eventCount: events.length };
        const payload = JSON.parse(latest.payload_json ?? "null") as { json?: string };
        if (payload.json !== row.json) return { ok: false, result: `audit current snapshot mismatch for ${spec.table}:${entityId}`, eventCount: events.length };
      }
      const latestRows = this.db.prepare(`SELECT events.entity_id, events.event_type
        FROM evaluation_audit_events AS events
        JOIN (SELECT entity_id, MAX(event_seq) AS max_seq FROM evaluation_audit_events WHERE entity_type = ? GROUP BY entity_id) AS latest
          ON latest.entity_id = events.entity_id AND latest.max_seq = events.event_seq
        WHERE events.entity_type = ?`).all(spec.table, spec.table) as unknown as { entity_id: string; event_type: string }[];
      for (const latest of latestRows) {
        if (latest.event_type !== "deleted" && !currentIds.has(latest.entity_id)) return { ok: false, result: `audit current row missing for ${spec.table}:${latest.entity_id}`, eventCount: events.length };
      }
    }
    return { ok: true, result: "ok", eventCount: events.length };
  }

  private now(): string {
    return new Date().toISOString();
  }

  private hasColumn(table: string, column: string): boolean {
    const rows = this.db.prepare(`PRAGMA table_info(${table})`).all() as unknown as ColumnInfoRow[];
    return rows.some((row) => row.name === column);
  }

  private ensureProvenanceSchema(): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const schemaRow = this.db.prepare(`SELECT version FROM evaluation_store_schema WHERE singleton = 1`).get() as { version: number } | undefined;
      if (schemaRow && schemaRow.version > EVALUATION_STORE_SCHEMA_VERSION) {
        throw new Error(`evaluation store schema ${schemaRow.version} is newer than supported schema ${EVALUATION_STORE_SCHEMA_VERSION}`);
      }
      if (!this.hasColumn("evaluation_trials", "trial_subject_kind")) {
        this.db.exec(`ALTER TABLE evaluation_trials ADD COLUMN trial_subject_kind TEXT NOT NULL DEFAULT 'legacy-unclassified'
          CHECK (trial_subject_kind IN ('human', 'synthetic', 'legacy-unclassified'))`);
      }
      if (!this.hasColumn("evaluation_artifacts", "artifact_provenance")) {
        this.db.exec(`ALTER TABLE evaluation_artifacts ADD COLUMN artifact_provenance TEXT NOT NULL DEFAULT 'legacy-unclassified'
          CHECK (artifact_provenance IN ('trusted-human', 'deterministic-fixture', 'ai-simulation', 'legacy-unclassified'))`);
      }
      this.ensureCheckpointAttemptSchema();
      this.normaliseLegacyTrialRows();
      this.normaliseLegacyArtifactRows();
      this.db.exec(`CREATE INDEX IF NOT EXISTS evaluation_trials_subject_kind_idx
        ON evaluation_trials (trial_subject_kind, protocol_id, protocol_version, pack_id, pack_version, participant_id)`);
      this.db.exec(`CREATE INDEX IF NOT EXISTS evaluation_artifacts_provenance_idx
        ON evaluation_artifacts (artifact_provenance, checkpoint_id)`);
      this.db.prepare(`INSERT INTO evaluation_store_schema (singleton, version, migrated_at)
        VALUES (1, ?, ?)
        ON CONFLICT (singleton) DO UPDATE SET version = excluded.version, migrated_at = excluded.migrated_at
        WHERE evaluation_store_schema.version < excluded.version`).run(EVALUATION_STORE_SCHEMA_VERSION, this.now());
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private ensureCheckpointAttemptSchema(): void {
    const hasAttemptId = this.hasColumn("evaluation_checkpoints", "attempt_id");
    const uniquePhaseIndex = (this.db.prepare(`PRAGMA index_list(evaluation_checkpoints)`).all() as unknown as IndexInfoRow[]).some((index) => {
      if (index.unique !== 1 || index.name.startsWith("sqlite_autoindex_evaluation_checkpoints_1")) return false;
      const columns = this.db.prepare(`PRAGMA index_info(${index.name})`).all() as unknown as IndexColumnRow[];
      return columns.map((column) => column.name).join("|") === "trial_id|phase";
    });
    if (hasAttemptId && !uniquePhaseIndex) return;
    const attemptExpression = hasAttemptId ? "COALESCE(attempt_id, checkpoint_id)" : "checkpoint_id";
    this.db.exec(`
      CREATE TABLE evaluation_checkpoints_migrated (
        checkpoint_id TEXT PRIMARY KEY,
        attempt_id TEXT,
        trial_id TEXT,
        phase TEXT,
        presented_at TEXT,
        assessed_at TEXT,
        due_at TEXT,
        status TEXT,
        json TEXT NOT NULL,
        created_at TEXT,
        updated_at TEXT
      );
      INSERT INTO evaluation_checkpoints_migrated
        (checkpoint_id, attempt_id, trial_id, phase, presented_at, assessed_at, due_at, status, json, created_at, updated_at)
        SELECT checkpoint_id, ${attemptExpression}, trial_id, phase, presented_at, assessed_at, due_at, status, json, created_at, updated_at
        FROM evaluation_checkpoints;
      DROP TABLE evaluation_checkpoints;
      ALTER TABLE evaluation_checkpoints_migrated RENAME TO evaluation_checkpoints;
      CREATE INDEX IF NOT EXISTS evaluation_checkpoints_trial_phase_idx ON evaluation_checkpoints (trial_id, phase, presented_at, checkpoint_id);
    `);
  }

  private normaliseLegacyTrialRows(): void {
    const rows = this.db.prepare(`SELECT trial_id AS id, json, trial_subject_kind AS provenance FROM evaluation_trials`).all() as unknown as ProvenanceMigrationRow[];
    const update = this.db.prepare(`UPDATE evaluation_trials SET trial_subject_kind = ?, json = ? WHERE trial_id = ?`);
    for (const row of rows) {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(row.json) as Record<string, unknown>;
      } catch {
        this.db.prepare(`UPDATE evaluation_trials SET trial_subject_kind = 'legacy-unclassified' WHERE trial_id = ?`).run(row.id);
        continue;
      }
      const columnKind = isTrialSubjectKind(row.provenance) ? row.provenance : "legacy-unclassified";
      const jsonKind = parsed.trialSubjectKind;
      const kind = jsonKind === undefined
        ? columnKind
        : isTrialSubjectKind(jsonKind) && jsonKind === columnKind
          ? jsonKind
          : "legacy-unclassified";
      if (parsed.trialSubjectKind !== kind || row.provenance !== kind) {
        update.run(kind, stableStringify({ ...parsed, trialSubjectKind: kind } as never), row.id);
      }
    }
  }

  private normaliseLegacyArtifactRows(): void {
    const rows = this.db.prepare(`SELECT artifact_id AS id, json, artifact_provenance AS provenance FROM evaluation_artifacts`).all() as unknown as ProvenanceMigrationRow[];
    const update = this.db.prepare(`UPDATE evaluation_artifacts SET artifact_provenance = ?, json = ? WHERE artifact_id = ?`);
    for (const row of rows) {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(row.json) as Record<string, unknown>;
      } catch {
        this.db.prepare(`UPDATE evaluation_artifacts SET artifact_provenance = 'legacy-unclassified' WHERE artifact_id = ?`).run(row.id);
        continue;
      }
      const columnProvenance = isArtifactProvenance(row.provenance) ? row.provenance : "legacy-unclassified";
      const jsonProvenance = parsed.provenance;
      const provenance = jsonProvenance === undefined
        ? columnProvenance
        : isArtifactProvenance(jsonProvenance) && jsonProvenance === columnProvenance
          ? jsonProvenance
          : "legacy-unclassified";
      if (parsed.provenance !== provenance || row.provenance !== provenance) {
        update.run(provenance, stableStringify({ ...parsed, provenance } as never), row.id);
      }
    }
  }

  private upsertJson(table: string, keyColumns: Record<string, string | number>, json: unknown, createdAt?: string, definitionHash?: string, extraColumns: Record<string, string | number | undefined> = {}): void {
    const keys = Object.keys(keyColumns);
    const extras = Object.entries(extraColumns).filter(([, value]) => value !== undefined) as [string, string | number][];
    const columns = [...keys, ...extras.map(([key]) => key), "json", ...(definitionHash ? ["definition_hash"] : []), ...(createdAt ? ["created_at"] : []), "updated_at"];
    const placeholders = columns.map(() => "?").join(", ");
    const conflict = keys.join(", ");
    const updates = [
      ...extras.map(([key]) => `${key} = excluded.${key}`),
      "json = excluded.json",
      ...(definitionHash ? ["definition_hash = excluded.definition_hash"] : []),
      ...((createdAt ? ["created_at = excluded.created_at"] : []) as string[]),
      "updated_at = excluded.updated_at",
    ].join(", ");
    const values = [
      ...keys.map((key) => keyColumns[key]!),
      ...extras.map(([, value]) => value),
      stableStringify(json as never),
      ...(definitionHash ? [definitionHash] : []),
      ...(createdAt ? [createdAt] : []),
      this.now(),
    ];
    const where = keys.map((key) => `${key} = ?`).join(" AND ");
    const before = this.db.prepare(`SELECT json FROM ${table} WHERE ${where}`).get(...keys.map((key) => keyColumns[key]!)) as { json?: string } | undefined;
    this.db.prepare(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})
       ON CONFLICT (${conflict}) DO UPDATE SET ${updates}`,
    ).run(...values);
    const after = stableStringify(json as never);
    if (before?.json !== after) {
      const entityId = stableStringify(keyColumns as never);
      this.appendAuditEvent(table, entityId, before ? "updated" : "created", { json: after });
    }
  }

  private one<T>(sql: string, params: readonly (string | number)[]): T | undefined {
    const row = this.db.prepare(sql).get(...params) as JsonRow | undefined;
    if (!row) return undefined;
    return JSON.parse(row.json) as T;
  }

  private many<T>(sql: string, params: readonly (string | number)[]): readonly T[] {
    const rows = this.db.prepare(sql).all(...params) as unknown as JsonRow[];
    return rows.map((row) => JSON.parse(row.json) as T);
  }

  upsertProtocol(protocol: EvaluationProtocol): void {
    const existing = this.getProtocol(protocol.protocolId, protocol.version);
    if (existing && this.hashProtocol(existing) !== this.hashProtocol(protocol) && this.hasStartedTrialForProtocol(protocol.protocolId, protocol.version)) {
      throw new Error(`protocol ${protocol.protocolId}@${protocol.version} is immutable after trial start`);
    }
    this.upsertJson(
      "evaluation_protocols",
      { protocol_id: protocol.protocolId, version: protocol.version },
      protocol,
      protocol.createdAt,
      this.hashProtocol(protocol),
    );
    for (const variant of protocol.policyVariants) this.upsertPolicyVariant(variant);
  }

  upsertPolicyVariant(variant: PolicyVariant): void {
    const existing = this.getPolicyVariant(variant.policyId, variant.policyVersion);
    if (existing && stableStringify(existing as never) !== stableStringify(variant as never) && this.hasStartedTrialForPolicy(variant.policyId, variant.policyVersion)) {
      throw new Error(`policy variant ${variant.policyId}@${variant.policyVersion} is immutable after trial start`);
    }
    this.upsertJson(
      "policy_variants",
      { policy_id: variant.policyId, policy_version: variant.policyVersion },
      variant,
      variant.createdAt,
    );
  }

  upsertStudyPack(pack: StudyPack): void {
    const existing = this.getPack(pack.packId, pack.version);
    if (existing && this.hashPack(existing) !== this.hashPack(pack) && this.hasStartedTrialForPack(pack.packId, pack.version)) {
      throw new Error(`study pack ${pack.packId}@${pack.version} is immutable after trial start`);
    }
    this.upsertJson(
      "study_packs",
      { pack_id: pack.packId, version: pack.version },
      pack,
      pack.createdAt,
      this.hashPack(pack),
    );
  }

  upsertTrial(trial: LearningTrial, createdAt?: string): void {
    if (this.datasetKind !== "mixed" && trial.trialSubjectKind !== this.datasetKind && trial.trialSubjectKind !== "legacy-unclassified") {
      throw new Error(`evaluation store ${this.datasetKind} rejects ${trial.trialSubjectKind} trial`);
    }
    const existing = this.getTrial(trial.trialId);
    if (!isTrialSubjectKind(trial.trialSubjectKind)) throw new Error(`invalid trial subject kind ${String(trial.trialSubjectKind)}`);
    if (!existing && trial.trialSubjectKind === "legacy-unclassified") throw new Error("new trials cannot be legacy-unclassified");
    if (existing && existing.trialSubjectKind !== trial.trialSubjectKind) {
      throw new Error(`trial ${trial.trialId} subject kind is immutable`);
    }
    if (existing?.startedAt) {
      const immutableKeys: readonly (keyof LearningTrial)[] = [
        "trialSubjectKind", "participantId", "protocolId", "protocolVersion", "packId", "packVersion",
        "policyId", "policyVersion", "microtopicId", "matchedSetId", "assignmentSeed", "assignmentOrder", "phaseOrder",
      ];
      for (const key of immutableKeys) {
        if (stableStringify(existing[key] as never) !== stableStringify(trial[key] as never)) {
          throw new Error(`trial ${trial.trialId} immutable assignment field ${String(key)} changed after start`);
        }
      }
      if (existing.startedAt !== trial.startedAt || existing.retentionDueAt !== trial.retentionDueAt) {
        throw new Error(`trial ${trial.trialId} start snapshot is immutable`);
      }
    }
    this.upsertJson(
      "evaluation_trials",
      { trial_id: trial.trialId },
      trial,
      createdAt,
      undefined,
      {
        trial_subject_kind: trial.trialSubjectKind,
        protocol_id: trial.protocolId,
        protocol_version: trial.protocolVersion,
        pack_id: trial.packId,
        pack_version: trial.packVersion,
        participant_id: trial.participantId,
        policy_id: trial.policyId,
        policy_version: trial.policyVersion,
        microtopic_id: trial.microtopicId,
        matched_set_id: trial.matchedSetId,
        assignment_seed: trial.assignmentSeed,
        assignment_order: trial.assignmentOrder,
        started_at: trial.startedAt,
        ended_at: trial.endedAt,
        retention_due_at: trial.retentionDueAt,
        status: trial.status,
      },
    );
  }

  upsertCheckpoint(checkpoint: Checkpoint, createdAt?: string): void {
    const existing = this.getCheckpoint(checkpoint.checkpointId);
    if (existing) {
      const immutableKeys: readonly (keyof Checkpoint)[] = ["checkpointId", "attemptId", "trialId", "phase", "taskId", "formId", "presentedAt", "dueAt"];
      for (const key of immutableKeys) {
        if (key === "presentedAt" && existing.status === "not-yet-due" && checkpoint.status === "presented") continue;
        if (stableStringify(existing[key] as never) !== stableStringify(checkpoint[key] as never)) {
          throw new Error(`checkpoint ${checkpoint.checkpointId} immutable snapshot field ${String(key)} changed`);
        }
      }
      if (existing.assessedAt || existing.scorer) {
        for (const key of ["rubricResultVector", "scorer", "assessedAt"] as const) {
          if (stableStringify(existing[key] as never) !== stableStringify(checkpoint[key] as never)) {
            throw new Error(`checkpoint ${checkpoint.checkpointId} assessment is immutable`);
          }
        }
      }
    }
    this.upsertJson(
      "evaluation_checkpoints",
      { checkpoint_id: checkpoint.checkpointId },
      checkpoint,
      createdAt,
      undefined,
      {
        attempt_id: checkpoint.attemptId ?? checkpoint.checkpointId,
        trial_id: checkpoint.trialId,
        phase: checkpoint.phase,
        presented_at: checkpoint.presentedAt,
        assessed_at: checkpoint.assessedAt,
        due_at: checkpoint.dueAt,
        status: checkpoint.status,
      },
    );
  }

  upsertArtifact(artifact: LearnerArtifact, createdAt?: string): void {
    if (this.datasetKind === "human" && artifact.provenance !== "trusted-human" && artifact.provenance !== "legacy-unclassified") throw new Error(`human evaluation store rejects ${artifact.provenance} artifact`);
    if (this.datasetKind === "synthetic" && artifact.provenance === "trusted-human") throw new Error(`synthetic evaluation store rejects trusted-human artifact`);
    const existing = this.getArtifact(artifact.artifactId);
    if (!isArtifactProvenance(artifact.provenance)) throw new Error(`invalid artifact provenance ${String(artifact.provenance)}`);
    if (!existing && artifact.provenance === "legacy-unclassified") throw new Error("new artifacts cannot be legacy-unclassified");
    if (existing && existing.provenance !== artifact.provenance) {
      throw new Error(`artifact ${artifact.artifactId} provenance is immutable`);
    }
    if (existing && (existing.checkpointId !== artifact.checkpointId || existing.contentHash !== artifact.contentHash || existing.kind !== artifact.kind || existing.content !== artifact.content)) {
      throw new Error(`artifact ${artifact.artifactId} content is immutable`);
    }
    this.upsertJson(
      "evaluation_artifacts",
      { artifact_id: artifact.artifactId },
      artifact,
      createdAt,
      undefined,
      {
        artifact_provenance: artifact.provenance,
        checkpoint_id: artifact.checkpointId,
        content_hash: artifact.contentHash,
      },
    );
  }

  upsertObservation(observation: InterventionObservation, createdAt?: string): void {
    const existing = this.one<InterventionObservation>(`SELECT json FROM evaluation_observations WHERE observation_id = ?`, [observation.observationId]);
    if (existing && stableStringify(existing as never) !== stableStringify(observation as never)) throw new Error(`observation ${observation.observationId} is append-only`);
    this.upsertJson(
      "evaluation_observations",
      { observation_id: observation.observationId },
      observation,
      createdAt,
      undefined,
      {
        trial_id: observation.trialId,
        checkpoint_id: observation.checkpointId,
      },
    );
  }

  upsertIncident(incident: CriticalIncident, createdAt?: string): void {
    const existing = this.one<CriticalIncident>(`SELECT json FROM critical_incidents WHERE incident_id = ?`, [incident.incidentId]);
    if (existing && stableStringify(existing as never) !== stableStringify(incident as never)) throw new Error(`incident ${incident.incidentId} is append-only`);
    this.upsertJson(
      "critical_incidents",
      { incident_id: incident.incidentId },
      incident,
      createdAt,
      undefined,
      {
        trial_id: incident.trialId,
        checkpoint_id: incident.checkpointId,
        artifact_id: incident.artifactId,
        turn_id: incident.turnId,
        category: incident.category,
        learner_note: incident.learnerNote,
      },
    );
  }

  upsertFeedback(feedback: SubjectiveFeedback, createdAt?: string): void {
    const existing = this.one<SubjectiveFeedback>(`SELECT json FROM subjective_feedback WHERE feedback_id = ?`, [feedback.feedbackId]);
    if (existing && stableStringify(existing as never) !== stableStringify(feedback as never)) throw new Error(`feedback ${feedback.feedbackId} is append-only`);
    this.upsertJson(
      "subjective_feedback",
      { feedback_id: feedback.feedbackId },
      feedback,
      createdAt,
      undefined,
      {
        trial_id: feedback.trialId,
      },
    );
  }

  getProtocol(protocolId: string, version: number): EvaluationProtocol | undefined {
    return this.one<EvaluationProtocol>(
      `SELECT json FROM evaluation_protocols WHERE protocol_id = ? AND version = ?`,
      [protocolId, version],
    );
  }

  getPack(packId: string, version: number): StudyPack | undefined {
    return this.one<StudyPack>(
      `SELECT json FROM study_packs WHERE pack_id = ? AND version = ?`,
      [packId, version],
    );
  }

  getPolicyVariant(policyId: string, policyVersion: number): PolicyVariant | undefined {
    return this.one<PolicyVariant>(
      `SELECT json FROM policy_variants WHERE policy_id = ? AND policy_version = ?`,
      [policyId, policyVersion],
    );
  }

  private hasStartedTrialForProtocol(protocolId: string, version: number): boolean {
    return this.db.prepare(`SELECT 1 FROM evaluation_trials WHERE protocol_id = ? AND protocol_version = ? AND started_at IS NOT NULL LIMIT 1`).get(protocolId, version) !== undefined;
  }

  private hasStartedTrialForPack(packId: string, version: number): boolean {
    return this.db.prepare(`SELECT 1 FROM evaluation_trials WHERE pack_id = ? AND pack_version = ? AND started_at IS NOT NULL LIMIT 1`).get(packId, version) !== undefined;
  }

  private hasStartedTrialForPolicy(policyId: string, version: number): boolean {
    return this.db.prepare(`SELECT 1 FROM evaluation_trials WHERE policy_id = ? AND policy_version = ? AND started_at IS NOT NULL LIMIT 1`).get(policyId, version) !== undefined;
  }

  getTrial(trialId: string): LearningTrial | undefined {
    const row = this.db.prepare(`SELECT json, trial_subject_kind FROM evaluation_trials WHERE trial_id = ?`).get(trialId) as (JsonRow & { trial_subject_kind?: string }) | undefined;
    if (!row) return undefined;
    const trial = JSON.parse(row.json) as LearningTrial;
    if (trial.trialSubjectKind !== row.trial_subject_kind) throw new Error(`trial ${trialId} indexed/JSON integrity mismatch`);
    return trial;
  }

  private trialMany(sql: string, params: readonly (string | number)[]): readonly LearningTrial[] {
    const rows = this.db.prepare(sql).all(...params) as unknown as (JsonRow & { trial_subject_kind?: string })[];
    return rows.map((row) => {
      const trial = JSON.parse(row.json) as LearningTrial;
      if (trial.trialSubjectKind !== row.trial_subject_kind) throw new Error(`trial ${trial.trialId} indexed/JSON integrity mismatch`);
      return trial;
    });
  }

  listTrialsByParticipant(participantId: string): readonly LearningTrial[] {
    return this.trialMany(`SELECT json, trial_subject_kind FROM evaluation_trials WHERE participant_id = ? ORDER BY created_at, trial_id`, [participantId]);
  }

  listTrialsByProtocolPack(protocolId: string, protocolVersion: number, packId: string, packVersion: number, participantId?: string): readonly LearningTrial[] {
    if (participantId) {
      return this.trialMany(
        `SELECT json, trial_subject_kind FROM evaluation_trials WHERE protocol_id = ? AND protocol_version = ? AND pack_id = ? AND pack_version = ? AND participant_id = ? ORDER BY assignment_order, trial_id`,
        [protocolId, protocolVersion, packId, packVersion, participantId],
      );
    }
    return this.trialMany(
      `SELECT json, trial_subject_kind FROM evaluation_trials WHERE protocol_id = ? AND protocol_version = ? AND pack_id = ? AND pack_version = ? ORDER BY participant_id, assignment_order, trial_id`,
      [protocolId, protocolVersion, packId, packVersion],
    );
  }

  listTrialsByProtocolPackAndSubjectKind(protocolId: string, protocolVersion: number, packId: string, packVersion: number, trialSubjectKind: TrialSubjectKind, participantId?: string): readonly LearningTrial[] {
    if (participantId) {
      return this.trialMany(
        `SELECT json, trial_subject_kind FROM evaluation_trials
         WHERE protocol_id = ? AND protocol_version = ? AND pack_id = ? AND pack_version = ?
           AND participant_id = ? AND trial_subject_kind = ?
         ORDER BY assignment_order, trial_id`,
        [protocolId, protocolVersion, packId, packVersion, participantId, trialSubjectKind],
      );
    }
    return this.trialMany(
      `SELECT json, trial_subject_kind FROM evaluation_trials
       WHERE protocol_id = ? AND protocol_version = ? AND pack_id = ? AND pack_version = ?
         AND trial_subject_kind = ?
       ORDER BY participant_id, assignment_order, trial_id`,
      [protocolId, protocolVersion, packId, packVersion, trialSubjectKind],
    );
  }

  listTrials(): readonly LearningTrial[] {
    return this.trialMany(`SELECT json, trial_subject_kind FROM evaluation_trials ORDER BY created_at, trial_id`, []);
  }

  listCheckpointsByTrial(trialId: string): readonly Checkpoint[] {
    const rows = this.db.prepare(`SELECT json, attempt_id, trial_id, phase, presented_at, assessed_at, due_at, status FROM evaluation_checkpoints WHERE trial_id = ? ORDER BY presented_at, checkpoint_id`).all(trialId) as unknown as (JsonRow & { attempt_id?: string; trial_id?: string; phase?: string; presented_at?: string; assessed_at?: string; due_at?: string; status?: string })[];
    return rows.map((row) => this.parseCheckpointRow(row));
  }

  getCheckpoint(checkpointId: string): Checkpoint | undefined {
    const row = this.db.prepare(`SELECT json, attempt_id, trial_id, phase, presented_at, assessed_at, due_at, status FROM evaluation_checkpoints WHERE checkpoint_id = ?`).get(checkpointId) as (JsonRow & { attempt_id?: string; trial_id?: string; phase?: string; presented_at?: string; assessed_at?: string; due_at?: string; status?: string }) | undefined;
    return row ? this.parseCheckpointRow(row) : undefined;
  }

  private parseCheckpointRow(row: JsonRow & { readonly attempt_id?: string; readonly trial_id?: string; readonly phase?: string; readonly presented_at?: string; readonly assessed_at?: string; readonly due_at?: string; readonly status?: string }): Checkpoint {
    const checkpoint = JSON.parse(row.json) as Checkpoint;
    const expectedAttemptId = checkpoint.attemptId ?? checkpoint.checkpointId;
    if (expectedAttemptId !== (row.attempt_id ?? checkpoint.checkpointId)
      || checkpoint.trialId !== row.trial_id
      || checkpoint.phase !== row.phase
      || checkpoint.presentedAt !== row.presented_at
      || (checkpoint.assessedAt ?? null) !== (row.assessed_at ?? null)
      || (checkpoint.dueAt ?? null) !== (row.due_at ?? null)
      || checkpoint.status !== row.status) {
      throw new Error(`checkpoint ${checkpoint.checkpointId} indexed/JSON integrity mismatch`);
    }
    return checkpoint;
  }

  listArtifactsByTrial(trialId: string): readonly LearnerArtifact[] {
    const rows = this.db.prepare(
      `SELECT artifacts.json AS json, artifacts.artifact_provenance, artifacts.checkpoint_id, artifacts.content_hash
       FROM evaluation_artifacts AS artifacts
       JOIN evaluation_checkpoints AS checkpoints ON checkpoints.checkpoint_id = artifacts.checkpoint_id
       WHERE checkpoints.trial_id = ?
       ORDER BY artifacts.created_at, artifacts.artifact_id`,
    ).all(trialId) as unknown as (JsonRow & { artifact_provenance?: string; checkpoint_id?: string; content_hash?: string })[];
    return rows.map((row) => {
      const artifact = JSON.parse(row.json) as LearnerArtifact;
      if (artifact.provenance !== row.artifact_provenance || artifact.checkpointId !== row.checkpoint_id || artifact.contentHash !== row.content_hash) {
        throw new Error(`artifact ${artifact.artifactId} indexed/JSON integrity mismatch`);
      }
      return artifact;
    });
  }

  getArtifact(artifactId: string): LearnerArtifact | undefined {
    const row = this.db.prepare(`SELECT json, artifact_provenance, checkpoint_id, content_hash FROM evaluation_artifacts WHERE artifact_id = ?`).get(artifactId) as (JsonRow & { artifact_provenance?: string; checkpoint_id?: string; content_hash?: string }) | undefined;
    if (!row) return undefined;
    const artifact = JSON.parse(row.json) as LearnerArtifact;
    if (artifact.provenance !== row.artifact_provenance || artifact.checkpointId !== row.checkpoint_id || artifact.contentHash !== row.content_hash) {
      throw new Error(`artifact ${artifactId} indexed/JSON integrity mismatch`);
    }
    return artifact;
  }

  listObservationsByTrial(trialId: string): readonly InterventionObservation[] {
    return this.many<InterventionObservation>(`SELECT json FROM evaluation_observations WHERE trial_id = ? ORDER BY created_at, observation_id`, [trialId]);
  }

  listIncidentsByTrial(trialId: string): readonly CriticalIncident[] {
    return this.many<CriticalIncident>(`SELECT json FROM critical_incidents WHERE trial_id = ? ORDER BY created_at, incident_id`, [trialId]);
  }

  listFeedbackByTrial(trialId: string): readonly SubjectiveFeedback[] {
    return this.many<SubjectiveFeedback>(`SELECT json FROM subjective_feedback WHERE trial_id = ? ORDER BY created_at, feedback_id`, [trialId]);
  }

  hasProtocol(protocolId: string, version: number): boolean {
    return this.db.prepare(`SELECT 1 FROM evaluation_protocols WHERE protocol_id = ? AND version = ? LIMIT 1`).get(protocolId, version) !== undefined;
  }

  hasPack(packId: string, version: number): boolean {
    return this.db.prepare(`SELECT 1 FROM study_packs WHERE pack_id = ? AND version = ? LIMIT 1`).get(packId, version) !== undefined;
  }

  hashProtocol(protocol: EvaluationProtocol): string {
    return sha256Hex(stableStringify(protocol as never));
  }

  hashPack(pack: StudyPack): string {
    return sha256Hex(stableStringify(pack as never));
  }
}

/** Restore an encrypted local backup without overwriting an existing file. */
export function restoreEncryptedBackup(source: string, destination: string, passphrase: string): void {
  if (!source || !destination || source === destination) throw new Error("source and destination must be distinct file paths");
  if (typeof passphrase !== "string" || passphrase.length < 12) throw new Error("encrypted backup passphrase must be at least 12 characters");
  if (existsSync(destination)) throw new Error(`restore destination already exists: ${destination}`);
  const envelope = JSON.parse(readFileSync(source, "utf8")) as Partial<EncryptedBackupEnvelope>;
  if (envelope.magic !== "AI-STUDY-ENGINE-ENCRYPTED-BACKUP-V1" || envelope.kdf !== "scrypt" || envelope.cipher !== "aes-256-gcm") {
    throw new Error("unsupported encrypted evaluation backup format");
  }
  if (!envelope.salt || !envelope.iv || !envelope.tag || !envelope.ciphertext) throw new Error("encrypted evaluation backup is incomplete");
  try {
    const key = scryptSync(passphrase, Buffer.from(envelope.salt, "base64"), 32);
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, plaintext, { flag: "wx", mode: 0o600 });
    chmodSync(destination, 0o600);
  } catch (error) {
    throw new Error(`encrypted evaluation backup could not be restored: ${error instanceof Error ? error.message : String(error)}`);
  }
}
