import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createSyntheticEvaluationFixture,
  DeterministicFixtureScorer,
  EvaluationService,
  EvaluationStore,
  ManualTrustedScorer,
  type Scorer,
  type ScorerInput,
} from "../src/evaluation/index.js";

function clock(start = "2026-01-01T00:00:00.000Z") {
  let ms = Date.parse(start);
  return {
    now: () => new Date(ms).toISOString(),
    advance: (delta: number) => { ms += delta; },
  };
}

class RecordingScorer implements Scorer {
  readonly scorerKind = "deterministic" as const;
  readonly scorerId = "recording-scorer";
  readonly scorerVersion = "1";
  public seen?: ScorerInput;
  score(input: ScorerInput): { readonly criteria: Readonly<Record<string, "met" | "unmet" | "unknown">>; readonly metCount: number; readonly unmetCount: number; readonly unknownCount: number } {
    this.seen = input;
    return { criteria: { idea: "met", reason: "met", transfer: "met" } as const, metCount: 3, unmetCount: 0, unknownCount: 0 } as const;
  }
}

function setup(trialSubjectKind: "human" | "synthetic" = "synthetic") {
  const dir = mkdtempSync(join(tmpdir(), "eval-audit-"));
  const clk = clock();
  let id = 0;
  const store = new EvaluationStore(join(dir, "evaluation.sqlite"));
  const service = new EvaluationService(store, { now: clk.now, id: () => `id-${++id}` });
  const fixture = createSyntheticEvaluationFixture();
  service.importProtocol(fixture.protocol);
  service.importStudyPack(fixture.pack);
  const assigned = service.generateAssignments({
    protocolId: fixture.protocol.protocolId,
    protocolVersion: fixture.protocol.version,
    packId: fixture.pack.packId,
    packVersion: fixture.pack.version,
    participantId: fixture.participantId,
    seed: fixture.seed,
    trialSubjectKind,
  }).trials;
  const trial = assigned[0]!;
  return { dir, clk, store, service, fixture, trial, trials: assigned };
}

test("stable identifiers tie evaluation records to Harness-visible versions", () => {
  const { service, fixture, trial } = setup();
  const repeat = service.generateAssignments({
    protocolId: fixture.protocol.protocolId,
    protocolVersion: fixture.protocol.version,
    packId: fixture.pack.packId,
    packVersion: fixture.pack.version,
    participantId: fixture.participantId,
    seed: fixture.seed,
    trialSubjectKind: "synthetic",
  }).trials[0]!;
  assert.equal(trial.trialId, repeat.trialId);
  assert.equal(trial.protocolId, fixture.protocol.protocolId);
  assert.equal(trial.protocolVersion, fixture.protocol.version);
  assert.equal(trial.packId, fixture.pack.packId);
  assert.equal(trial.packVersion, fixture.pack.version);
  assert.equal(fixture.protocol.policyVariants.some((variant) => variant.policyId === trial.policyId && variant.policyVersion === trial.policyVersion), true);
});

test("assessment prompts stay out of the coaching surface until the checkpoint is opened", () => {
  const { service, trial } = setup();
  const status = JSON.stringify(service.trialStatus(trial.trialId));
  assert.equal(status.includes("Synthetic pretest"), false);
  assert.equal(status.includes("Synthetic immediate test"), false);
  const opened = service.openCheckpoint(trial.trialId, "pretest");
  assert.match(opened.form.prompt, /Before study|pretest/i);
});

test("custodian coaching surface omits all assessment and scorer material", () => {
  const { service, fixture } = setup();
  const surface = service.coachingSurface(fixture.pack.packId, fixture.pack.version, fixture.pack.microtopics[0]!.microtopicId);
  const serialized = JSON.stringify(surface);
  assert.equal(serialized.includes(fixture.pack.pretestForm.prompt), false);
  assert.equal(serialized.includes(fixture.pack.immediateForm.prompt), false);
  assert.equal(serialized.includes(fixture.pack.scoringMaterials.scoringGuidance), false);
  assert.equal("referenceAnswer" in surface, false);
});

