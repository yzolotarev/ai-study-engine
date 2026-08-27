#!/usr/bin/env -S node --import tsx
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createSyntheticEvaluationFixture,
  createSyntheticBenchmarkMatrix,
  DeterministicFixtureScorer,
  EvaluationService,
  EvaluationStore,
  ManualTrustedScorer,
  FutureAiSemanticScorer,
  restoreEncryptedBackup,
  runSyntheticBenchmark,
  type CheckpointPhase,
  type NewTrialSubjectKind,
} from "./src/evaluation/index.js";

const HELP = `Evaluation Layer v0 CLI

Commands:
  validate-protocol <protocolJson|@file>
  validate-pack <packJson|@file>
  create-protocol <protocolJson|@file>
  import-pack <packJson|@file>
  assign <protocolId> <protocolVersion> <packId> <packVersion> <participantId> <seed> <human|synthetic>
  start-trial <trialId>
  resume-trial <trialId>
  policy-decision <trialId> <runtimeInputJson>
  open-checkpoint <trialId> <pretest|immediate|transfer|delayed>
  record-artifact <checkpointId> <kind> <content> [provenanceNote]  # trusted human ingress only
  record-synthetic-artifact <checkpointId> <kind> <content> <deterministic-fixture|ai-simulation> [provenanceNote]
  record-intervention <trialId> <json>
  record-incident <trialId> <json>
  subjective-feedback <trialId> <json>
  assess-checkpoint <checkpointId> <trusted-human|deterministic|ai-semantic> <scorerId> <scorerVersion> [vectorJson]
  show-due-delayed
  trial-status <trialId>
  integrity-check
  backup <destinationPath>
  backup-encrypted <destinationPath>  # passphrase from EVAL_BACKUP_PASSPHRASE
  restore-encrypted <sourcePath> <destinationPath>  # passphrase from EVAL_BACKUP_PASSPHRASE
  delete-participant <participantId> --confirm "DELETE <participantId>"
  comparison-report <protocolId> <protocolVersion> <packId> <packVersion> <participantId> <seed>
  synthetic-behavioral-report <protocolId> <protocolVersion> <packId> <packVersion> <participantId> <seed>
  synthetic-matrix
  synthetic-benchmark
  preview-export <summary|research> <protocolId> <protocolVersion> <packId> <packVersion> <participantId> <seed> <outputDirectory> [trialIdsJson]
  export-bundle <summary|research> <protocolId> <protocolVersion> <packId> <packVersion> <participantId> <seed> <outputDirectory> --preview-id <id> [--confirm] [trialIdsJson]
  smoke-fixture
`;

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function parseJsonArg(value: string): unknown {
  if (value.startsWith("@")) {
    return JSON.parse(readFileSync(resolve(value.slice(1)), "utf8"));
  }
  return JSON.parse(value);
}

function parseOptionalJsonArg(value: string | undefined): unknown | undefined {
  return value === undefined ? undefined : parseJsonArg(value);
}

/**
 * Validation is an operator-facing command.  A successful pack validation must
 * never echo assessment material, because stdout can be copied into a chat,
 * log, or CI artifact visible to the learner.  Keep the full pack available to
 * the service internally, but expose metadata only at this boundary.
 */
function safePackValidationResult(result: unknown): unknown {
  if (!result || typeof result !== "object" || (result as { ok?: unknown }).ok !== true) return result;
  const value = (result as { value?: unknown }).value;
  if (!value || typeof value !== "object") return result;
  const pack = value as Record<string, unknown>;
  const forms = [pack.pretestForm, pack.immediateForm, pack.transferForm, pack.delayedForm]
    .filter((form): form is Record<string, unknown> => Boolean(form) && typeof form === "object");
  const microtopics = Array.isArray(pack.microtopics) ? pack.microtopics : [];
  const matchedSets = Array.isArray(pack.matchedSets) ? pack.matchedSets : [];
  const rubric = Array.isArray(pack.rubric) ? pack.rubric : [];
  const metadata = pack.metadata && typeof pack.metadata === "object" ? pack.metadata as Record<string, unknown> : {};
  return {
    ok: true,
    value: {
      packId: pack.packId,
      version: pack.version,
      domain: pack.domain,
      sourceReferenceCount: Array.isArray(pack.sourceReferences) ? pack.sourceReferences.length : 0,
      matchedSetIds: matchedSets.map((item) => item && typeof item === "object" ? (item as Record<string, unknown>).matchedSetId : undefined),
      microtopicIds: microtopics.map((item) => item && typeof item === "object" ? (item as Record<string, unknown>).microtopicId : undefined),
      rubricIds: rubric.map((item) => item && typeof item === "object" ? (item as Record<string, unknown>).id : undefined),
      formIds: forms.map((form) => form.formId),
      assessmentFormCount: forms.length,
      classification: metadata.classification,
      schemaVersion: metadata.schemaVersion,
      scoringMaterialsPresent: Boolean(pack.scoringMaterials && typeof pack.scoringMaterials === "object"),
    },
    issues: (result as { issues?: unknown }).issues ?? [],
  };
}

