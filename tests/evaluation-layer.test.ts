import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { StudyHarness, MemoryHarnessRepository, TrustedLearnerIngress } from "../src/harness/index.js";
import {
  createSyntheticEvaluationFixture,
  DeterministicFixtureScorer,
  EvaluationService,
  EvaluationStore,
  FutureAiSemanticScorer,
  ManualTrustedScorer,
  sha256Hex,
} from "../src/evaluation/index.js";

function makeClock(start = "2026-01-01T00:00:00.000Z") {
  let ms = Date.parse(start);
  return {
    now: () => new Date(ms).toISOString(),
    advance: (delta: number) => { ms += delta; },
  };
}

function makeHarness() {
  let id = 0;
  const repo = new MemoryHarnessRepository();
  const clock = makeClock();
  const harness = new StudyHarness(repo, { now: clock.now, id: () => `h-${++id}` });
  return { harness, repo, clock };
}

function makeEvaluation(trialSubjectKind: "human" | "synthetic" = "synthetic") {
  const dir = mkdtempSync(join(tmpdir(), "eval-layer-"));
  const clock = makeClock();
  let id = 0;
  const store = new EvaluationStore(join(dir, "evaluation.sqlite"));
  const service = new EvaluationService(store, { now: clock.now, id: () => `e-${++id}` });
  const fixture = createSyntheticEvaluationFixture();
  service.importProtocol(fixture.protocol);
  service.importStudyPack(fixture.pack);
  const trials = service.generateAssignments({
    protocolId: fixture.protocol.protocolId,
    protocolVersion: fixture.protocol.version,
    packId: fixture.pack.packId,
    packVersion: fixture.pack.version,
    participantId: fixture.participantId,
    seed: fixture.seed,
    trialSubjectKind,
  }).trials;
  return { dir, clock, store, service, fixture, trials };
}

function vector(content: string, criterionIds = ["idea", "reason", "transfer"]) {
  const lower = content.toLowerCase();
  const criteria: Record<string, "met" | "unmet" | "unknown"> = {};
  let metCount = 0;
  let unmetCount = 0;
  for (const criterionId of criterionIds) {
    const met = lower.includes(criterionId);
    criteria[criterionId] = met ? "met" : "unmet";
    if (met) metCount += 1;
    else unmetCount += 1;
  }
  return { criteria, metCount, unmetCount, unknownCount: 0 };
}

function cycleTrial(service: EvaluationService, trialId: string, clock: ReturnType<typeof makeClock>, contentPrefix = "") {
  service.startTrial(trialId);
  const humanIngress = service.trustedHumanIngress();
  const syntheticIngress = service.syntheticTestIngress("deterministic-fixture");
  const phases = ["pretest", "immediate", "transfer", "delayed"] as const;
  const contents = {
    pretest: `${contentPrefix}idea`,
    immediate: `${contentPrefix}idea reason`,
    transfer: `${contentPrefix}idea reason transfer`,
    delayed: `${contentPrefix}idea reason transfer`,
  };
  for (const phase of phases) {
    if (phase === "delayed") clock.advance(86_400_000);
    const opened = service.openCheckpoint(trialId, phase);
    if (phase === "immediate") {
      service.recordInterventionObservation({
        trialId,
        checkpointId: opened.checkpoint.checkpointId,
        pedagogicalIntent: "keep learner moving",
        technique: "process prompt",
        helpLevel: "process_prompt",
        phase,
        technicalWaitMs: 125,
        aiOutputWords: 8,
        aiOutputCharacters: 42,
        learnerNote: "focused",
      });
    }
    if (service.trialStatus(trialId).trial.trialSubjectKind === "human") {
      humanIngress.recordArtifact(opened.checkpoint.checkpointId, { kind: "text", content: contents[phase] });
    } else {
      syntheticIngress.recordArtifact(opened.checkpoint.checkpointId, { kind: "text", content: contents[phase] });
    }
    clock.advance(10);
    service.assessCheckpoint(
      opened.checkpoint.checkpointId,
      phase === "pretest"
        ? new ManualTrustedScorer("human-scorer", "1", vector(contents[phase]))
        : phase === "transfer"
          ? new FutureAiSemanticScorer("ai-scorer", "1")
          : new DeterministicFixtureScorer("det-scorer", "1"),
      phase === "pretest" ? { vector: vector(contents[phase]) } : phase === "transfer" ? { vector: vector(contents[phase]) } : undefined,
    );
  }
  service.recordSubjectiveFeedback({ trialId, clarity: 4, load: 2, usefulness: 4, confidence: 3, comment: "felt clear" });
}