test("blind scorer callback does not receive policy, interventions, previous scores, or expected condition", () => {
  const { service, trial } = setup();
  service.startTrial(trial.trialId);
  const checkpoint = service.openCheckpoint(trial.trialId, "immediate");
  service.recordInterventionObservation({
    trialId: trial.trialId,
    checkpointId: checkpoint.checkpoint.checkpointId,
    pedagogicalIntent: "keep moving",
    technique: "content hint",
    helpLevel: "content_hint",
    phase: "immediate",
    technicalWaitMs: 25,
    learnerNote: "too much help",
  });
  service.syntheticTestIngress("deterministic-fixture").recordArtifact(checkpoint.checkpoint.checkpointId, { kind: "text", content: "idea reason transfer" });
  const scorer = new RecordingScorer();
  service.assessCheckpoint(checkpoint.checkpoint.checkpointId, scorer);
  assert.ok(scorer.seen);
  assert.equal("policy" in scorer.seen!, false);
  assert.equal("policyVariant" in scorer.seen!, false);
  assert.equal("policyVariantId" in scorer.seen!, false);
  assert.equal("participantId" in scorer.seen!.taskSnapshot, false);
  assert.equal("interventionHistory" in scorer.seen!, false);
  assert.equal("previousScores" in scorer.seen!, false);
  assert.equal("expectedCondition" in scorer.seen!, false);
  assert.equal("helpCountByLevel" in scorer.seen!.taskSnapshot, false);
  assert.equal(scorer.seen!.scorerMetadata.scorerKind, "deterministic");
});

test("help records automatically contaminate the active checkpoint", () => {
  const { service, trial } = setup();
  service.startTrial(trial.trialId);
  const checkpoint = service.openCheckpoint(trial.trialId, "immediate");
  service.recordInterventionObservation({
    trialId: trial.trialId,
    checkpointId: checkpoint.checkpoint.checkpointId,
    pedagogicalIntent: "keep moving",
    technique: "content hint",
    helpLevel: "content_hint",
    phase: "immediate",
    technicalWaitMs: 25,
    learnerNote: "too much help",
  });
  const after = service.trialStatus(trial.trialId);
  assert.equal(after.checkpoints.find((item) => item.phase === "immediate")?.helpState.contaminated, true);
  assert.equal(after.checkpoints.find((item) => item.phase === "immediate")?.helpState.helpCountByLevel.content_hint, 1);
});

test("public artifact writers cannot bypass capability-bound ingresses", () => {
  const { service, trial } = setup("human");
  service.startTrial(trial.trialId);
  const checkpoint = service.openCheckpoint(trial.trialId, "pretest");
  assert.throws(() => (service as any).recordTrustedLearnerArtifact(checkpoint.checkpoint.checkpointId, { kind: "text", content: "forged" }), /capability-bound/);
  assert.throws(() => (service as any).recordSyntheticLearnerArtifact(checkpoint.checkpoint.checkpointId, { kind: "text", content: "forged", provenance: "ai-simulation" }), /capability-bound/);
});

test("intervention observations cannot cross trial or phase boundaries", () => {
  const { service, trials } = setup("synthetic");
  service.startTrial(trials[0]!.trialId);
  service.startTrial(trials[1]!.trialId);
  const checkpoint = service.openCheckpoint(trials[1]!.trialId, "immediate");
  assert.throws(() => service.recordInterventionObservation({ trialId: trials[0]!.trialId, checkpointId: checkpoint.checkpoint.checkpointId, pedagogicalIntent: "help", technique: "hint", helpLevel: "content_hint", phase: "immediate" }), /does not belong/);
  assert.throws(() => service.recordInterventionObservation({ trialId: trials[1]!.trialId, checkpointId: checkpoint.checkpoint.checkpointId, pedagogicalIntent: "help", technique: "hint", helpLevel: "content_hint", phase: "pretest" }), /does not match/);
});

test("unknown rubric measurements cannot be marked valid", () => {
  const { service, fixture, trial } = setup("synthetic");
  service.startTrial(trial.trialId);
  const checkpoint = service.openCheckpoint(trial.trialId, "pretest");
  service.syntheticTestIngress("deterministic-fixture").recordArtifact(checkpoint.checkpoint.checkpointId, { kind: "text", content: "idea" });
  const scorer = new (class implements Scorer {
    readonly scorerKind = "deterministic" as const; readonly scorerId = "unknown"; readonly scorerVersion = "1";
    score(): any { return { criteria: { idea: "unknown", reason: "unknown", transfer: "unknown" }, metCount: 0, unmetCount: 0, unknownCount: 3 }; }
  })();
  const assessed = service.assessCheckpoint(checkpoint.checkpoint.checkpointId, scorer);
  assert.equal(assessed.checkpoint.status, "invalid");
  assert.equal(service.trialStatus(trial.trialId).metrics.delayedOutcomeAvailability, false);
  assert.equal(fixture.protocol.scorerRequirements.allowedScorers.includes("deterministic"), true);
});

test("a delayed checkpoint cannot be created for a planned trial", () => {
  const { service, trial } = setup("synthetic");
  assert.throws(() => service.openCheckpoint(trial.trialId, "delayed"), /started trial/);
});