function phase(value: string): CheckpointPhase {
  if (value === "pretest" || value === "immediate" || value === "transfer" || value === "delayed") return value;
  throw new Error("phase must be pretest, immediate, transfer, or delayed");
}

function trialSubjectKind(value: string): NewTrialSubjectKind {
  if (value === "human" || value === "synthetic") return value;
  throw new Error("trialSubjectKind must be human or synthetic");
}

function main(): void {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "--help" || command === "help") {
    console.log(HELP);
    return;
  }

  const datasetKind = process.env.EVAL_DATASET_KIND;
  if (datasetKind !== undefined && datasetKind !== "human" && datasetKind !== "synthetic" && datasetKind !== "mixed") throw new Error("EVAL_DATASET_KIND must be human, synthetic, or mixed");
  const store = new EvaluationStore(process.env.EVAL_DB ?? ".study-engine/evaluation.sqlite", datasetKind === undefined ? {} : { datasetKind: datasetKind as "human" | "synthetic" | "mixed" });
  const service = new EvaluationService(store);

  try {
    let result: unknown;
    switch (command) {
      case "validate-protocol":
        result = service.validateProtocol(parseJsonArg(required(args[0], "protocolJson")));
        break;
      case "validate-pack":
        result = safePackValidationResult(service.validateStudyPack(parseJsonArg(required(args[0], "packJson"))));
        break;
      case "create-protocol":
        result = service.importProtocol(parseJsonArg(required(args[0], "protocolJson")) as any);
        break;
      case "import-pack":
        result = service.importStudyPack(parseJsonArg(required(args[0], "packJson")) as any);
        break;
      case "assign":
        result = service.generateAssignments({
          protocolId: required(args[0], "protocolId"),
          protocolVersion: Number(required(args[1], "protocolVersion")),
          packId: required(args[2], "packId"),
          packVersion: Number(required(args[3], "packVersion")),
          participantId: required(args[4], "participantId"),
          seed: required(args[5], "seed"),
          trialSubjectKind: trialSubjectKind(required(args[6], "trialSubjectKind")),
        });
        break;
      case "start-trial":
        result = service.startTrial(required(args[0], "trialId"));
        break;
      case "resume-trial":
        result = service.resumeTrial(required(args[0], "trialId"));
        break;
      case "policy-decision":
        result = service.executePolicy(required(args[0], "trialId"), parseJsonArg(required(args[1], "runtimeInputJson")) as any);
        break;
      case "open-checkpoint":
        result = service.openCheckpoint(required(args[0], "trialId"), phase(required(args[1], "phase")));
        break;
      case "record-artifact":
        result = service.trustedHumanIngress().recordArtifact(required(args[0], "checkpointId"), {
          kind: required(args[1], "kind") as "text" | "voice" | "map" | "canvas",
          content: required(args[2], "content"),
          ...(args[3] ? { provenanceNote: args[3] } : {}),
        });
        break;
      case "record-synthetic-artifact": {
        const provenance = required(args[3], "provenance");
        if (provenance !== "deterministic-fixture" && provenance !== "ai-simulation") {
          throw new Error("synthetic provenance must be deterministic-fixture or ai-simulation");
        }
        result = service.syntheticTestIngress(provenance).recordArtifact(required(args[0], "checkpointId"), {
          kind: required(args[1], "kind") as "text" | "voice" | "map" | "canvas",
          content: required(args[2], "content"),
          ...(args[4] ? { provenanceNote: args[4] } : {}),
        });
        break;
      }
      case "record-intervention":
        result = service.recordInterventionObservation(parseJsonArg(required(args[1], "json")) as any);
        break;
      case "record-incident":
        result = service.recordCriticalIncident(parseJsonArg(required(args[1], "json")) as any);
        break;
      case "subjective-feedback":
        result = service.recordSubjectiveFeedback(parseJsonArg(required(args[1], "json")) as any);
        break;
      case "assess-checkpoint": {
        const kind = required(args[1], "scorerKind");
        const scorerId = required(args[2], "scorerId");
        const scorerVersion = required(args[3], "scorerVersion");
        const vector = parseOptionalJsonArg(args[4]);
        let scorer;
        if (kind === "trusted-human") {
          if (!vector) throw new Error("trusted-human scoring requires vectorJson");
          scorer = new ManualTrustedScorer(scorerId, scorerVersion, vector as any);
        } else if (kind === "deterministic") {
          scorer = new DeterministicFixtureScorer(scorerId, scorerVersion);
        } else if (kind === "ai-semantic") {
          if (!vector) throw new Error("ai-semantic scoring requires vectorJson in v0");
          scorer = new FutureAiSemanticScorer(scorerId, scorerVersion);
          // The scorer object is intentionally not used for real AI calls in v0.
          result = service.assessCheckpoint(required(args[0], "checkpointId"), scorer, { vector: vector as any });
          break;
        } else {
          throw new Error("scorerKind must be trusted-human, deterministic, or ai-semantic");
        }
        result = service.assessCheckpoint(required(args[0], "checkpointId"), scorer);
        break;
      }
      case "show-due-delayed":
        result = service.showDueDelayedTests();
        break;
      case "trial-status":
        result = service.trialStatus(required(args[0], "trialId"));
        break;
      case "integrity-check":
        result = store.integrityCheck();
        break;
      case "backup":
        store.backupTo(required(args[0], "destinationPath"));
        result = { backedUp: true, destinationPath: required(args[0], "destinationPath") };
        break;
      case "backup-encrypted": {
        const passphrase = process.env.EVAL_BACKUP_PASSPHRASE;
        if (!passphrase) throw new Error("EVAL_BACKUP_PASSPHRASE is required for encrypted backup");
        const destinationPath = required(args[0], "destinationPath");
        store.backupToEncrypted(destinationPath, passphrase);
        result = { backedUp: true, encrypted: true, destinationPath };
        break;
      }
      case "restore-encrypted": {
        const passphrase = process.env.EVAL_BACKUP_PASSPHRASE;
        if (!passphrase) throw new Error("EVAL_BACKUP_PASSPHRASE is required for encrypted restore");
        const sourcePath = required(args[0], "sourcePath");
        const destinationPath = required(args[1], "destinationPath");
        restoreEncryptedBackup(sourcePath, destinationPath, passphrase);
        result = { restored: true, encrypted: true, sourcePath, destinationPath };
        break;
      }
      case "delete-participant": {
        const participantId = required(args[0], "participantId");
        const confirmIndex = args.indexOf("--confirm");
        const confirmation = confirmIndex >= 0 ? required(args[confirmIndex + 1], "confirmation") : "";
        result = service.deleteParticipantData(participantId, confirmation);
        break;
      }
      case "comparison-report":
        result = service.comparisonReport(required(args[0], "protocolId"), Number(required(args[1], "protocolVersion")), required(args[2], "packId"), Number(required(args[3], "packVersion")), required(args[4], "participantId"), required(args[5], "seed"));
        break;
      case "synthetic-behavioral-report":
        result = service.syntheticBehavioralReport(required(args[0], "protocolId"), Number(required(args[1], "protocolVersion")), required(args[2], "packId"), Number(required(args[3], "packVersion")), required(args[4], "participantId"), required(args[5], "seed"));
        break;
      case "synthetic-matrix":
        result = createSyntheticBenchmarkMatrix();
        break;
      case "synthetic-benchmark":
        result = runSyntheticBenchmark();
        break;
      case "preview-export": {
        const mode = required(args[0], "mode") as "summary" | "research";
        const trialIds = args[8] ? (parseJsonArg(args[8]) as readonly string[]) : undefined;
        result = service.previewExport({
          mode,
          protocolId: required(args[1], "protocolId"),
          protocolVersion: Number(required(args[2], "protocolVersion")),
          packId: required(args[3], "packId"),
          packVersion: Number(required(args[4], "packVersion")),
          participantId: required(args[5], "participantId"),
          seed: required(args[6], "seed"),
          outputDirectory: required(args[7], "outputDirectory"),
          ...(trialIds ? { trialIds } : {}),
        });
        break;
      }
      case "export-bundle": {
        const mode = required(args[0], "mode") as "summary" | "research";
        const protocolId = required(args[1], "protocolId");
        const protocolVersion = Number(required(args[2], "protocolVersion"));
        const packId = required(args[3], "packId");
        const packVersion = Number(required(args[4], "packVersion"));
        const participantId = required(args[5], "participantId");
        const seed = required(args[6], "seed");
        const outputDirectory = required(args[7], "outputDirectory");
        let previewId: string | undefined;
        let confirm = false;
        let trialIds: readonly string[] | undefined;
        for (const token of args.slice(8)) {
          if (token === "--confirm") {
            confirm = true;
            continue;
          }
          if (token === "--preview-id") {
            previewId = required(args[args.indexOf(token) + 1], "previewId");
            continue;
          }
          if (!trialIds && !token.startsWith("--")) {
            trialIds = parseJsonArg(token) as readonly string[];
          }
        }
        result = service.exportBundle({
          mode,
          protocolId,
          protocolVersion,
          packId,
          packVersion,
          participantId,
          seed,
          outputDirectory,
          ...(previewId ? { previewId } : {}),
          confirm,
          ...(trialIds ? { trialIds } : {}),
        });
        break;
      }
      case "smoke-fixture": {
        const fixture = createSyntheticEvaluationFixture();
        result = { protocol: fixture.protocol.protocolId, pack: fixture.pack.packId, participantId: fixture.participantId, seed: fixture.seed };
        break;
      }
      default:
        throw new Error(`Unknown command: ${command}`);
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    store.close();
  }
}

main();
