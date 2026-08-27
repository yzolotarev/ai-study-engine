import { createSyntheticBenchmarkMatrix, createSyntheticEvaluationFixture } from "./fixtures.js";
import { sha256Hex, stableStringify } from "./hash.js";
import { DeterministicFixtureScorer } from "./scoring.js";
import { EvaluationService } from "./service.js";
import { EvaluationStore } from "./store.js";
import { SYNTHETIC_BEHAVIORAL_WARNING } from "./types.js";
import type { PolicyRuntimeTrace } from "./policy-runtime.js";
import type { SyntheticBenchmarkReport, SyntheticHelpMode, SyntheticReadiness } from "./types.js";

const phaseContent: Record<SyntheticReadiness, { readonly pretest: string; readonly immediate: string; readonly transfer: string; readonly delayed: string }> = {
  cold: { pretest: "idea", immediate: "idea reason", transfer: "idea reason transfer", delayed: "idea reason transfer" },
  partial: { pretest: "idea reason", immediate: "idea reason", transfer: "idea reason transfer", delayed: "idea reason transfer" },
  ready: { pretest: "idea reason transfer", immediate: "idea reason transfer", transfer: "idea reason transfer", delayed: "idea reason transfer" },
  overfit: { pretest: "idea reason", immediate: "idea reason transfer", transfer: "idea reason transfer", delayed: "idea reason transfer" },
};

function runtimeInput(readiness: SyntheticReadiness, helpMode: SyntheticHelpMode): Parameters<EvaluationService["executePolicy"]>[1] {
  const criteria: Record<string, "met" | "unmet" | "unknown"> = readiness === "cold"
    ? { idea: "unknown", reason: "unknown", transfer: "unknown" }
    : readiness === "partial" || readiness === "overfit"
      ? { idea: "met", reason: "met", transfer: "unknown" }
      : { idea: "met", reason: "met", transfer: "met" };
  return {
    phase: "pretest",
    criteria,
    attemptContaminated: helpMode === "process_prompt",
    helpExposureCount: helpMode === "process_prompt" ? 1 : 0,
    cleanAttemptAvailable: helpMode === "process_prompt",
    sessionElapsedMs: 1_000,
    sessionBudgetMs: 600_000,
    delayedDue: false,
    requiredTransfer: true,
    requiredDelayed: true,
  };
}

