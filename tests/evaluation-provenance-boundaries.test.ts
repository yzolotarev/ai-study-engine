import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  createSyntheticEvaluationFixture,
  DeterministicFixtureScorer,
  EvaluationService,
  EvaluationStore,
  EVALUATION_STORE_SCHEMA_VERSION,
  SYNTHETIC_BEHAVIORAL_WARNING,
  type LearningTrial,
} from "../src/evaluation/index.js";

function setup(trialSubjectKind: "human" | "synthetic", participantId = `${trialSubjectKind}-participant`) {
  const dir = mkdtempSync(join(tmpdir(), "eval-provenance-"));
  const store = new EvaluationStore(join(dir, "evaluation.sqlite"));
  const service = new EvaluationService(store, { now: () => "2026-01-01T00:00:00.000Z" });
  const fixture = createSyntheticEvaluationFixture();
  service.importProtocol(fixture.protocol);
  service.importStudyPack(fixture.pack);
  const trials = service.generateAssignments({
    protocolId: fixture.protocol.protocolId,
    protocolVersion: fixture.protocol.version,
    packId: fixture.pack.packId,
    packVersion: fixture.pack.version,
    participantId,
    seed: fixture.seed,
    trialSubjectKind,
  }).trials;
  return { dir, store, service, fixture, trials };
}

function openPretest(service: EvaluationService, trial: LearningTrial) {
  service.startTrial(trial.trialId);
  return service.openCheckpoint(trial.trialId, "pretest").checkpoint;
}

test("trial subject kind is schema-backed and immutable", () => {
  const { store, trials } = setup("synthetic");
  const trial = trials[0]!;
  const row = store.db.prepare(`SELECT trial_subject_kind FROM evaluation_trials WHERE trial_id = ?`).get(trial.trialId) as { trial_subject_kind: string };
  assert.equal(trial.trialSubjectKind, "synthetic");
  assert.equal(row.trial_subject_kind, "synthetic");
  assert.equal((store.db.prepare(`SELECT version FROM evaluation_store_schema WHERE singleton = 1`).get() as { version: number }).version, EVALUATION_STORE_SCHEMA_VERSION);
  assert.throws(() => store.upsertTrial({ ...trial, trialSubjectKind: "human" }), /subject kind is immutable/);
  assert.throws(() => store.upsertTrial({ ...trial, trialSubjectKind: "legacy-unclassified" }), /subject kind is immutable/);
});

test("human and synthetic ingresses reject the opposite trial kind", () => {
  const human = setup("human", "human-boundary-participant");
  const humanCheckpoint = openPretest(human.service, human.trials[0]!);
  assert.throws(
    () => human.service.syntheticTestIngress("deterministic-fixture").recordArtifact(humanCheckpoint.checkpointId, { kind: "text", content: "fixture" }),
    /synthetic ingress rejects human trial/,
  );
  const humanResult = human.service.trustedHumanIngress().recordArtifact(humanCheckpoint.checkpointId, { kind: "text", content: "human test input" });
  assert.equal(humanResult.artifact.provenance, "trusted-human");

  const synthetic = setup("synthetic", "synthetic-boundary-participant");
  const syntheticCheckpoint = openPretest(synthetic.service, synthetic.trials[0]!);
  assert.throws(
    () => synthetic.service.trustedHumanIngress().recordArtifact(syntheticCheckpoint.checkpointId, { kind: "text", content: "must fail" }),
    /trusted-human ingress rejects synthetic trial/,
  );
  const syntheticResult = synthetic.service.syntheticTestIngress("deterministic-fixture").recordArtifact(syntheticCheckpoint.checkpointId, {
    kind: "text",
    content: "deterministic fixture input",
  });
  assert.equal(syntheticResult.artifact.provenance, "deterministic-fixture");
  assert.equal(syntheticResult.checkpoint.trustedLearnerProvenance, undefined);
});

test("artifact provenance is persisted and immutable", () => {
  const { store, service, trials } = setup("synthetic");
  const checkpoint = openPretest(service, trials[0]!);
  const result = service.syntheticTestIngress("deterministic-fixture").recordArtifact(checkpoint.checkpointId, {
    kind: "text",
    content: "fixed synthetic artifact",
  });
  const row = store.db.prepare(`SELECT artifact_provenance FROM evaluation_artifacts WHERE artifact_id = ?`).get(result.artifact.artifactId) as { artifact_provenance: string };
  assert.equal(row.artifact_provenance, "deterministic-fixture");
  assert.throws(() => store.upsertArtifact({ ...result.artifact, provenance: "ai-simulation" }), /provenance is immutable/);
  assert.throws(
    () => service.syntheticTestIngress("ai-simulation").recordArtifact(checkpoint.checkpointId, { kind: "text", content: "fixed synthetic artifact" }),
    /immutable provenance/,
  );
});