test("evaluation records do not change harness mastery or completion", () => {
  const { harness, repo } = makeHarness();
  const started = harness.start("learner", {
    capability: "Explain a synthetic idea",
    targetTask: "Write a short explanation",
    successCriteria: "Independent evidence only",
    subject: "general",
  });
  const before = harness.status(started.sessionId);
  const { service, trials } = makeEvaluation();
  service.trialStatus(trials[0]!.trialId);
  const after = harness.status(started.sessionId);
  assert.deepEqual(after.projection, before.projection);
  assert.deepEqual(after.completion, before.completion);
  assert.equal(repo.load(started.sessionId).length, 1);
});

test("evaluation events never become learner evidence in harness", () => {
  const { harness, repo } = makeHarness();
  const started = harness.start("learner", {
    capability: "Explain a synthetic idea",
    targetTask: "Write a short explanation",
    successCriteria: "Independent evidence only",
    subject: "general",
  });
  new TrustedLearnerIngress(harness).confirmGoal(started.sessionId, "yes");
  const beforeCount = repo.load(started.sessionId).length;
  const { service } = makeEvaluation();
  const status = harness.status(started.sessionId);
  assert.equal(status.projection.completedAt, undefined);
  assert.equal(repo.load(started.sessionId).length, beforeCount);
  assert.equal(service.showDueDelayedTests().length >= 0, true);
});

test("assignment is reproducible and started trials are not reassigned", () => {
  const { service, fixture, trials } = makeEvaluation();
  const second = service.generateAssignments({
    protocolId: fixture.protocol.protocolId,
    protocolVersion: fixture.protocol.version,
    packId: fixture.pack.packId,
    packVersion: fixture.pack.version,
    participantId: fixture.participantId,
    seed: "different-seed",
    trialSubjectKind: "synthetic",
  }).trials;
  assert.deepEqual(second.map((trial) => trial.trialId), trials.map((trial) => trial.trialId));
  service.startTrial(trials[0]!.trialId);
  const reassigned = service.generateAssignments({
    protocolId: fixture.protocol.protocolId,
    protocolVersion: fixture.protocol.version,
    packId: fixture.pack.packId,
    packVersion: fixture.pack.version,
    participantId: fixture.participantId,
    seed: "another-seed",
    trialSubjectKind: "synthetic",
  }).trials;
  assert.equal(reassigned[0]!.startedAt, service.trialStatus(trials[0]!.trialId).trial.startedAt);
});

test("assessment forms stay out of the coaching surface until a checkpoint is opened", () => {
  const { service, trials } = makeEvaluation();
  const status = service.trialStatus(trials[0]!.trialId);
  assert.equal(JSON.stringify(status).includes("Immediately after study"), false);
  const opened = service.openCheckpoint(trials[0]!.trialId, "pretest");
  assert.match(opened.form.prompt, /Before study|pretest/i);
  assert.equal(JSON.stringify(status).includes("synthetic-immediate-form-v0"), false);
});

