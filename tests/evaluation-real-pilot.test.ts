import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  createSyntheticEvaluationFixture,
  DeterministicFixtureScorer,
  EvaluationService,
  EvaluationStore,
  ManualTrustedScorer,
  type CheckpointRubricVector,
  type Scorer,
  type ScorerInput,
} from "../src/evaluation/index.js";

const protocolPath = resolve("docs/evaluation/real-pilot/pilot.methodology.usability.v1.protocol.json");
const packPath = resolve("docs/evaluation/real-pilot/methodology.learning-vs-performance.v1.pack.json");
const rotatedPackPath = resolve("docs/evaluation/real-pilot/methodology.learning-vs-performance.v2.pack.json");

function clock(start = "2026-01-01T00:00:00.000Z") {
  let ms = Date.parse(start);
  return {
    now: () => new Date(ms).toISOString(),
    advance: (delta: number) => { ms += delta; },
  };
}

class ProbeScorer implements Scorer {
  readonly scorerKind = "deterministic" as const;
  readonly scorerId = "probe-scorer";
  readonly scorerVersion = "1";
  public seen?: ScorerInput;
  score(input: ScorerInput): CheckpointRubricVector {
    this.seen = input;
    return { criteria: { LP_DISTINCTION: "met", CONFOUND_DETECTION: "met", EVIDENCE_DESIGN: "met", ADAPTIVE_DECISION: "met" } as const, metCount: 4, unmetCount: 0, unknownCount: 0 } as const;
  }
}

function loadJson(path: string): any {
  return JSON.parse(readFileSync(path, "utf8"));
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "real-pilot-"));
  const clk = clock();
  let id = 0;
  const store = new EvaluationStore(join(dir, "evaluation.sqlite"));
  const service = new EvaluationService(store, { now: clk.now, id: () => `id-${++id}` });
  const protocol = loadJson(protocolPath);
  const pack = loadJson(packPath);
  const protocolValidation = service.validateProtocol(protocol);
  const packValidation = service.validateStudyPack(pack);
  assert.equal(protocolValidation.ok, true);
  assert.equal(packValidation.ok, true);
  service.importProtocol(protocol);
  service.importStudyPack(pack);
  const assigned = service.generateAssignments({
    protocolId: protocol.protocolId,
    protocolVersion: protocol.version,
    packId: pack.packId,
    packVersion: pack.version,
    participantId: "self-pilot-01",
    seed: "pilot-seed-001",
    trialSubjectKind: "human",
  }).trials;
  return { dir, clk, store, service, protocol, pack, assigned };
}

test("real pilot StudyPack validates, imports, and does not start a trial by itself", () => {
  const { service, protocol, pack } = setup();
  assert.equal(service.trialStatus(service.generateAssignments({
    protocolId: protocol.protocolId,
    protocolVersion: protocol.version,
    packId: pack.packId,
    packVersion: pack.version,
    participantId: "self-pilot-01",
    seed: "pilot-seed-001",
    trialSubjectKind: "human",
  }).trials[0]!.trialId).trial.status, "planned");
  assert.equal(protocol.metadata.notes?.toLowerCase().includes("calibration/usability pilot"), true);
  assert.equal(pack.metadata.notes?.toLowerCase().includes("calibration/usability pilot"), true);
});

test("CLI pack validation exposes metadata only and never echoes assessment material", () => {
  const dir = mkdtempSync(join(tmpdir(), "real-pilot-cli-validation-"));
  const pack = loadJson(packPath);
  const output = execFileSync("node", ["--import", "tsx", resolve("evaluation-cli.ts"), "validate-pack", `@${packPath}`], {
    env: { ...process.env, EVAL_DB: join(dir, "evaluation.sqlite") },
    encoding: "utf8",
  });
  const parsed = JSON.parse(output);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.packId, pack.packId);
  assert.equal(parsed.value.assessmentFormCount, 4);
  for (const secret of [
    pack.pretestForm.prompt,
    pack.immediateForm.prompt,
    pack.transferForm.prompt,
    pack.delayedForm.prompt,
    pack.scoringMaterials.scoringGuidance,
    pack.scoringMaterials.referenceAnswer,
  ]) {
    assert.equal(output.includes(secret), false);
  }
});

test("rotated v2 StudyPack validates as a fresh calibration pack", () => {
  const pack = loadJson(rotatedPackPath);
  const service = new EvaluationService(new EvaluationStore(":memory:"));
  const validation = service.validateStudyPack(pack);
  assert.equal(validation.ok, true);
  assert.equal(pack.packId, "methodology.learning-vs-performance.v2");
  assert.equal(pack.version, 2);
  assert.equal(pack.metadata.classification, "calibration-only");
  assert.equal(new Set([pack.pretestForm.prompt, pack.immediateForm.prompt, pack.transferForm.prompt, pack.delayedForm.prompt]).size, 4);
});

test("real pilot assessment prompts stay out of the coaching surface before checkpoint open", () => {
  const { service, assigned, pack } = setup();
  const status = JSON.stringify(service.trialStatus(assigned[0]!.trialId));
  assert.equal(status.includes(pack.pretestForm.prompt), false);
  assert.equal(status.includes(pack.immediateForm.prompt), false);
  assert.equal(status.includes(pack.transferForm.prompt), false);
  assert.equal(status.includes(pack.delayedForm.prompt), false);
  const opened = service.openCheckpoint(assigned[0]!.trialId, "pretest");
  assert.equal(opened.form.prompt, pack.pretestForm.prompt);
});