test("synthetic records are hard-excluded from human comparison and export", () => {
  const { dir, service, fixture, trials } = setup("synthetic", "shared-identifiers-synthetic");
  const checkpoint = openPretest(service, trials[0]!);
  service.syntheticTestIngress("deterministic-fixture").recordArtifact(checkpoint.checkpointId, {
    kind: "text",
    content: "idea reason transfer",
  });
  service.assessCheckpoint(checkpoint.checkpointId, new DeterministicFixtureScorer("det", "1"));

  const humanReport = service.comparisonReport(
    fixture.protocol.protocolId,
    fixture.protocol.version,
    fixture.pack.packId,
    fixture.pack.version,
    "shared-identifiers-synthetic",
    fixture.seed,
  );
  assert.equal(humanReport.evidencePopulation, "human-trusted-only");
  assert.equal(humanReport.matchedSets.length, 0);
  assert.equal(humanReport.variantSummaries.length, 0);

  const syntheticReport = service.syntheticBehavioralReport(
    fixture.protocol.protocolId,
    fixture.protocol.version,
    fixture.pack.packId,
    fixture.pack.version,
    "shared-identifiers-synthetic",
    fixture.seed,
  );
  assert.equal(syntheticReport.warning, SYNTHETIC_BEHAVIORAL_WARNING);
  assert.equal(syntheticReport.cells.length, trials.length);
  assert.equal(syntheticReport.cells[0]!.artifactProvenance[0], "deterministic-fixture");
  assert.equal(JSON.stringify(syntheticReport).includes("learningOutcomes"), false);

  const outputDirectory = join(dir, "human-summary");
  assert.throws(() => service.previewExport({
    mode: "summary",
    protocolId: fixture.protocol.protocolId,
    protocolVersion: fixture.protocol.version,
    packId: fixture.pack.packId,
    packVersion: fixture.pack.version,
    participantId: "shared-identifiers-synthetic",
    seed: fixture.seed,
    outputDirectory,
    trialIds: [trials[0]!.trialId],
  }), /excluded from human comparison/);
  const preview = service.previewExport({
    mode: "summary",
    protocolId: fixture.protocol.protocolId,
    protocolVersion: fixture.protocol.version,
    packId: fixture.pack.packId,
    packVersion: fixture.pack.version,
    participantId: "shared-identifiers-synthetic",
    seed: fixture.seed,
    outputDirectory,
  });
  service.exportBundle({
    mode: "summary",
    protocolId: fixture.protocol.protocolId,
    protocolVersion: fixture.protocol.version,
    packId: fixture.pack.packId,
    packVersion: fixture.pack.version,
    participantId: "shared-identifiers-synthetic",
    seed: fixture.seed,
    outputDirectory,
    previewId: preview.exportId,
  });
  const summary = JSON.parse(readFileSync(join(outputDirectory, "summary.json"), "utf8")) as { report: { matchedSets: unknown[]; variantSummaries: unknown[] } };
  assert.deepEqual(summary.report.matchedSets, []);
  assert.deepEqual(summary.report.variantSummaries, []);
});

test("column/json provenance mismatch fails closed", () => {
  const { store, service, fixture, trials } = setup("synthetic", "tamper-probe");
  const trial = trials[0]!;
  store.db.prepare(`UPDATE evaluation_trials SET trial_subject_kind = 'human' WHERE trial_id = ?`).run(trial.trialId);
  assert.throws(
    () => service.comparisonReport(fixture.protocol.protocolId, fixture.protocol.version, fixture.pack.packId, fixture.pack.version, "tamper-probe", fixture.seed),
    /integrity mismatch|excluded from human comparison/,
  );
});