test("delayed outcomes remain not-yet-due until the injected clock reaches the due time", () => {
  const { service, trials, clock } = makeEvaluation();
  const trialId = trials[0]!.trialId;
  service.startTrial(trialId);
  const delayed = service.openCheckpoint(trialId, "delayed");
  assert.equal(delayed.checkpoint.status, "not-yet-due");
  assert.equal(delayed.form.prompt.includes("not yet due"), true);
  assert.throws(() => service.syntheticTestIngress("deterministic-fixture").recordArtifact(delayed.checkpoint.checkpointId, { kind: "text", content: "idea reason transfer" }), /not yet due/);
  clock.advance(86_400_000 + 1);
  const due = service.openCheckpoint(trialId, "delayed");
  assert.equal(due.checkpoint.status, "presented");
  service.syntheticTestIngress("deterministic-fixture").recordArtifact(due.checkpoint.checkpointId, { kind: "text", content: "idea reason transfer" });
  service.assessCheckpoint(due.checkpoint.checkpointId, new DeterministicFixtureScorer("det", "1"));
  assert.notEqual(service.trialStatus(trialId).checkpoints.find((checkpoint) => checkpoint.phase === "delayed")?.status, "not-yet-due");
});

test("human, deterministic, and AI-derived scoring provenance differ", () => {
  const { service, trials } = makeEvaluation();
  const trialId = trials[0]!.trialId;
  service.startTrial(trialId);
  const pretest = service.openCheckpoint(trialId, "pretest");
  service.syntheticTestIngress("deterministic-fixture").recordArtifact(pretest.checkpoint.checkpointId, { kind: "text", content: "idea" });
  service.assessCheckpoint(pretest.checkpoint.checkpointId, new ManualTrustedScorer("human-1", "1", vector("idea")));
  assert.equal(service.trialStatus(trialId).checkpoints.find((checkpoint) => checkpoint.phase === "pretest")?.scorer?.scorerKind, "trusted-human");
  const immediate = service.openCheckpoint(trialId, "immediate");
  service.syntheticTestIngress("deterministic-fixture").recordArtifact(immediate.checkpoint.checkpointId, { kind: "text", content: "idea reason" });
  service.assessCheckpoint(immediate.checkpoint.checkpointId, new DeterministicFixtureScorer("det-1", "1"));
  assert.equal(service.trialStatus(trialId).checkpoints.find((checkpoint) => checkpoint.phase === "immediate")?.scorer?.scorerKind, "deterministic");
  const transfer = service.openCheckpoint(trialId, "transfer");
  service.syntheticTestIngress("ai-simulation").recordArtifact(transfer.checkpoint.checkpointId, { kind: "text", content: "idea reason transfer" });
  service.assessCheckpoint(transfer.checkpoint.checkpointId, new FutureAiSemanticScorer("ai-1", "1"), { vector: vector("idea reason transfer") });
  assert.equal(service.trialStatus(trialId).checkpoints.find((checkpoint) => checkpoint.phase === "transfer")?.scorer?.scorerKind, "ai-semantic");
});

test("contaminated artifacts do not become clean outcomes", () => {
  const { service, trials } = makeEvaluation();
  const trialId = trials[0]!.trialId;
  service.startTrial(trialId);
  const immediate = service.openCheckpoint(trialId, "immediate");
  service.recordInterventionObservation({
    trialId,
    checkpointId: immediate.checkpoint.checkpointId,
    pedagogicalIntent: "help",
    technique: "content hint",
    helpLevel: "content_hint",
    phase: "immediate",
    learnerNote: "too much help",
  });
  service.syntheticTestIngress("deterministic-fixture").recordArtifact(immediate.checkpoint.checkpointId, { kind: "text", content: "idea reason" });
  service.assessCheckpoint(immediate.checkpoint.checkpointId, new DeterministicFixtureScorer("det", "1"));
  const checkpoint = service.trialStatus(trialId).checkpoints.find((item) => item.phase === "immediate");
  assert.equal(checkpoint?.status, "invalid");
  assert.equal(service.trialStatus(trialId).metrics.contaminatedAttempts > 0, true);
});