function runCell(cell: ReturnType<typeof createSyntheticBenchmarkMatrix>[number], index: number): SyntheticBenchmarkReport["cells"][number] {
  const base = createSyntheticEvaluationFixture();
  const policy = base.protocol.policyVariants.find((variant) => variant.policyId === cell.policyId && variant.policyVersion === cell.policyVersion);
  if (!policy) throw new Error(`unknown matrix policy ${cell.policyId}@${cell.policyVersion}`);
  const sourceSet = base.pack.matchedSets[index % base.pack.matchedSets.length]!;
  const microtopicId = sourceSet.microtopicIds[index % sourceSet.microtopicIds.length]!;
  const microtopics = sourceSet.microtopicIds.map((id) => base.pack.microtopics.find((item) => item.microtopicId === id)!);
  const pack = {
    ...base.pack,
    packId: `${base.pack.packId}.${index}`,
    matchedSets: [sourceSet],
    microtopics,
    metadata: { ...base.pack.metadata, notes: `Synthetic benchmark cell ${index}` },
  };
  const protocol = {
    ...base.protocol,
    protocolId: `${base.protocol.protocolId}.${index}`,
    policyVariants: [policy],
    metadata: { ...base.protocol.metadata, notes: `Synthetic benchmark cell ${index}` },
  };
  let clockMs = Date.parse("2026-01-01T00:00:00.000Z");
  const store = new EvaluationStore(":memory:", { datasetKind: "synthetic" });
  const service = new EvaluationService(store, { now: () => new Date(clockMs).toISOString() });
  try {
    service.importProtocol(protocol);
    service.importStudyPack(pack);
    const assignedTrials = service.generateAssignments({
      protocolId: protocol.protocolId,
      protocolVersion: protocol.version,
      packId: pack.packId,
      packVersion: pack.version,
      participantId: `synthetic-cell-${index}`,
      seed: cell.seed,
      trialSubjectKind: "synthetic",
    }).trials;
    const trial = assignedTrials.find((candidate) => candidate.microtopicId === microtopicId)!;
    service.startTrial(trial.trialId);
    const policyDecision: PolicyRuntimeTrace = service.executePolicy(trial.trialId, runtimeInput(cell.readiness, cell.helpMode));
    const ingress = service.syntheticTestIngress("deterministic-fixture");
    for (const phase of ["pretest", "immediate", "transfer"] as const) {
      const checkpoint = service.openCheckpoint(trial.trialId, phase).checkpoint;
      if (phase === "pretest" && cell.helpMode === "process_prompt") {
        service.recordInterventionObservation({ trialId: trial.trialId, checkpointId: checkpoint.checkpointId, pedagogicalIntent: "minimal_remediation", technique: "process cue", helpLevel: "process_prompt", phase });
      }
      ingress.recordArtifact(checkpoint.checkpointId, { kind: "text", content: phaseContent[cell.readiness][phase] });
      service.assessCheckpoint(checkpoint.checkpointId, new DeterministicFixtureScorer("benchmark-deterministic", "1"));
    }
    clockMs += 86_400_001;
    const delayed = service.openCheckpoint(trial.trialId, "delayed").checkpoint;
    ingress.recordArtifact(delayed.checkpointId, { kind: "text", content: phaseContent[cell.readiness].delayed });
    service.assessCheckpoint(delayed.checkpointId, new DeterministicFixtureScorer("benchmark-deterministic", "1"));
    const report = service.syntheticBehavioralReport(protocol.protocolId, protocol.version, pack.packId, pack.version, `synthetic-cell-${index}`, cell.seed);
    const reportCell = report.cells.find((candidate) => candidate.trialId === trial.trialId);
    if (!reportCell) throw new Error("synthetic cell report was empty");
    return {
      fixtureId: cell.fixtureId,
      seed: cell.seed,
      readiness: cell.readiness,
      helpMode: cell.helpMode,
      policyId: cell.policyId,
      policyVersion: cell.policyVersion,
      trialId: trial.trialId,
      reportCell,
      policyDecision: {
        action: policyDecision.action.intent,
        intent: policyDecision.action.intent,
        reasonCode: policyDecision.action.reasonCode,
        traceFingerprint: policyDecision.traceFingerprint,
      },
    };
  } finally {
    store.close();
  }
}

export function runSyntheticBenchmark(): SyntheticBenchmarkReport {
  const matrix = createSyntheticBenchmarkMatrix();
  const cells: SyntheticBenchmarkReport["cells"][number][] = [];
  const failures: SyntheticBenchmarkReport["failures"][number][] = [];
  matrix.forEach((cell, index) => {
    try {
      cells.push(runCell(cell, index));
    } catch (error) {
      failures.push({ ...cell, error: error instanceof Error ? error.message : String(error) });
    }
  });
  const digest = sha256Hex(stableStringify({ matrixSize: matrix.length, cells, failures } as never));
  return {
    reportKind: "synthetic-software-behavioral-benchmark",
    warning: SYNTHETIC_BEHAVIORAL_WARNING,
    matrixSize: matrix.length,
    completedCells: cells.length,
    failedCells: failures.length,
    failures,
    cells,
    deterministicDigest: digest,
    limitations: [
      "All cells are deterministic synthetic software/behavioral checks, not human learning evidence.",
      "Readiness and help modes are fixture parameters; they do not estimate human personas or efficacy.",
      "The benchmark uses isolated in-memory synthetic stores and cannot validate end-user UI or physical authorship.",
    ],
  };
}