test("legacy database rows migrate to legacy-unclassified and remain read-only", () => {
  const dir = mkdtempSync(join(tmpdir(), "eval-legacy-migration-"));
  const path = join(dir, "evaluation.sqlite");
  const raw = new DatabaseSync(path);
  raw.exec(`
    CREATE TABLE evaluation_trials (
      trial_id TEXT PRIMARY KEY,
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
    CREATE TABLE evaluation_artifacts (
      artifact_id TEXT PRIMARY KEY,
      checkpoint_id TEXT,
      content_hash TEXT,
      json TEXT NOT NULL,
      created_at TEXT,
      updated_at TEXT,
      UNIQUE (checkpoint_id, content_hash)
    );
  `);
  const legacyTrial = {
    trialId: "legacy-trial",
    participantId: "legacy-participant",
    protocolId: "legacy-protocol",
    protocolVersion: 0,
    packId: "legacy-pack",
    packVersion: 0,
    policyId: "legacy-policy",
    policyVersion: 0,
    microtopicId: "legacy-topic",
    matchedSetId: "legacy-set",
    assignmentSeed: "legacy-seed",
    assignmentOrder: 0,
    phaseOrder: ["pretest", "immediate", "transfer", "delayed"],
    status: "planned",
    checkpoints: {},
    artifactIds: ["legacy-artifact"],
  };
  const legacyArtifact = {
    artifactId: "legacy-artifact",
    checkpointId: "legacy-checkpoint",
    kind: "text",
    content: "legacy content",
    contentHash: "legacy-hash",
    createdAt: "2025-01-01T00:00:00.000Z",
  };
  raw.prepare(`INSERT INTO evaluation_trials (
    trial_id, protocol_id, protocol_version, pack_id, pack_version, participant_id,
    policy_id, policy_version, microtopic_id, matched_set_id, assignment_seed,
    assignment_order, status, json, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    legacyTrial.trialId,
    legacyTrial.protocolId,
    legacyTrial.protocolVersion,
    legacyTrial.packId,
    legacyTrial.packVersion,
    legacyTrial.participantId,
    legacyTrial.policyId,
    legacyTrial.policyVersion,
    legacyTrial.microtopicId,
    legacyTrial.matchedSetId,
    legacyTrial.assignmentSeed,
    legacyTrial.assignmentOrder,
    legacyTrial.status,
    JSON.stringify(legacyTrial),
    "2025-01-01T00:00:00.000Z",
    "2025-01-01T00:00:00.000Z",
  );
  raw.prepare(`INSERT INTO evaluation_artifacts (artifact_id, checkpoint_id, content_hash, json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
    legacyArtifact.artifactId,
    legacyArtifact.checkpointId,
    legacyArtifact.contentHash,
    JSON.stringify(legacyArtifact),
    legacyArtifact.createdAt,
    legacyArtifact.createdAt,
  );
  raw.close();

  const store = new EvaluationStore(path);
  const trial = store.getTrial("legacy-trial")!;
  const artifact = store.getArtifact("legacy-artifact")!;
  assert.equal(trial.trialSubjectKind, "legacy-unclassified");
  assert.equal(artifact.provenance, "legacy-unclassified");
  assert.equal((store.db.prepare(`SELECT trial_subject_kind FROM evaluation_trials WHERE trial_id = 'legacy-trial'`).get() as { trial_subject_kind: string }).trial_subject_kind, "legacy-unclassified");
  assert.equal((store.db.prepare(`SELECT artifact_provenance FROM evaluation_artifacts WHERE artifact_id = 'legacy-artifact'`).get() as { artifact_provenance: string }).artifact_provenance, "legacy-unclassified");
  const service = new EvaluationService(store);
  assert.throws(() => service.startTrial("legacy-trial"), /read-only/);
  assert.throws(() => store.upsertTrial({ ...trial, trialSubjectKind: "human" }), /subject kind is immutable/);
  assert.throws(() => store.upsertArtifact({ ...artifact, provenance: "trusted-human" }), /provenance is immutable/);
});

test("evaluation store integrity check and backup/restore are deterministic local operations", () => {
  const { dir, store, fixture } = setup("synthetic", "backup-participant");
  assert.deepEqual(store.integrityCheck().ok, true);
  const backup = join(dir, "backup.sqlite");
  store.backupTo(backup);
  const restored = new EvaluationStore(backup);
  assert.equal(restored.integrityCheck().ok, true);
  assert.deepEqual(restored.getPack(fixture.pack.packId, fixture.pack.version), fixture.pack);
  restored.close();
});

test("explicit human and synthetic store modes reject population mixing", () => {
  const dir = mkdtempSync(join(tmpdir(), "eval-dataset-mode-"));
  const humanStore = new EvaluationStore(join(dir, "human.sqlite"), { datasetKind: "human" });
  const syntheticStore = new EvaluationStore(join(dir, "synthetic.sqlite"), { datasetKind: "synthetic" });
  const fixture = createSyntheticEvaluationFixture();
  assert.throws(() => humanStore.upsertTrial({
    trialId: "synthetic-trial", trialSubjectKind: "synthetic", participantId: "p", protocolId: "p", protocolVersion: 1,
    packId: "pack", packVersion: 1, policyId: "policy", policyVersion: 1, microtopicId: "topic", matchedSetId: "set",
    assignmentSeed: "seed", assignmentOrder: 0, phaseOrder: ["pretest", "immediate", "transfer", "delayed"], status: "planned", checkpoints: {}, artifactIds: [],
  }), /rejects synthetic/);
  assert.throws(() => syntheticStore.upsertArtifact({ artifactId: "human-artifact", checkpointId: "c", provenance: "trusted-human", kind: "text", content: "human", contentHash: "h", createdAt: "2026-01-01T00:00:00.000Z" }), /rejects trusted-human/);
  humanStore.close(); syntheticStore.close();
  assert.equal(fixture.pack.metadata.classification, "synthetic-only");
});
