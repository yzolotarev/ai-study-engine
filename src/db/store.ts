import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { assertProvenance, type Provenance } from "../core/provenance.js";
import { evaluateTransition } from "../core/state-machine.js";
import type { ConditionTrace, SinceAnchor } from "../core/policy/condition.js";
import {
  CORE_INTERVENTION_TEMPLATES,
  CORE_PARAMETERS,
  CORE_POLICIES,
  CORE_POLICY_BUNDLE,
} from "../core/policy/core-policies.js";
import type { CompiledRegistry } from "../core/policy/registry-compiler.js";
import { applyMigrations } from "./migrations.js";
import type { StudyState, TransitionEvidence } from "../core/types.js";
import {
  isHelpLevelContaminating,
  type ContaminationScope,
  type ContaminationStatus,
  type HelpLevel,
  type OperationAuthor,
  type OperationKind,
} from "../core/provenance-operations.js";

export interface CreateObjectiveInput {
  userId: string;
  title: string;
  observableOutcome: string;
  targetTask: string;
  assessmentFormat: string;
  stakes: "low" | "normal" | "high" | "competitive";
  targetBloom?: 1 | 2 | 3 | 4 | 5 | 6;
  targetSolo?: "unistructural" | "multistructural" | "relational" | "extended_abstract";
  provenance: Provenance;
}

export interface StudySessionView {
  id: string;
  userId: string;
  objectiveId: string;
  objectiveTitle: string;
  observableOutcome: string;
  targetTask: string;
  assessmentFormat: string;
  piSessionId?: string;
  attemptBranchId: string;
  currentState: StudyState;
  stateVersion: number;
  restartPoint?: unknown;
  startedAt: string;
  endedAt?: string;
}

interface SessionRow {
  id: string;
  user_id: string;
  objective_id: string;
  title: string;
  observable_outcome: string;
  target_task: string;
  assessment_format: string;
  pi_session_id: string | null;
  attempt_branch_id: string;
  current_state: StudyState;
  state_version: number;
  restart_point_json: string | null;
  started_at: string;
  ended_at: string | null;
}

function now(): string {
  return new Date().toISOString();
}

function parseSession(row: SessionRow): StudySessionView {
  const result: StudySessionView = {
    id: row.id,
    userId: row.user_id,
    objectiveId: row.objective_id,
    objectiveTitle: row.title,
    observableOutcome: row.observable_outcome,
    targetTask: row.target_task,
    assessmentFormat: row.assessment_format,
    attemptBranchId: row.attempt_branch_id,
    currentState: row.current_state,
    stateVersion: row.state_version,
    startedAt: row.started_at,
  };
  if (row.pi_session_id !== null) result.piSessionId = row.pi_session_id;
  if (row.restart_point_json !== null) result.restartPoint = JSON.parse(row.restart_point_json);
  if (row.ended_at !== null) result.endedAt = row.ended_at;
  return result;
}