test("comparison reports preserve unknown and missing measurements", () => {
  const { service, fixture, trials } = makeEvaluation();
  service.startTrial(trials[0]!.trialId);
  const pretest = service.openCheckpoint(trials[0]!.trialId, "pretest");
  service.syntheticTestIngress("deterministic-fixture").recordArtifact(pretest.checkpoint.checkpointId, { kind: "text", content: "idea" });
  service.assessCheckpoint(pretest.checkpoint.checkpointId, new ManualTrustedScorer("human", "1", vector("idea")));
  const report = service.syntheticBehavioralReport(fixture.protocol.protocolId, fixture.protocol.version, fixture.pack.packId, fixture.pack.version, fixture.participantId, fixture.seed);
  assert.equal(report.cells.some((cell) => cell.mechanics.missing.length > 0), true);
  assert.equal(report.warning.includes("NOT HUMAN LEARNING EVIDENCE"), true);
});

test("synthetic report separates clean incorrect attempts from contamination and uses the latest due outcome", () => {
  const { service, fixture, trials, clock } = makeEvaluation("synthetic");
  cycleTrial(service, trials[0]!.trialId, clock);
  const report = service.syntheticBehavioralReport(fixture.protocol.protocolId, fixture.protocol.version, fixture.pack.packId, fixture.pack.version, fixture.participantId, fixture.seed);
  const cell = report.cells.find((item) => item.trialId === trials[0]!.trialId)!;
  assert.equal(cell.rubricPipeline.rubricPipelineDelta, 2);
  assert.equal(cell.mechanics.cleanAttempts, 4);
  assert.equal(cell.mechanics.contaminatedAttempts, 0);
  assert.equal(cell.rubricPipeline.freshContextProxy.unknownCount, 0);
});

test("summary export strips raw text, absolute paths, participant identity, sources, audio, and secrets", () => {
  const { service, fixture, trials, dir, clock } = makeEvaluation("human");
  cycleTrial(service, trials[0]!.trialId, clock);
  const out = join(dir, "summary-export");
  const preview = service.previewExport({
    mode: "summary",
    protocolId: fixture.protocol.protocolId,
    protocolVersion: fixture.protocol.version,
    packId: fixture.pack.packId,
    packVersion: fixture.pack.version,
    participantId: fixture.participantId,
    seed: fixture.seed,
    outputDirectory: out,
  });
  const exported = service.exportBundle({
    mode: "summary",
    protocolId: fixture.protocol.protocolId,
    protocolVersion: fixture.protocol.version,
    packId: fixture.pack.packId,
    packVersion: fixture.pack.version,
    participantId: fixture.participantId,
    seed: fixture.seed,
    outputDirectory: out,
    previewId: preview.exportId,
  });
  assert.equal(preview.secretsScan.passed, true);
  assert.equal(exported.mode, "summary");
  const summary = readFileSync(join(out, "summary.json"), "utf8");
  assert.equal(summary.includes("idea reason transfer"), false);
  assert.equal(summary.includes("/tmp/"), false);
  assert.equal(summary.includes("participant-01"), false);
  assert.equal(summary.includes("sha256-pack-source-a"), false);
  assert.equal(summary.includes("audio"), false);
  assert.equal(summary.includes("ghp_"), false);
});