test("real pilot forms are materially distinct", () => {
  const { pack } = setup();
  const prompts = [pack.pretestForm.prompt, pack.immediateForm.prompt, pack.transferForm.prompt, pack.delayedForm.prompt];
  assert.equal(new Set(prompts).size, 4);
  assert.notEqual(pack.pretestForm.prompt, pack.transferForm.prompt);
  assert.notEqual(pack.immediateForm.prompt, pack.delayedForm.prompt);
});

test("real pilot scorer callback is blind to policy, interventions, previous scores, and expected condition", () => {
  const { service, assigned } = setup();
  const trialId = assigned[0]!.trialId;
  service.startTrial(trialId);
  const checkpoint = service.openCheckpoint(trialId, "immediate");
  service.recordInterventionObservation({
    trialId,
    checkpointId: checkpoint.checkpoint.checkpointId,
    pedagogicalIntent: "minimal orientation",
    technique: "process prompt",
    helpLevel: "process_prompt",
    phase: "immediate",
    learnerNote: "orientation only",
  });
  service.trustedHumanIngress().recordArtifact(checkpoint.checkpoint.checkpointId, { kind: "text", content: "ученик сам отвечает" });
  const scorer = new ProbeScorer();
  service.assessCheckpoint(checkpoint.checkpoint.checkpointId, scorer);
  assert.ok(scorer.seen);
  assert.equal("policy" in scorer.seen!, false);
  assert.equal("policyVariant" in scorer.seen!, false);
  assert.equal("policyVariantId" in scorer.seen!, false);
  assert.equal("interventionHistory" in scorer.seen!, false);
  assert.equal("previousScores" in scorer.seen!, false);
  assert.equal("expectedCondition" in scorer.seen!, false);
  assert.equal("participantId" in scorer.seen!.taskSnapshot, false);
  assert.equal("helpCountByLevel" in scorer.seen!.taskSnapshot, false);
  assert.equal(scorer.seen!.scorerMetadata.scorerKind, "deterministic");
});

test("real pilot delayed checkpoint stays not-yet-due until the ledger clock reaches the due time", () => {
  const { service, assigned, clk } = setup();
  const trialId = assigned[0]!.trialId;
  service.startTrial(trialId);
  const delayed = service.openCheckpoint(trialId, "delayed");
  assert.equal(delayed.checkpoint.status, "not-yet-due");
  assert.equal(delayed.form.prompt.includes("not yet due"), true);
  assert.throws(() => service.trustedHumanIngress().recordArtifact(delayed.checkpoint.checkpointId, { kind: "text", content: "ученик сам отвечает" }), /not yet due/);
  clk.advance(48 * 60 * 60 * 1000 + 1);
  const due = service.openCheckpoint(trialId, "delayed");
  service.trustedHumanIngress().recordArtifact(due.checkpoint.checkpointId, { kind: "text", content: "ученик сам отвечает" });
  service.assessCheckpoint(due.checkpoint.checkpointId, new ManualTrustedScorer("human", "1", { criteria: { LP_DISTINCTION: "met", CONFOUND_DETECTION: "met", EVIDENCE_DESIGN: "met", ADAPTIVE_DECISION: "met" } as const, metCount: 4, unmetCount: 0, unknownCount: 0 } as const));
  assert.equal(service.trialStatus(trialId).checkpoints.find((checkpoint) => checkpoint.phase === "delayed")?.status, "valid");
});

test("real pilot snapshot remains immutable after start and real pack stays separate from synthetic fixtures", () => {
  const { service, assigned, pack, protocol } = setup();
  const synthetic = createSyntheticEvaluationFixture();
  const trialId = assigned[0]!.trialId;
  const opened = service.openCheckpoint(trialId, "pretest");
  (pack.pretestForm as any).prompt = "MUTATED";
  (pack.rubric[0] as any).description = "MUTATED";
  assert.notEqual(opened.form.prompt, "MUTATED");
  assert.notEqual(pack.packId, synthetic.pack.packId);
  assert.notEqual(protocol.protocolId, synthetic.protocol.protocolId);
});

test("pilot is marked calibration/usability and remains excluded from efficacy-style comparison claims", () => {
  const { service, protocol, pack } = setup();
  const report = service.comparisonReport(protocol.protocolId, protocol.version, pack.packId, pack.version, "self-pilot-01", "pilot-seed-001");
  assert.equal(protocol.metadata.notes?.toLowerCase().includes("calibration/usability pilot"), true);
  assert.equal(pack.metadata.notes?.toLowerCase().includes("exclude from efficacy comparison"), true);
  assert.equal(report.caution.some((item) => item.includes("statistical significance")), true);
});

test("real pack creation and validation do not create learner evidence or start a trial", () => {
  const { service, store, assigned } = setup();
  assert.equal(store.listTrials().every((trial) => trial.status === "planned"), true);
  assert.equal(service.trialStatus(assigned[0]!.trialId).trial.status, "planned");
});