export class StudyStore {
  readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    applyMigrations(this.db);
    this.ensureCorePolicies();
  }

  private hashJson(value: unknown): string {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
  }

  private ensureCorePolicies(): void {
    for (const template of CORE_INTERVENTION_TEMPLATES) {
      this.db
        .prepare(
          `INSERT OR IGNORE INTO intervention_templates(
             template_id, version, name, kind, content_json, provenance_json,
             definition_hash, status, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
        )
        .run(
          template.id,
          template.version,
          template.name,
          template.kind,
          JSON.stringify(template.content),
          JSON.stringify(template.provenance),
          this.hashJson({ id: template.id, version: template.version, name: template.name, kind: template.kind, content: template.content }),
          now(),
        );
    }
    for (const parameter of CORE_PARAMETERS) {
      this.db
        .prepare(
          `INSERT OR IGNORE INTO policy_parameters(
             parameter_id, version, name, value_json, scope_json, provenance_json,
             definition_hash, status, valid_from, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          parameter.parameterId,
          parameter.version,
          parameter.name,
          JSON.stringify(parameter.value),
          JSON.stringify(parameter.scope),
          JSON.stringify(parameter.provenance),
          this.hashJson({ id: parameter.parameterId, version: parameter.version, name: parameter.name, value: parameter.value }),
          parameter.status,
          now(),
          now(),
        );
    }
    for (const policy of CORE_POLICIES) {
      const template = CORE_INTERVENTION_TEMPLATES.find(
        (candidate) => candidate.id === policy.interventionTemplateId && candidate.version === policy.interventionTemplateVersion,
      );
      if (!template) throw new Error(`Missing core intervention template ${policy.interventionTemplateId}@${policy.interventionTemplateVersion}`);
      this.db
        .prepare(
          `INSERT OR IGNORE INTO policy_definitions(
             policy_id, version, name, scope_json, condition_json, exclusions_json,
             priority, severity, cooldown_ms, intervention_template_id,
             intervention_template_version, provenance_json, definition_hash,
             status, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          policy.policyId,
          policy.version,
          policy.name,
          JSON.stringify(policy.scope),
          JSON.stringify(policy.condition),
          JSON.stringify(policy.exclusions),
          policy.priority,
          policy.severity,
          policy.cooldownMs,
          policy.interventionTemplateId,
          policy.interventionTemplateVersion,
          JSON.stringify(policy.provenance),
          this.hashJson({
            id: policy.policyId,
            version: policy.version,
            name: policy.name,
            scope: policy.scope,
            condition: policy.condition,
            exclusions: policy.exclusions,
            priority: policy.priority,
            severity: policy.severity,
            cooldownMs: policy.cooldownMs,
            template: policy.interventionTemplateId,
          }),
          policy.status,
          now(),
        );
    }
    const memberHashes = CORE_POLICIES.map((policy) => `${policy.policyId}@${policy.version}`).sort();
    const bundleHash = this.hashJson({
      id: CORE_POLICY_BUNDLE.id,
      version: CORE_POLICY_BUNDLE.version,
      name: CORE_POLICY_BUNDLE.name,
      members: memberHashes,
    });
    this.db
      .prepare(
        `INSERT OR IGNORE INTO policy_bundles(
           bundle_id, version, name, definition_hash, status, created_at
         ) VALUES (?, ?, ?, ?, 'active', ?)`,
      )
      .run(CORE_POLICY_BUNDLE.id, CORE_POLICY_BUNDLE.version, CORE_POLICY_BUNDLE.name, bundleHash, now());
    for (const policy of CORE_POLICIES) {
      this.db
        .prepare(
          `INSERT OR IGNORE INTO policy_bundle_members(
             bundle_id, bundle_version, policy_id, policy_version
           ) VALUES (?, ?, ?, ?)`,
        )
        .run(CORE_POLICY_BUNDLE.id, CORE_POLICY_BUNDLE.version, policy.policyId, policy.version);
    }
  }

  /**
   * Deploy a compiled registry bundle (interventions, policies, bundle, members).
   * Human-reviewed gate: called explicitly, never during normal session flow.
   * Intervention seeds use status 'experimental'; the DB only permits
   * draft/active/retired for intervention_templates, so 'experimental' is
   * coerced to 'draft' (not auto-active).
   */
  deployRegistryBundle(compiled: CompiledRegistry): { bundleId: string; bundleVersion: number } {
    for (const t of compiled.interventions) {
      this.db
        .prepare(
          `INSERT OR IGNORE INTO intervention_templates(
             template_id, version, name, kind, content_json, provenance_json, definition_hash, status, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          t.id,
          t.version,
          t.name,
          t.kind,
          JSON.stringify(t.content),
          JSON.stringify(t.provenance),
          this.hashJson({ id: t.id, version: t.version, name: t.name, kind: t.kind, content: t.content }),
          t.status === "experimental" ? "draft" : t.status,
          now(),
        );
    }
    for (const p of compiled.policies) {
      this.db
        .prepare(
          `INSERT OR IGNORE INTO policy_definitions(
             policy_id, version, name, scope_json, condition_json, exclusions_json,
             priority, severity, cooldown_ms, intervention_template_id,
             intervention_template_version, provenance_json, definition_hash, status, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          p.policyId,
          p.version,
          p.name,
          JSON.stringify(p.scope),
          JSON.stringify(p.condition),
          JSON.stringify(p.exclusions),
          p.priority,
          p.severity,
          p.cooldownMs,
          p.interventionTemplateId,
          p.interventionTemplateVersion,
          JSON.stringify(p.provenance),
          this.hashJson({ id: p.policyId, version: p.version, condition: p.condition }),
          p.status,
          now(),
        );
    }
    const { bundleId, bundleVersion, name } = compiled.bundle;
    this.db
      .prepare(
        `INSERT OR IGNORE INTO policy_bundles(bundle_id, version, name, definition_hash, status, created_at)
         VALUES (?, ?, ?, ?, 'active', ?)`,
      )
      .run(bundleId, bundleVersion, name, this.hashJson(compiled.bundle), now());
    for (const p of compiled.policies) {
      this.db
        .prepare(
          `INSERT OR IGNORE INTO policy_bundle_members(bundle_id, bundle_version, policy_id, policy_version)
           VALUES (?, ?, ?, ?)`,
        )
        .run(bundleId, bundleVersion, p.policyId, p.version);
    }
    return { bundleId, bundleVersion };
  }

  /** Switch a session's active policy bundle. Used by the reviewed registry-deploy flow. */
  activateBundle(sessionId: string, bundleId: string, bundleVersion: number): void {
    this.db
      .prepare(
        `UPDATE policy_activations SET bundle_id = ?, bundle_version = ?, activated_at = ? WHERE study_session_id = ?`,
      )
      .run(bundleId, bundleVersion, now(), sessionId);
  }

  /**
   * Record an external sensory-tool event (Variant A of the event-reporting
   * integration). The engine is the *consumer*; the external script only calls
   * this. Persists to the normalized `study_events` table as event_type
   * 'sensory_input' so the existing policy anchor `last_sensory_input` and the
   * `event_count(..., sinceAnchor)` machinery pick it up without new tables.
   *
   * payload subtyping follows the integration contract:
   *   subtype: identify_key_terms | familiarity_scaffold | neighborhood_expansion
   *   payload: { source_text_length:number, result_length:number, nucleus?:string|null }
   */
  recordSensoryEvent(input: {
    learnerId: string;
    studySessionId?: string | null;
    subtype: string;
    payload: { sourceTextLength: number; resultLength: number; nucleus?: string | null };
    occurredAt?: string;
  }): string {
    this.ensureUser(input.learnerId);
    const branchId = this.getSession(input.studySessionId ?? "")?.attemptBranchId ?? randomUUID();
    const ts = input.occurredAt ?? now();
    return this.appendEvent({
      userId: input.learnerId,
      ...(input.studySessionId ? { studySessionId: input.studySessionId } : {}),
      attemptBranchId: branchId,
      type: "sensory_input",
      payload: {
        subtype: input.subtype,
        source_text_length: input.payload.sourceTextLength,
        result_length: input.payload.resultLength,
        ...(input.payload.nucleus !== undefined && input.payload.nucleus !== null
          ? { nucleus: input.payload.nucleus }
          : {}),
        occurred_at: ts,
      },
      actor: "ai",
      provenance: { kind: "PRODUCT_DECISION", sourceIds: [], policyVersion: "v1" },
      ...(input.occurredAt ? { occurredAt: ts } : {}),
    });
  }

  /**
   * Apply the contamination side-effect of a sensory event on a target, per the
   * integration contract:
   *   neighborhood_expansion -> status 'contaminated',   help_level 'content_cue'
   *   familiarity_scaffold    -> status 'familiarity_only'
   *   identify_key_terms      -> no contamination change
   *
   * NOTE: the contract's literal 'contaminated_open' status does not exist in
   * CONTAMINATION_STATUSES; we use the real valid 'contaminated' (which the
   * existing deriveRegistryFacts maps to the `ai_contaminated_artifact_saved`
   * fact). The event is standalone, so contaminating_operation_id is NULL and the
   * link back to the triggering event is kept in opened_by_event_id.
   */
  openSensoryContamination(input: {
    learnerId: string;
    studySessionId?: string | null;
    targetId: string;
    subtype: "identify_key_terms" | "familiarity_scaffold" | "neighborhood_expansion";
    eventId: string;
  }): string | undefined {
    let status: ContaminationStatus | undefined;
    let helpLevel: HelpLevel | undefined;
    if (input.subtype === "neighborhood_expansion") {
      status = "contaminated";
      helpLevel = "content_cue";
    } else if (input.subtype === "familiarity_scaffold") {
      status = "familiarity_only";
      helpLevel = "familiarity";
    } else {
      return undefined;
    }
    const recordId = randomUUID();
    const timestamp = now();
    this.db
      .prepare(
        `INSERT INTO contamination_records(
           record_id, learner_id, study_session_id, target_id, scope,
           status, contaminating_help_level, contaminating_operation_id,
           opened_at, opened_by_event_id
         ) VALUES (?, ?, ?, ?, 'target', ?, ?, NULL, ?, ?)`,
      )
      .run(
        recordId,
        input.learnerId,
        input.studySessionId ?? null,
        input.targetId,
        status,
        helpLevel,
        timestamp,
        input.eventId,
      );
    return recordId;
  }

  close(): void {
    this.db.close();
  }

  ensureUser(id: string, locale = "ru-RU", timezone = "UTC", displayName?: string): void {
    const timestamp = now();
    this.db
      .prepare(
        `INSERT INTO users(id, display_name, locale, timezone, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           display_name = COALESCE(excluded.display_name, users.display_name),
           locale = excluded.locale,
           timezone = excluded.timezone,
           updated_at = excluded.updated_at`,
      )
      .run(id, displayName ?? null, locale, timezone, timestamp, timestamp);
  }

  createObjective(input: CreateObjectiveInput): string {
    assertProvenance(input.provenance);
    const id = randomUUID();
    const timestamp = now();
    this.db
      .prepare(
        `INSERT INTO objectives(
           id, user_id, title, observable_outcome, target_task, assessment_format,
           stakes, target_bloom, target_solo, status, provenance_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
      )
      .run(
        id,
        input.userId,
        input.title,
        input.observableOutcome,
        input.targetTask,
        input.assessmentFormat,
        input.stakes,
        input.targetBloom ?? 3,
        input.targetSolo ?? "relational",
        JSON.stringify(input.provenance),
        timestamp,
        timestamp,
      );
    return id;
  }

  createSession(userId: string, objectiveId: string, piSessionId?: string): StudySessionView {
    const id = randomUUID();
    const branchId = randomUUID();
    const timestamp = now();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          `INSERT INTO study_sessions(
             id, user_id, objective_id, pi_session_id, attempt_branch_id,
             current_state, state_version, started_at
           ) VALUES (?, ?, ?, ?, ?, 'OUTCOME', 0, ?)`,
        )
        .run(id, userId, objectiveId, piSessionId ?? null, branchId, timestamp);

      const creationEventId = this.appendEvent({
        userId,
        studySessionId: id,
        attemptBranchId: branchId,
        type: "study_session_created",
        payload: { objectiveId, state: "OUTCOME" },
        actor: "engine",
        provenance: { kind: "PRODUCT_DECISION", sourceIds: [], policyVersion: "v1" },
      });
      this.db
        .prepare(
          `INSERT INTO policy_activations(
             activation_id, study_session_id, bundle_id, bundle_version,
             activated_at, activated_by_event_id
           ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          id,
          CORE_POLICY_BUNDLE.id,
          CORE_POLICY_BUNDLE.version,
          timestamp,
          creationEventId,
        );      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }

    const created = this.getSession(id);
    if (!created) throw new Error("Failed to load newly created study session");
    return created;
  }

  getSession(id: string): StudySessionView | undefined {
    const row = this.db
      .prepare(
        `SELECT s.*, o.title, o.observable_outcome, o.target_task, o.assessment_format
         FROM study_sessions s JOIN objectives o ON o.id = s.objective_id
         WHERE s.id = ?`,
      )
      .get(id) as unknown as SessionRow | undefined;
    return row ? parseSession(row) : undefined;
  }

  getActiveSession(piSessionId: string): StudySessionView | undefined {
    const row = this.db
      .prepare(
        `SELECT s.*, o.title, o.observable_outcome, o.target_task, o.assessment_format
         FROM study_sessions s JOIN objectives o ON o.id = s.objective_id
         WHERE s.pi_session_id = ? AND s.ended_at IS NULL
         ORDER BY s.started_at DESC LIMIT 1`,
      )
      .get(piSessionId) as unknown as SessionRow | undefined;
    return row ? parseSession(row) : undefined;
  }

  /** Most recently created session, regardless of status. Used by external
   *  sensory tools to bind a reported event to the learner's active study. */
  getLastSession(): StudySessionView | undefined {
    const row = this.db
      .prepare(
        `SELECT s.*, o.title, o.observable_outcome, o.target_task, o.assessment_format
         FROM study_sessions s JOIN objectives o ON o.id = s.objective_id
         ORDER BY s.started_at DESC LIMIT 1`,
      )
      .get() as unknown as SessionRow | undefined;
    return row ? parseSession(row) : undefined;
  }

  transition(input: {
    sessionId: string;
    expectedVersion: number;
    to: StudyState;
    evidence: TransitionEvidence;
    actor: "user" | "engine" | "ai" | "human_reviewer";
    provenance: Provenance;
    note?: string;
  }): StudySessionView {
    assertProvenance(input.provenance);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.getSession(input.sessionId);
      if (!current) throw new Error(`Unknown study session: ${input.sessionId}`);
      if (current.stateVersion !== input.expectedVersion) {
        throw new Error(`State version conflict: expected ${input.expectedVersion}, found ${current.stateVersion}`);
      }
      const decision = evaluateTransition({ from: current.currentState, to: input.to, evidence: input.evidence });
      if (!decision.allowed) throw new Error(decision.reasons.join("; "));

      const result = this.db
        .prepare(
          `UPDATE study_sessions
           SET current_state = ?, state_version = state_version + 1
           WHERE id = ? AND state_version = ?`,
        )
        .run(input.to, input.sessionId, input.expectedVersion);
      if (Number(result.changes) !== 1) throw new Error("Concurrent state update detected");

      this.appendEvent({
        userId: current.userId,
        studySessionId: current.id,
        attemptBranchId: current.attemptBranchId,
        type: "study_state_transitioned",
        payload: {
          from: current.currentState,
          to: input.to,
          evidence: input.evidence,
          note: input.note ?? null,
        },
        actor: input.actor,
        provenance: input.provenance,
      });
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }

    const updated = this.getSession(input.sessionId);
    if (!updated) throw new Error("Session disappeared after transition");
    return updated;
  }

  appendEvent(input: {
    userId: string;
    studySessionId?: string;
    attemptBranchId: string;
    parentEventId?: string;
    type: string;
    payload: unknown;
    actor: "user" | "engine" | "ai" | "human_reviewer";
    provenance: Provenance;
    occurredAt?: string;
  }): string {
    assertProvenance(input.provenance);
    const id = randomUUID();
    const timestamp = input.occurredAt ?? now();
    const payloadJson = JSON.stringify(input.payload);
    const provenanceJson = JSON.stringify(input.provenance);
    const payloadHash = createHash("sha256").update(payloadJson).digest("hex");

    // SAVEPOINT is valid both standalone and inside transition(), preserving
    // atomic dual-write while the legacy event table remains in service.
    this.db.exec("SAVEPOINT append_study_event");
    try {
      this.db
        .prepare(
          `INSERT INTO domain_events(
             id, user_id, study_session_id, attempt_branch_id, parent_event_id,
             event_type, schema_version, payload_json, actor, provenance_json, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.userId,
          input.studySessionId ?? null,
          input.attemptBranchId,
          input.parentEventId ?? null,
          input.type,
          payloadJson,
          input.actor,
          provenanceJson,
          timestamp,
        );
      this.db
        .prepare(
          `INSERT INTO study_events(
             event_id, learner_id, study_session_id, event_type, schema_version,
             payload_json, payload_hash, integrity_status, actor, provenance_json,
             occurred_at, recorded_at, causation_event_id, correlation_id,
             legacy_domain_event_id
           ) VALUES (?, ?, ?, ?, 1, ?, ?, 'verified', ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.userId,
          input.studySessionId ?? null,
          input.type,
          payloadJson,
          payloadHash,
          input.actor,
          provenanceJson,
          timestamp,
          timestamp,
          input.parentEventId ?? null,
          input.attemptBranchId,
          id,
        );
      this.db.exec("RELEASE SAVEPOINT append_study_event");
      return id;
    } catch (error) {
      this.db.exec("ROLLBACK TO SAVEPOINT append_study_event");
      this.db.exec("RELEASE SAVEPOINT append_study_event");
      throw error;
    }
  }

  countEvents(sessionId: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS count FROM domain_events WHERE study_session_id = ?")
      .get(sessionId) as unknown as { count: number };
    return Number(row.count);
  }

  countStudyEvents(sessionId: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS count FROM study_events WHERE study_session_id = ?")
      .get(sessionId) as unknown as { count: number };
    return Number(row.count);
  }

  getPinnedPolicyBundle(sessionId: string): { bundleId: string; bundleVersion: number } | undefined {
    const activation = this.getPolicyActivation(sessionId);
    if (!activation) return undefined;
    return { bundleId: activation.bundleId, bundleVersion: activation.bundleVersion };
  }

  getPolicyActivation(sessionId: string): { activationId: string; bundleId: string; bundleVersion: number } | undefined {
    const row = this.db
      .prepare(`SELECT activation_id, bundle_id, bundle_version FROM policy_activations WHERE study_session_id = ?`)
      .get(sessionId) as unknown as { activation_id: string; bundle_id: string; bundle_version: number } | undefined;
    return row ? { activationId: row.activation_id, bundleId: row.bundle_id, bundleVersion: row.bundle_version } : undefined;
  }

  listBundlePolicies(bundleId: string, bundleVersion: number): Array<{ policyId: string; policyVersion: number }> {
    const rows = this.db
      .prepare(`SELECT policy_id, policy_version FROM policy_bundle_members WHERE bundle_id = ? AND bundle_version = ?`)
      .all(bundleId, bundleVersion) as unknown as Array<{ policy_id: string; policy_version: number }>;
    return rows.map((row) => ({ policyId: row.policy_id, policyVersion: row.policy_version }));
  }

  policyDefinition(policyId: string, policyVersion: number): {
      policyId: string;
      version: number;
      name: string;
      scopeJson: string;
      conditionJson: string;
      exclusionsJson: string;
      priority: number;
      severity: number;
      cooldownMs: number | null;
      status: string;
      interventionTemplateId: string;
      interventionTemplateVersion: number;
      interventionKind: string;
      provenanceJson: string;
    } | undefined {
    const row = this.db
      .prepare(
        `SELECT p.policy_id, p.version, p.name, p.scope_json, p.condition_json, p.exclusions_json,
                p.priority, p.severity, p.cooldown_ms, p.status,
                p.intervention_template_id, p.intervention_template_version, t.kind AS intervention_kind,
                p.provenance_json
         FROM policy_definitions p
         JOIN intervention_templates t ON t.template_id = p.intervention_template_id
           AND t.version = p.intervention_template_version
         WHERE p.policy_id = ? AND p.version = ?`,
      )
      .get(policyId, policyVersion) as unknown as
        | {
            policy_id: string;
            version: number;
            name: string;
            scope_json: string;
            condition_json: string;
            exclusions_json: string;
            priority: number;
            severity: number;
            cooldown_ms: number | null;
            status: string;
            intervention_template_id: string;
            intervention_template_version: number;
            intervention_kind: string;
            provenance_json: string;
          }
        | undefined;
    return row
      ? {
          policyId: row.policy_id,
          version: row.version,
          name: row.name,
          scopeJson: JSON.parse(row.scope_json),
          conditionJson: JSON.parse(row.condition_json),
          exclusionsJson: JSON.parse(row.exclusions_json),
          priority: row.priority,
          severity: row.severity,
          cooldownMs: row.cooldown_ms,
          status: row.status,
          interventionTemplateId: row.intervention_template_id,
          interventionTemplateVersion: row.intervention_template_version,
          interventionKind: row.intervention_kind,
          provenanceJson: row.provenance_json,
        }
      : undefined;
  }

  policyParameterValue(parameterId: string): unknown | undefined {
    const row = this.db
      .prepare(`SELECT value_json FROM policy_parameters WHERE parameter_id = ? AND status != 'disabled' ORDER BY version DESC LIMIT 1`)
      .get(parameterId) as unknown as { value_json: string } | undefined;
    if (!row) return undefined;
    try { return JSON.parse(row.value_json); } catch { return undefined; }
  }

  countStudyEventsByType({
    learnerId,
    eventType,
    windowMs,
    targetId,
  }: {
    learnerId: string;
    eventType: string;
    windowMs?: number;
    targetId?: string | null;
  }): number {
    const cutoff = windowMs !== undefined ? new Date(Date.now() - windowMs).toISOString() : null;
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM study_events
         WHERE learner_id = ? AND event_type = ?
           AND (? IS NULL OR target_id = ?)
           AND (? IS NULL OR occurred_at >= ?)`,
      )
      .get(learnerId, eventType, targetId ?? null, targetId ?? null, cutoff ?? null, cutoff ?? null) as unknown as { count: number };
    return Number(row.count);
  }

  /**
   * Resolve a fixed temporal anchor to an epoch-ms timestamp, or null if absent.
   * The evaluator treats null as "no data" (-> uncertain), never as false.
   */
  findAnchorTimestamp(learnerId: string, sessionId: string, anchor: SinceAnchor): number | null {
    let ts: string | null | undefined;
    if (anchor === "last_independent_attempt") {
      ts = (
        this.db
          .prepare(
            `SELECT MAX(occurred_at) AS ts FROM study_events WHERE learner_id = ? AND study_session_id = ? AND event_type = 'independent_attempt'`,
          )
          .get(learnerId, sessionId) as unknown as { ts: string | null } | undefined
      )?.ts;
    } else if (anchor === "last_sensory_input") {
      ts = (
        this.db
          .prepare(
            `SELECT MAX(occurred_at) AS ts FROM study_events WHERE learner_id = ? AND study_session_id = ? AND event_type = 'sensory_input'`,
          )
          .get(learnerId, sessionId) as unknown as { ts: string | null } | undefined
      )?.ts;
    } else if (anchor === "last_contamination_event") {
      // NOTE: the fixed signature has no targetId, so this resolves per learner+session, not per target.
      ts = (
        this.db
          .prepare(
            `SELECT MAX(opened_at) AS ts FROM contamination_records WHERE learner_id = ? AND study_session_id = ? AND status = 'contaminated'`,
          )
          .get(learnerId, sessionId) as unknown as { ts: string | null } | undefined
      )?.ts;
    } else {
      // phase_start: phase-transition events are not emitted yet, so this returns null.
      ts = (
        this.db
          .prepare(
            `SELECT MAX(occurred_at) AS ts FROM study_events WHERE learner_id = ? AND study_session_id = ? AND event_type = 'phase_transition'`,
          )
          .get(learnerId, sessionId) as unknown as { ts: string | null } | undefined
      )?.ts;
    }
    return ts ? Date.parse(ts) : null;
  }

  /** Count study_events of a type at/after an anchor timestamp (epoch ms) up to now. */
  countStudyEventsByTypeSince({
    learnerId,
    eventType,
    anchorTs,
    targetId,
  }: {
    learnerId: string;
    eventType: string;
    anchorTs: number;
    targetId?: string | null;
  }): number {
    const anchorIso = new Date(anchorTs).toISOString();
    const nowIso = now();
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM study_events
         WHERE learner_id = ? AND event_type = ?
           AND (? IS NULL OR target_id = ?)
           AND occurred_at >= ? AND occurred_at <= ?`,
      )
      .get(learnerId, eventType, targetId ?? null, targetId ?? null, anchorIso, nowIso) as unknown as { count: number };
    return Number(row.count);
  }

  cooldownActive(sessionId: string, policyId: string, cooldownMs: number | null): boolean {
    if (cooldownMs === null || cooldownMs <= 0) return false;
    const cutoff = new Date(Date.now() - cooldownMs).toISOString();
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM policy_interventions i
         JOIN policy_detections d ON d.detection_id = i.detection_id
         JOIN policy_activations a ON a.activation_id = d.activation_id
         WHERE a.study_session_id = ? AND d.policy_id = ?
           AND i.status != 'suppressed' AND i.selected_at >= ?`,
      )
      .get(sessionId, policyId, cutoff) as unknown as { count: number };
    return Number(row.count) > 0;
  }

  persistDetection({
    activationId,
    policyId,
    policyVersion,
    learnerId,
    targetId,
    evaluatedAt,
    result,
    confidence,
    trace,
    triggeringEventId,
  }: {
    activationId: string;
    policyId: string;
    policyVersion: number;
    learnerId: string;
    targetId?: string | null;
    evaluatedAt: string;
    result: string;
    confidence: number;
    trace: unknown;
    triggeringEventId?: string | null;
  }): string {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO policy_detections(
           detection_id, activation_id, policy_id, policy_version,
           learner_id, target_id, evaluated_at, result, confidence,
           explanation_trace_json, triggering_event_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        activationId,
        policyId,
        policyVersion,
        learnerId,
        targetId ?? null,
        evaluatedAt,
        result,
        confidence,
        JSON.stringify(trace),
        triggeringEventId ?? null,
      );
    return id;
  }

  persistIntervention({
    detectionId,
    templateId,
    templateVersion,
    resolutionTrace,
    budgetCost = 1,
  }: {
    detectionId: string;
    templateId: string;
    templateVersion: number;
    resolutionTrace: unknown;
    budgetCost?: number;
  }): string {
    const id = randomUUID();
    const timestamp = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO policy_interventions(
           intervention_id, detection_id, template_id, template_version,
           selected_at, budget_cost, status, resolution_trace_json
         ) VALUES (?, ?, ?, ?, ?, ?, 'shown', ?)`,
      )
      .run(id, detectionId, templateId, templateVersion, timestamp, budgetCost, JSON.stringify(resolutionTrace));
    return id;
  }

  recordOperation(input: {
    sessionId: string;
    targetId?: string;
    operation: OperationKind;
    author: OperationAuthor;
    helpLevel: HelpLevel;
    answerVisible?: boolean;
    cueVaried?: boolean;
    attemptIndependent?: boolean;
    contaminationScope?: ContaminationScope;
    evidenceId?: string;
    confidence?: string;
    status?: string;
    artifactJson?: string;
    occurredAt?: string;
    causationEventId?: string;
  }): string {
    const operationId = randomUUID();
    const timestamp = input.occurredAt ?? now();
    this.db
      .prepare(
        `INSERT INTO operation_attempts(
           operation_id, study_session_id, learner_id, target_id, operation,
           author, help_level, answer_visible, cue_varied, attempt_independent,
           contamination_scope, evidence_id, confidence, status, artifact_json,
           occurred_at, recorded_at, causation_event_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        operationId,
        input.sessionId,
        this.getSession(input.sessionId)?.userId ?? "",
        input.targetId ?? null,
        input.operation,
        input.author,
        input.helpLevel,
        input.answerVisible ? 1 : 0,
        input.cueVaried ? 1 : 0,
        input.attemptIndependent ? 1 : 0,
        input.contaminationScope ?? null,
        input.evidenceId ?? null,
        input.confidence ?? "uncertain",
        input.status ?? "unknown",
        input.artifactJson ?? null,
        timestamp,
        now(),
        input.causationEventId ?? null,
      );

    if (isHelpLevelContaminating(input.helpLevel) && input.targetId) {
      const recordId = randomUUID();
      this.db
        .prepare(
          `INSERT INTO contamination_records(
             record_id, learner_id, study_session_id, target_id, scope,
             status, contaminating_help_level, contaminating_operation_id,
             opened_at, opened_by_event_id
           ) VALUES (?, ?, ?, ?, ?, 'contaminated', ?, ?, ?, ?)`,
        )
        .run(
          recordId,
          this.getSession(input.sessionId)?.userId ?? "",
          input.sessionId,
          input.targetId,
          input.contaminationScope ?? "target",
          input.helpLevel,
          operationId,
          timestamp,
          input.causationEventId ?? null,
        );
    }

    return operationId;
  }

  getContaminationStatus(targetId: string, scope?: ContaminationScope): {
    recordId: string;
    status: ContaminationStatus;
    helpLevel: HelpLevel;
    openedAt: string;
    closureMethod?: string;
  } | undefined {
    const row = this.db
      .prepare(
        `SELECT record_id, status, contaminating_help_level, opened_at, closure_method
         FROM contamination_records
         WHERE target_id = ? AND (? IS NULL OR scope = ?)
         ORDER BY opened_at DESC LIMIT 1`,
      )
      .get(targetId, scope ?? null, scope ?? null) as unknown as
      | { record_id: string; status: string; contaminating_help_level: string; opened_at: string; closure_method: string | null }
      | undefined;
    if (!row) return undefined;
    const out: {
      recordId: string;
      status: ContaminationStatus;
      helpLevel: HelpLevel;
      openedAt: string;
      closureMethod?: string;
    } = {
      recordId: row.record_id,
      status: row.status as ContaminationStatus,
      helpLevel: row.contaminating_help_level as HelpLevel,
      openedAt: row.opened_at,
    };
    if (row.closure_method) out.closureMethod = row.closure_method;
    return out;
  }

  closeContamination(recordId: string, closureMethod: string, evidenceId?: string): string {
    const closureId = randomUUID();
    const timestamp = now();
    this.db
      .prepare(
        `UPDATE contamination_records
         SET status = 'provisional_owned', closed_at = ?, closure_method = ?, closure_evidence_id = ?
         WHERE record_id = ?`,
      )
      .run(timestamp, closureMethod, evidenceId ?? null, recordId);
    this.db
      .prepare(
        `INSERT INTO contamination_closures(
           closure_id, record_id, from_status, to_status, method, evidence_id, occurred_at, recorded_at
         ) VALUES (?, ?, 'contaminated', 'provisional_owned', ?, ?, ?, ?)`,
      )
      .run(closureId, recordId, closureMethod, evidenceId ?? null, timestamp, timestamp);
    return closureId;
  }

  startAttempt(input: {
    sessionId: string;
    targetId?: string;
    protocolNodeId?: string;
  }): string {
    const attemptId = randomUUID();
    const timestamp = now();
    this.db
      .prepare(
        `INSERT INTO attempts(
           id, study_session_id, target_id, protocol_node_id, status, started_at
         ) VALUES (?, ?, ?, ?, 'started', ?)`,
      )
      .run(
        attemptId,
        input.sessionId,
        input.targetId ?? null,
        input.protocolNodeId ?? null,
        timestamp,
      );
    return attemptId;
  }

  submitAttempt(attemptId: string, artifactJson: string): void {
    const timestamp = now();
    this.db
      .prepare(
        `UPDATE attempts
         SET status = 'submitted', artifact_json = ?, submitted_at = ?
         WHERE id = ?`,
      )
      .run(artifactJson, timestamp, attemptId);
  }

  recordAssessment(attemptId: string, evidence: Array<{
    type: string;
    score?: number;
    confidence?: number;
    notes?: string;
  }>): string {
    const assessmentId = randomUUID();
    const timestamp = now();
    for (const item of evidence) {
      this.db
        .prepare(
          `INSERT INTO assessment_evidence(
             id, attempt_id, evidence_type, score, confidence, notes_json, assessed_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          attemptId,
          item.type,
          item.score ?? null,
          item.confidence ?? null,
          item.notes ? JSON.stringify({ notes: item.notes }) : null,
          timestamp,
        );
    }
    this.db
      .prepare(
        `UPDATE attempts SET status = 'assessed', assessed_at = ? WHERE id = ?`,
      )
      .run(timestamp, attemptId);
    return assessmentId;
  }

  openGap(input: {
    sessionId: string;
    targetId?: string;
    openedByEvidenceId?: string;
  }): string {
    const gapId = randomUUID();
    const timestamp = now();
    this.db
      .prepare(
        `INSERT INTO gap_records(
           gap_id, study_session_id, target_id, status, opened_at, opened_by_evidence_id
         ) VALUES (?, ?, ?, 'open', ?, ?)`,
      )
      .run(
        gapId,
        input.sessionId,
        input.targetId ?? null,
        timestamp,
        input.openedByEvidenceId ?? null,
      );
    return gapId;
  }

  provisionallyCloseGap(gapId: string, evidenceId?: string, closureMethod?: string): void {
    const timestamp = now();
    this.db
      .prepare(
        `UPDATE gap_records
         SET status = 'provisional_closed', closed_at = ?, closure_method = ?, closure_evidence_id = ?
         WHERE gap_id = ?`,
      )
      .run(
        timestamp,
        closureMethod ?? "independent_reconstruction",
        evidenceId ?? null,
        gapId,
      );
  }

  verifyGap(gapId: string, evidenceId?: string): void {
    const timestamp = now();
    this.db
      .prepare(
        `UPDATE gap_records
         SET status = 'verified', verified_at = ?, verified_by_evidence_id = ?
         WHERE gap_id = ?`,
      )
      .run(timestamp, evidenceId ?? null, gapId);
  }

  saveGoalContract(contract: {
    contractId: string;
    learnerId: string;
    capability: string;
    targetTask: string;
    successCriteria: string;
    allowedHints?: readonly string[];
    retentionDays?: number;
    learnerConfirmed: boolean;
    createdAt: string;
    confirmedAt?: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO goal_contracts(
           contract_id, learner_id, capability, target_task, success_criteria,
           allowed_hints_json, retention_days, learner_confirmed, created_at, confirmed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        contract.contractId,
        contract.learnerId,
        contract.capability,
        contract.targetTask,
        contract.successCriteria,
        contract.allowedHints ? JSON.stringify(contract.allowedHints) : null,
        contract.retentionDays ?? null,
        contract.learnerConfirmed ? 1 : 0,
        contract.createdAt,
        contract.confirmedAt ?? null,
      );
  }

  getGoalContract(contractId: string): {
    contractId: string;
    learnerId: string;
    capability: string;
    targetTask: string;
    successCriteria: string;
    allowedHints: readonly string[] | undefined;
    retentionDays: number | undefined;
    learnerConfirmed: boolean;
    createdAt: string;
    confirmedAt: string | undefined;
  } | undefined {
    const row = this.db
      .prepare(
        `SELECT contract_id, learner_id, capability, target_task, success_criteria,
                allowed_hints_json, retention_days, learner_confirmed, created_at, confirmed_at
         FROM goal_contracts WHERE contract_id = ?`,
      )
      .get(contractId) as unknown as
      | {
          contract_id: string;
          learner_id: string;
          capability: string;
          target_task: string;
          success_criteria: string;
          allowed_hints_json: string | null;
          retention_days: number | null;
          learner_confirmed: number;
          created_at: string;
          confirmed_at: string | null;
        }
      | undefined;
    if (!row) return undefined;
    return {
      contractId: row.contract_id,
      learnerId: row.learner_id,
      capability: row.capability,
      targetTask: row.target_task,
      successCriteria: row.success_criteria,
      allowedHints: row.allowed_hints_json ? JSON.parse(row.allowed_hints_json) : undefined,
      retentionDays: row.retention_days ?? undefined,
      learnerConfirmed: row.learner_confirmed === 1,
      createdAt: row.created_at,
      confirmedAt: row.confirmed_at ?? undefined,
    };
  }

  // ---- X+ Runtime Engine (migration 010) ----

  linkSessionContract(sessionId: string, contractId: string): void {
    this.db.prepare(`UPDATE study_sessions SET contract_id = ? WHERE id = ?`).run(contractId, sessionId);
  }

  getGoalContractForSession(sessionId: string): {
    contractId: string;
    capability: string;
    targetTask: string;
    successCriteria: string;
    allowedHints?: readonly string[];
    retentionDays?: number;
    learnerConfirmed: boolean;
  } | undefined {
    const row = this.db
      .prepare(
        `SELECT g.contract_id, g.capability, g.target_task, g.success_criteria,
                g.allowed_hints_json, g.retention_days, g.learner_confirmed
         FROM study_sessions s
         JOIN goal_contracts g ON g.contract_id = s.contract_id
         WHERE s.id = ?`,
      )
      .get(sessionId) as unknown as
      | {
          contract_id: string;
          capability: string;
          target_task: string;
          success_criteria: string;
          allowed_hints_json: string | null;
          retention_days: number | null;
          learner_confirmed: number;
        }
      | undefined;
    if (!row) return undefined;
    return {
      contractId: row.contract_id,
      capability: row.capability,
      targetTask: row.target_task,
      successCriteria: row.success_criteria,
      allowedHints: row.allowed_hints_json ? JSON.parse(row.allowed_hints_json) : undefined,
      ...(row.retention_days != null ? { retentionDays: row.retention_days } : {}),
      learnerConfirmed: row.learner_confirmed === 1,
    };
  }

  recordCanvasArtifact(input: {
    runId: string;
    sessionId: string;
    captureJson: string;
    screenshotSha256: string;
    model: string;
  }): void {
    const timestamp = now();
    this.db
      .prepare(
        `INSERT INTO canvas_artifacts(
           run_id, study_session_id, capture_json, screenshot_sha256, model,
           canonical_flag, learner_owned_flag, status, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 0, 0, 'transcribed', ?, ?)`,
      )
      .run(
        input.runId,
        input.sessionId,
        input.captureJson,
        input.screenshotSha256,
        input.model,
        timestamp,
        timestamp,
      );
  }

  attachCanvasTranscription(input: { runId: string; transcriptionJson: string }): void {
    const timestamp = now();
    this.db
      .prepare(
        `UPDATE canvas_artifacts
         SET transcription_json = ?, status = 'transcribed', updated_at = ?
         WHERE run_id = ?`,
      )
      .run(input.transcriptionJson, timestamp, input.runId);
  }

  getCanvasArtifact(runId: string): {
    runId: string;
    sessionId: string;
    captureJson: string | null;
    screenshotSha256: string;
    model: string;
    transcriptionJson: string | null;
    canonical: boolean;
    learnerOwned: boolean;
    status: string;
    confirmedJson: string | null;
    note: string | null;
  } | undefined {
    const row = this.db
      .prepare(
        `SELECT run_id, study_session_id, capture_json, screenshot_sha256, model,
                transcription_json, canonical_flag, learner_owned_flag, status,
                confirmed_json, confirmation_note
         FROM canvas_artifacts WHERE run_id = ?`,
      )
      .get(runId) as unknown as
      | {
          run_id: string;
          study_session_id: string;
          capture_json: string | null;
          screenshot_sha256: string;
          model: string;
          transcription_json: string | null;
          canonical_flag: number;
          learner_owned_flag: number;
          status: string;
          confirmed_json: string | null;
          confirmation_note: string | null;
        }
      | undefined;
    if (!row) return undefined;
    return {
      runId: row.run_id,
      sessionId: row.study_session_id,
      captureJson: row.capture_json,
      screenshotSha256: row.screenshot_sha256,
      model: row.model,
      transcriptionJson: row.transcription_json,
      canonical: row.canonical_flag === 1,
      learnerOwned: row.learner_owned_flag === 1,
      status: row.status,
      confirmedJson: row.confirmed_json,
      note: row.confirmation_note,
    };
  }

  getLatestCanvasArtifact(sessionId: string): ReturnType<StudyStore["getCanvasArtifact"]> {
    const row = this.db
      .prepare(
        `SELECT run_id FROM canvas_artifacts
         WHERE study_session_id = ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(sessionId) as unknown as { run_id: string } | undefined;
    if (!row) return undefined;
    return this.getCanvasArtifact(row.run_id);
  }

  confirmCanvasLiteral(input: {
    runId: string;
    observationIds: string[];
    note: string | null;
  }): boolean {
    const artifact = this.getCanvasArtifact(input.runId);
    if (!artifact) return false;
    const tr = (artifact.transcriptionJson ? JSON.parse(artifact.transcriptionJson) : {}) as Record<string, unknown>;
    const valid = new Set<string>();
    for (const group of ["texts", "objects", "visual_marks", "visible_symbols"]) {
      const items = (tr[group] as Array<{ id?: string }> | undefined) ?? [];
      for (const item of items) {
        if (item && item.id) valid.add(item.id);
      }
    }
    for (const id of input.observationIds) {
      if (!valid.has(id)) return false;
    }
    const timestamp = now();
    this.db
      .prepare(
        `UPDATE canvas_artifacts
         SET status = 'confirmed', confirmed_json = ?, confirmation_note = ?, updated_at = ?
         WHERE run_id = ?`,
      )
      .run(JSON.stringify(input.observationIds), input.note, timestamp, input.runId);
    return true;
  }

  rejectCanvasTranscription(input: { runId: string; reason: string }): void {
    const timestamp = now();
    this.db
      .prepare(
        `UPDATE canvas_artifacts SET status = 'rejected', confirmation_note = ?, updated_at = ? WHERE run_id = ?`,
      )
      .run(input.reason, timestamp, input.runId);
  }

  recordProtocolEvidence(input: { sessionId: string; nodeId: string; evidenceToken: string }): string {
    const id = randomUUID();
    const timestamp = now();
    this.db
      .prepare(
        `INSERT INTO protocol_evidence(
           id, study_session_id, node_id, evidence_token, created_at, revoked_at, valid_until
         ) VALUES (?, ?, ?, ?, ?, NULL, NULL)`,
      )
      .run(id, input.sessionId, input.nodeId, input.evidenceToken, timestamp);
    return id;
  }

  revokeProtocolEvidence(input: {
    sessionId: string;
    nodeId?: string;
    evidenceToken?: string;
  }): number {
    const timestamp = now();
    const res = this.db
      .prepare(
        `UPDATE protocol_evidence
         SET revoked_at = ?
         WHERE study_session_id = ? AND revoked_at IS NULL
           AND (? IS NULL OR node_id = ?)
           AND (? IS NULL OR evidence_token = ?)`,
      )
      .run(
        timestamp,
        input.sessionId,
        input.nodeId ?? null,
        input.nodeId ?? null,
        input.evidenceToken ?? null,
        input.evidenceToken ?? null,
      );
    return Number(res.changes);
  }

  getValidProtocolEvidence(sessionId: string, nodeId?: string, evidenceToken?: string): string[] {
    const rows = this.db
      .prepare(
        `SELECT evidence_token FROM protocol_evidence
         WHERE study_session_id = ? AND revoked_at IS NULL
           AND (? IS NULL OR node_id = ?)
           AND (? IS NULL OR evidence_token = ?)`,
      )
      .all(
        sessionId,
        nodeId ?? null,
        nodeId ?? null,
        evidenceToken ?? null,
        evidenceToken ?? null,
      ) as unknown as Array<{ evidence_token: string }>;
    return rows.map((r) => r.evidence_token);
  }

  upsertTargetEvidenceState(input: {
    sessionId: string;
    targetId: string;
    ownershipStatus?: "unverified" | "provisional_owned" | "verified_owned";
    readiness?: "insufficient" | "provisional" | "stable";
    reviewDueAt?: string | null;
    lastReviewAt?: string | null;
  }): void {
    const existing = this.getTargetEvidenceState(input.targetId);
    const timestamp = now();
    if (existing) {
      this.db
        .prepare(
          `UPDATE target_evidence_state
           SET ownership_status = COALESCE(?, ownership_status),
               readiness = COALESCE(?, readiness),
               review_due_at = COALESCE(?, review_due_at),
               last_review_at = COALESCE(?, last_review_at),
               updated_at = ?
           WHERE target_id = ?`,
        )
        .run(
          input.ownershipStatus ?? null,
          input.readiness ?? null,
          input.reviewDueAt ?? null,
          input.lastReviewAt ?? null,
          timestamp,
          input.targetId,
        );
    } else {
      this.db
        .prepare(
          `INSERT INTO target_evidence_state(
             target_id, study_session_id, ownership_status, readiness,
             review_due_at, last_review_at, created_at, updated_at
           ) VALUES (?, ?, COALESCE(?, 'unverified'), COALESCE(?, 'insufficient'), ?, ?, ?, ?)`,
        )
        .run(
          input.targetId,
          input.sessionId,
          input.ownershipStatus ?? null,
          input.readiness ?? null,
          input.reviewDueAt ?? null,
          input.lastReviewAt ?? null,
          timestamp,
          timestamp,
        );
    }
  }

  getTargetEvidenceState(targetId: string): {
    targetId: string;
    sessionId: string;
    ownershipStatus: "unverified" | "provisional_owned" | "verified_owned";
    readiness: "insufficient" | "provisional" | "stable";
    reviewDueAt: string | null;
    lastReviewAt: string | null;
  } | undefined {
    const row = this.db
      .prepare(
        `SELECT target_id, study_session_id, ownership_status, readiness, review_due_at, last_review_at
         FROM target_evidence_state WHERE target_id = ?`,
      )
      .get(targetId) as unknown as
      | {
          target_id: string;
          study_session_id: string;
          ownership_status: string;
          readiness: string;
          review_due_at: string | null;
          last_review_at: string | null;
        }
      | undefined;
    if (!row) return undefined;
    return {
      targetId: row.target_id,
      sessionId: row.study_session_id,
      ownershipStatus: row.ownership_status as "unverified" | "provisional_owned" | "verified_owned",
      readiness: row.readiness as "insufficient" | "provisional" | "stable",
      reviewDueAt: row.review_due_at,
      lastReviewAt: row.last_review_at,
    };
  }

  getTargetEvidenceStates(sessionId: string): Array<{
    targetId: string;
    ownershipStatus: "unverified" | "provisional_owned" | "verified_owned";
    readiness: "insufficient" | "provisional" | "stable";
    reviewDueAt: string | null;
    lastReviewAt: string | null;
  }> {
    const rows = this.db
      .prepare(
        `SELECT target_id, ownership_status, readiness, review_due_at, last_review_at
         FROM target_evidence_state WHERE study_session_id = ?`,
      )
      .all(sessionId) as unknown as Array<{
      target_id: string;
      ownership_status: string;
      readiness: string;
      review_due_at: string | null;
      last_review_at: string | null;
    }>;
    return rows.map((r) => ({
      targetId: r.target_id,
      ownershipStatus: r.ownership_status as "unverified" | "provisional_owned" | "verified_owned",
      readiness: r.readiness as "insufficient" | "provisional" | "stable",
      reviewDueAt: r.review_due_at,
      lastReviewAt: r.last_review_at,
    }));
  }

  recordNextActionDecision(input: {
    sessionId: string;
    actionType: string;
    contextJson: string;
    decisionJson: string;
  }): string {
    const id = randomUUID();
    const timestamp = now();
    this.db
      .prepare(
        `INSERT INTO next_action_decisions(
           decision_id, study_session_id, action_type, context_json, decision_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.sessionId, input.actionType, input.contextJson, input.decisionJson, timestamp);
    return id;
  }

  getOperationAttempts(targetId: string): Array<{
    operationId: string;
    operation: string;
    author: string;
    helpLevel: string;
    answerVisible: boolean;
    attemptIndependent: boolean;
    status: string;
    occurredAt: string;
  }> {
    const rows = this.db
      .prepare(
        `SELECT operation_id, operation, author, help_level, answer_visible,
                attempt_independent, status, occurred_at
         FROM operation_attempts WHERE target_id = ? ORDER BY occurred_at ASC`,
      )
      .all(targetId) as unknown as Array<{
      operation_id: string;
      operation: string;
      author: string;
      help_level: string;
      answer_visible: number;
      attempt_independent: number;
      status: string;
      occurred_at: string;
    }>;
    return rows.map((r) => ({
      operationId: r.operation_id,
      operation: r.operation,
      author: r.author,
      helpLevel: r.help_level,
      answerVisible: r.answer_visible === 1,
      attemptIndependent: r.attempt_independent === 1,
      status: r.status,
      occurredAt: r.occurred_at,
    }));
  }

  getTargetAssessments(targetId: string): Array<{
    attemptId: string;
    notesJson: string | null;
    assessedAt: string;
  }> {
    const rows = this.db
      .prepare(
        `SELECT a.id AS attempt_id, ae.notes_json, ae.assessed_at
         FROM attempts a
         JOIN assessment_evidence ae ON ae.attempt_id = a.id
         WHERE a.target_id = ? ORDER BY ae.assessed_at ASC`,
      )
      .all(targetId) as unknown as Array<{ attempt_id: string; notes_json: string | null; assessed_at: string }>;
    return rows.map((r) => ({
      attemptId: r.attempt_id,
      notesJson: r.notes_json,
      assessedAt: r.assessed_at,
    }));
  }

  createPersistentReview(input: { sessionId: string; targetId: string; dueAt: string }): string {
    const id = randomUUID();
    const timestamp = now();
    this.db
      .prepare(
        `INSERT INTO review_schedule(
           review_id, study_session_id, target_id, scheduled_at, due_at, status, created_at
         ) VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
      )
      .run(id, input.sessionId, input.targetId, timestamp, input.dueAt, timestamp);
    return id;
  }

  getDueReviewItems(
    sessionId: string,
    nowIso: string,
  ): Array<{ reviewId: string; targetId: string; dueAt: string; status: string }> {
    const rows = this.db
      .prepare(
        `SELECT review_id, target_id, due_at, status
         FROM review_schedule
         WHERE study_session_id = ? AND status = 'pending' AND due_at <= ?`,
      )
      .all(sessionId, nowIso) as unknown as Array<{
      review_id: string;
      target_id: string;
      due_at: string;
      status: string;
    }>;
    return rows.map((r) => ({
      reviewId: r.review_id,
      targetId: r.target_id,
      dueAt: r.due_at,
      status: r.status,
    }));
  }

  completePersistentReview(input: { reviewId: string; evidenceId?: string; nowIso: string }): void {
    this.db
      .prepare(
        `UPDATE review_schedule SET status = 'completed', completed_at = ?, completion_evidence_id = ? WHERE review_id = ?`,
      )
      .run(input.nowIso, input.evidenceId ?? null, input.reviewId);
  }
}