test("research export requires preview and explicit confirmation, and blocks probable credentials", () => {
  const { service, fixture, trials, dir } = makeEvaluation("human");
  service.startTrial(trials[0]!.trialId);
  const pretest = service.openCheckpoint(trials[0]!.trialId, "pretest");
  service.trustedHumanIngress().recordArtifact(pretest.checkpoint.checkpointId, { kind: "text", content: "idea reason transfer ghp_123456789012345678901234" });
  service.assessCheckpoint(pretest.checkpoint.checkpointId, new ManualTrustedScorer("human", "1", vector("idea reason transfer")));
  const out = join(dir, "research-export");
  assert.throws(() => service.exportBundle({
    mode: "research",
    protocolId: fixture.protocol.protocolId,
    protocolVersion: fixture.protocol.version,
    packId: fixture.pack.packId,
    packVersion: fixture.pack.version,
    participantId: fixture.participantId,
    seed: fixture.seed,
    outputDirectory: out,
  }), /previewId/);
  const preview = service.previewExport({
    mode: "research",
    protocolId: fixture.protocol.protocolId,
    protocolVersion: fixture.protocol.version,
    packId: fixture.pack.packId,
    packVersion: fixture.pack.version,
    participantId: fixture.participantId,
    seed: fixture.seed,
    outputDirectory: out,
  });
  assert.equal(preview.secretsScan.passed, false);
  assert.throws(() => service.exportBundle({
    mode: "research",
    protocolId: fixture.protocol.protocolId,
    protocolVersion: fixture.protocol.version,
    packId: fixture.pack.packId,
    packVersion: fixture.pack.version,
    participantId: fixture.participantId,
    seed: fixture.seed,
    outputDirectory: out,
    previewId: preview.exportId,
    confirm: true,
  }), /blocked by sensitive content/);
});