test("premature delayed checkpoints stay not-yet-due", () => {
  const { service, trial } = setup();
  service.startTrial(trial.trialId);
  const delayed = service.openCheckpoint(trial.trialId, "delayed");
  assert.equal(delayed.checkpoint.status, "not-yet-due");
  assert.throws(() => service.syntheticTestIngress("deterministic-fixture").recordArtifact(delayed.checkpoint.checkpointId, { kind: "text", content: "idea reason transfer" }), /not yet due/);
  assert.equal(service.trialStatus(trial.trialId).checkpoints.find((item) => item.phase === "delayed")?.status, "not-yet-due");
});

test("trial-started rubric and task material remain immutable snapshots", () => {
  const { service, fixture, trial } = setup();
  (fixture.pack.pretestForm as any).prompt = "MUTATED";
  (fixture.pack.rubric[0] as any).description = "MUTATED";
  const opened = service.openCheckpoint(trial.trialId, "pretest");
  assert.notEqual(opened.form.prompt, "MUTATED");
  assert.equal(service.trialStatus(trial.trialId).trial.packVersion, fixture.pack.version);
});

test("persisted protocol, pack, and policy snapshots reject mutation after trial start", () => {
  const { service, fixture, trial, store } = setup();
  service.startTrial(trial.trialId);
  assert.throws(() => store.upsertStudyPack({ ...fixture.pack, pretestForm: { ...fixture.pack.pretestForm, prompt: "MUTATED" } }), /immutable after trial start/);
  assert.throws(() => store.upsertProtocol({ ...fixture.protocol, hypothesis: "MUTATED" }), /immutable after trial start/);
  const policy = fixture.protocol.policyVariants.find((candidate) => candidate.policyId === trial.policyId && candidate.policyVersion === trial.policyVersion)!;
  assert.throws(() => store.upsertPolicyVariant({ ...policy, description: "MUTATED" }), /immutable after trial start/);
});

test("checkpoint task snapshot and scorer requirements are fail-closed", () => {
  const { service, fixture, trial, store } = setup("synthetic");
  service.importProtocol({ ...fixture.protocol, scorerRequirements: { ...fixture.protocol.scorerRequirements, allowedScorers: ["deterministic"] } });
  service.startTrial(trial.trialId);
  const opened = service.openCheckpoint(trial.trialId, "pretest");
  assert.throws(() => store.upsertCheckpoint({ ...opened.checkpoint, taskId: "tampered" }), /immutable snapshot field/);
  service.syntheticTestIngress("deterministic-fixture").recordArtifact(opened.checkpoint.checkpointId, { kind: "text", content: "idea reason transfer" });
  assert.throws(() => service.assessCheckpoint(opened.checkpoint.checkpointId, new ManualTrustedScorer("human", "1", { criteria: { idea: "met", reason: "met", transfer: "met" }, metCount: 3, unmetCount: 0, unknownCount: 0 })), /not allowed/);
});

test("comparison report still groups scored results by policy after blind scoring", () => {
  const { service, fixture, trials } = setup();
  for (const trial of trials.slice(0, 2)) {
    service.startTrial(trial.trialId);
    const checkpoint = service.openCheckpoint(trial.trialId, "pretest");
    service.syntheticTestIngress("deterministic-fixture").recordArtifact(checkpoint.checkpoint.checkpointId, { kind: "text", content: "idea reason transfer" });
    service.assessCheckpoint(checkpoint.checkpoint.checkpointId, new DeterministicFixtureScorer("det", "1"));
  }
  const report = service.syntheticBehavioralReport(fixture.protocol.protocolId, fixture.protocol.version, fixture.pack.packId, fixture.pack.version, fixture.participantId, fixture.seed);
  assert.ok(report.variantSummaries.length >= 1);
  assert.ok(new Set(report.variantSummaries.map((summary) => summary.policyId)).size >= 1);
});

test("research export is bound to previewId plus explicit confirmation", () => {
  const { service, fixture, trial, dir } = setup("human");
  service.startTrial(trial.trialId);
  const checkpoint = service.openCheckpoint(trial.trialId, "pretest");
  service.trustedHumanIngress().recordArtifact(checkpoint.checkpoint.checkpointId, { kind: "text", content: "idea reason transfer" });
  service.assessCheckpoint(checkpoint.checkpoint.checkpointId, new ManualTrustedScorer("human", "1", { criteria: { idea: "met", reason: "met", transfer: "met" }, metCount: 3, unmetCount: 0, unknownCount: 0 }));
  const out = join(dir, "research");
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
  }), /explicit confirmation/);
});
