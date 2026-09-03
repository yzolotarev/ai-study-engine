import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  createSyntheticEvaluationFixture,
  runSyntheticBenchmark,
  EvaluationService,
  EvaluationStore,
  restoreEncryptedBackup,
} from "../src/evaluation/index.js";

function fixtureStore(path = ":memory:") {
  const store = new EvaluationStore(path);
  const service = new EvaluationService(store);
  const fixture = createSyntheticEvaluationFixture();
  service.importProtocol(fixture.protocol);
  service.importStudyPack(fixture.pack);
  return { store, service, fixture };
}

test("evaluation audit stream is hash chained and detects direct snapshot edits", () => {
  const { store, service, fixture } = fixtureStore();
  assert.equal(store.auditIntegrity().ok, true);
  service.importProtocol({ ...fixture.protocol, hypothesis: "changed before any trial" });
  assert.equal(store.auditIntegrity().ok, true);
  store.db.prepare(`UPDATE evaluation_protocols SET json = ? WHERE protocol_id = ? AND version = ?`).run("{\"tampered\":true}", fixture.protocol.protocolId, fixture.protocol.version);
  const check = store.integrityCheck();
  assert.equal(check.ok, false);
  assert.match(check.result, /audit current snapshot mismatch/);
  store.close();
});

test("evaluation audit stream detects direct row deletion", () => {
  const { store, service, fixture } = fixtureStore();
  const trial = service.generateAssignments({
    protocolId: fixture.protocol.protocolId,
    protocolVersion: fixture.protocol.version,
    packId: fixture.pack.packId,
    packVersion: fixture.pack.version,
    participantId: "audit-delete",
    seed: fixture.seed,
    trialSubjectKind: "synthetic",
  }).trials[0]!;
  store.db.prepare(`DELETE FROM evaluation_trials WHERE trial_id = ?`).run(trial.trialId);
  assert.equal(store.integrityCheck().ok, false);
  assert.match(store.integrityCheck().result, /audit current row missing/);
  store.close();
});

test("encrypted backup restores into a fresh store without overwriting", () => {
  const root = mkdtempSync(join(process.cwd(), ".tmp-evaluation-operational-"));
  const source = join(root, "source.sqlite");
  const encrypted = join(root, "source.sqlite.enc");
  const restored = join(root, "restored.sqlite");
  try {
    const { store, service, fixture } = fixtureStore(source);
    service.generateAssignments({
      protocolId: fixture.protocol.protocolId,
      protocolVersion: fixture.protocol.version,
      packId: fixture.pack.packId,
      packVersion: fixture.pack.version,
      participantId: fixture.participantId,
      seed: fixture.seed,
      trialSubjectKind: "synthetic",
    });
    store.backupToEncrypted(encrypted, "a sufficiently long local passphrase");
    store.close();
    assert.equal((statSync(encrypted).mode & 0o777), 0o600);
    assert.match(readFileSync(encrypted, "utf8"), /AI-STUDY-ENGINE-ENCRYPTED-BACKUP-V1/);
    restoreEncryptedBackup(encrypted, restored, "a sufficiently long local passphrase");
    const restoredStore = new EvaluationStore(restored);
    assert.equal(restoredStore.integrityCheck().ok, true);
    assert.equal(restoredStore.listTrials().length, 4);
    assert.throws(() => restoreEncryptedBackup(encrypted, join(root, "wrong.sqlite"), "wrong passphrase"), /could not be restored/);
    restoredStore.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("participant deletion requires exact confirmation and leaves only a hashed tombstone", () => {
  const { store, service, fixture } = fixtureStore();
  const assignment = service.generateAssignments({
    protocolId: fixture.protocol.protocolId,
    protocolVersion: fixture.protocol.version,
    packId: fixture.pack.packId,
    packVersion: fixture.pack.version,
    participantId: "delete-me",
    seed: fixture.seed,
    trialSubjectKind: "synthetic",
  });
  assert.throws(() => store.deleteParticipantData("delete-me", "yes"), /exact typed confirmation/);
  const deletion = store.deleteParticipantData("delete-me", "DELETE delete-me");
  assert.equal(deletion.deletedTrials, assignment.trials.length);
  assert.equal(store.listTrialsByParticipant("delete-me").length, 0);
  assert.equal(store.db.prepare(`SELECT COUNT(*) AS count FROM evaluation_deletion_tombstones WHERE participant_hash = ?`).get(deletion.participantHash)!.count, 1);
  assert.equal(store.auditIntegrity().ok, true);
  store.close();
});

test("synthetic benchmark executes every matrix cell and remains reproducible", () => {
  const first = runSyntheticBenchmark();
  const second = runSyntheticBenchmark();
  assert.equal(first.matrixSize, 64);
  assert.equal(first.completedCells, 64);
  assert.equal(first.failedCells, 0);
  assert.equal(first.warning, "SYNTHETIC SOFTWARE/BEHAVIORAL CHECK — NOT HUMAN LEARNING EVIDENCE");
  assert.equal(first.deterministicDigest, second.deterministicDigest);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.ok(first.cells.some((cell) => cell.policyDecision.intent === "minimal_remediation"));
  assert.ok(first.cells.some((cell) => cell.policyDecision.intent === "clean_retry"));
});

test("substantive help closes the active attempt and opens a distinct clean retry", () => {
  const { store, service, fixture } = fixtureStore();
  const trial = service.generateAssignments({
    protocolId: fixture.protocol.protocolId,
    protocolVersion: fixture.protocol.version,
    packId: fixture.pack.packId,
    packVersion: fixture.pack.version,
    participantId: "retry-learner",
    seed: fixture.seed,
    trialSubjectKind: "synthetic",
  }).trials[0]!;
  service.startTrial(trial.trialId);
  const first = service.openCheckpoint(trial.trialId, "pretest").checkpoint;
  service.recordInterventionObservation({ trialId: trial.trialId, checkpointId: first.checkpointId, pedagogicalIntent: "minimal_remediation", technique: "process cue", helpLevel: "content_hint", phase: "pretest" });
  const retry = service.openCheckpoint(trial.trialId, "pretest").checkpoint;
  assert.notEqual(retry.checkpointId, first.checkpointId);
  assert.notEqual(retry.attemptId, first.attemptId);
  assert.equal(service.store.getCheckpoint(first.checkpointId)?.helpState.contaminated, true);
  assert.equal(retry.helpState.contaminated, false);
  service.syntheticTestIngress("deterministic-fixture").recordArtifact(retry.checkpointId, { kind: "text", content: "idea" });
  assert.equal(service.trialStatus(trial.trialId).checkpoints.length, 2);
  assert.equal(service.trialStatus(trial.trialId).metrics.contaminatedAttempts, 1);
  store.close();
});