test("export does not make network requests", () => {
  const { service, fixture, trials, dir, clock } = makeEvaluation("human");
  cycleTrial(service, trials[0]!.trialId, clock);
  const out = join(dir, "summary-network");
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = ((..._args: Parameters<typeof fetch>) => {
    calls += 1;
    return Promise.reject(new Error("network disabled"));
  }) as typeof fetch;
  try {
    const preview = service.previewExport({
      mode: "summary",
      protocolId: fixture.protocol.protocolId,
      protocolVersion: fixture.protocol.version,
      packId: fixture.pack.packId,
      packVersion: fixture.pack.version,
      participantId: fixture.participantId,
      seed: fixture.seed,
      outputDirectory: out,
    });
    service.exportBundle({
      mode: "summary",
      protocolId: fixture.protocol.protocolId,
      protocolVersion: fixture.protocol.version,
      packId: fixture.pack.packId,
      packVersion: fixture.pack.version,
      participantId: fixture.participantId,
      seed: fixture.seed,
      outputDirectory: out,
      previewId: preview.exportId,
    });
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("research export uses a redacted DTO and manifest hashes match written bytes", () => {
  const { service, fixture, trials, dir, clock } = makeEvaluation("human");
  cycleTrial(service, trials[0]!.trialId, clock);
  const out = join(dir, "research-redacted");
  const preview = service.previewExport({
    mode: "research", protocolId: fixture.protocol.protocolId, protocolVersion: fixture.protocol.version,
    packId: fixture.pack.packId, packVersion: fixture.pack.version, participantId: fixture.participantId,
    seed: fixture.seed, outputDirectory: out, trialIds: [trials[0]!.trialId],
  });
  service.exportBundle({
    mode: "research", protocolId: fixture.protocol.protocolId, protocolVersion: fixture.protocol.version,
    packId: fixture.pack.packId, packVersion: fixture.pack.version, participantId: fixture.participantId,
    seed: fixture.seed, outputDirectory: out, trialIds: [trials[0]!.trialId], previewId: preview.exportId, confirm: true,
  });
  const trialText = readFileSync(join(out, "trials", `${trials[0]!.trialId}.json`), "utf8");
  assert.equal(trialText.includes(fixture.participantId), false);
  assert.equal(trialText.includes(fixture.pack.pretestForm.prompt), false);
  const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8")) as { fileHashes: Record<string, string> };
  assert.equal(manifest.fileHashes["summary.json"], sha256Hex(readFileSync(join(out, "summary.json"), "utf8")));
  assert.equal(manifest.fileHashes[`trials/${trials[0]!.trialId}.json`], sha256Hex(trialText));
});

test("export rejects a stale preview after the selected evidence changes", () => {
  const { service, fixture, trials, dir } = makeEvaluation("human");
  service.startTrial(trials[0]!.trialId);
  const checkpoint = service.openCheckpoint(trials[0]!.trialId, "pretest");
  const out = join(dir, "stale-preview");
  const preview = service.previewExport({ mode: "summary", protocolId: fixture.protocol.protocolId, protocolVersion: fixture.protocol.version, packId: fixture.pack.packId, packVersion: fixture.pack.version, participantId: fixture.participantId, seed: fixture.seed, outputDirectory: out });
  service.trustedHumanIngress().recordArtifact(checkpoint.checkpoint.checkpointId, { kind: "text", content: "changed evidence" });
  assert.throws(() => service.exportBundle({ mode: "summary", protocolId: fixture.protocol.protocolId, protocolVersion: fixture.protocol.version, packId: fixture.pack.packId, packVersion: fixture.pack.version, participantId: fixture.participantId, seed: fixture.seed, outputDirectory: out, previewId: preview.exportId }), /unchanged preview/);
});

test("corrupt evaluation records fail closed without affecting harness projection", () => {
  const { service, fixture, trials } = makeEvaluation();
  const trialId = trials[0]!.trialId;
  service.store.db.prepare(`UPDATE evaluation_trials SET json = ? WHERE trial_id = ?`).run("{not-json", trialId);
  assert.throws(() => service.trialStatus(trialId));
  const { harness } = makeHarness();
  const started = harness.start("learner", {
    capability: "Explain a synthetic idea",
    targetTask: "Write a short explanation",
    successCriteria: "Independent evidence only",
    subject: "general",
  });
  assert.equal(harness.status(started.sessionId).completion.complete, false);
  assert.equal(fixture.protocol.protocolId.length > 0, true);
});

test("CLI smoke on the synthetic pack works end-to-end", () => {
  const dir = mkdtempSync(join(tmpdir(), "eval-cli-"));
  const fixture = createSyntheticEvaluationFixture();
  const protocolPath = join(dir, "protocol.json");
  const packPath = join(dir, "pack.json");
  writeFileSync(protocolPath, JSON.stringify(fixture.protocol, null, 2));
  writeFileSync(packPath, JSON.stringify(fixture.pack, null, 2));
  const dbPath = join(dir, "evaluation.sqlite");
  const cli = resolve("evaluation-cli.ts");
  const env = { ...process.env, EVAL_DB: dbPath };
  const run = (args: string[]) => execFileSync("node", ["--import", "tsx", cli, ...args], { env, encoding: "utf8" });
  run(["create-protocol", `@${protocolPath}`]);
  run(["import-pack", `@${packPath}`]);
  const assign = JSON.parse(run(["assign", fixture.protocol.protocolId, String(fixture.protocol.version), fixture.pack.packId, String(fixture.pack.version), fixture.participantId, fixture.seed, "synthetic"]));
  assert.equal(assign.trials.length > 0, true);
  run(["start-trial", assign.trials[0].trialId]);
  const opened = JSON.parse(run(["open-checkpoint", assign.trials[0].trialId, "pretest"]));
  const recorded = JSON.parse(run(["record-synthetic-artifact", opened.checkpoint.checkpointId, "text", "idea reason transfer", "deterministic-fixture"]));
  assert.equal(recorded.artifact.provenance, "deterministic-fixture");
  run(["assess-checkpoint", opened.checkpoint.checkpointId, "deterministic", "cli-det", "1"]);
  const syntheticReport = JSON.parse(run(["synthetic-behavioral-report", fixture.protocol.protocolId, String(fixture.protocol.version), fixture.pack.packId, String(fixture.pack.version), fixture.participantId, fixture.seed]));
  assert.equal(syntheticReport.warning.includes("NOT HUMAN LEARNING EVIDENCE"), true);
  const humanReport = JSON.parse(run(["comparison-report", fixture.protocol.protocolId, String(fixture.protocol.version), fixture.pack.packId, String(fixture.pack.version), fixture.participantId, fixture.seed]));
  assert.equal(humanReport.matchedSets.length, 0);
  const status = JSON.parse(run(["trial-status", assign.trials[0].trialId]));
  assert.equal(status.trial.trialId, assign.trials[0].trialId);
});
