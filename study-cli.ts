#!/usr/bin/env -S node --import tsx
// CLI driver over the study-engine STUDY_TOOLS layer.
// Lets Hermes (or the user) drive a session: start / status / record.
//
// NOTE on protocol advancement:
// The demo handler study_record_artifact advances the protocol using a
// `completedArtifacts` JSON array of *artifactType* strings. The protocol
// executor's `requiredEvidence` uses different tokens (e.g. "preview_artifact"
// vs the artifactType "preview_material"). To make a real end-to-end pass, we
// map each artifactType to its protocol evidence token via the protocol def,
// and submit the evidence token list as completedArtifacts. This keeps the
// package code untouched while producing a working forward flow.
//
// Usage:
//   study-cli.ts start "<capability>" "<targetTask>" "<successCriteria>"
//   study-cli.ts status <sessionId>
//   study-cli.ts record <sessionId> <artifactType> '<artifactJson>' [targetId]
//   study-cli.ts record-event --subtype <subtype> --payload '<json>' [--session-id <id>] [--learner <id>] [--target-id <id>]
//        subtype: identify_key_terms | familiarity_scaffold | neighborhood_expansion
//        payload: {"source_text_length":N,"result_length":N,"nucleus":"..."|null}
//        The CLI records the sensory_input event and applies the contamination
//        side-effect to --target-id when the subtype calls for it. This is the
//        Variant A (synchronous CLI) entry point for external sensory tools.
//
// completedArtifacts is computed internally from a running list of evidence tokens.

import { StudyStore } from "./src/db/store.js";
import { STUDY_TOOLS } from "./extensions/study-engine/study-tools.js";
import { CONCEPTUAL_DIALOGUE_V1 } from "./src/protocols/conceptual-dialogue.js";
import { evaluateAfterSensoryEvent } from "./src/core/policy/engine.js";
import * as fs from "node:fs";

const DB = process.env.STUDY_DB || ".study-engine/study.sqlite";

// artifactType -> requiredEvidence token, derived from the protocol def
const TYPE_TO_EVIDENCE: Record<string, string> = {};
for (const node of CONCEPTUAL_DIALOGUE_V1.nodes) {
  // operation is the artifactType used by the demo handler
  TYPE_TO_EVIDENCE[node.operation] = node.requiredEvidence[0];
}

function find(name: string) {
  const t = STUDY_TOOLS.find((x) => x.name === name);
  if (!t) {
    console.error(`tool ${name} not found`);
    process.exit(1);
  }
  return t;
}

/** Minimal --flag value parser for the record-event command. */
function parseFlags(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else {
        out[key] = "true";
      }
    }
  }
  return out;
}

function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const store = new StudyStore(DB);
  // persistent evidence-token list across records in one process run is not
  // shared between invocations, so we accept a JSON file via STUDY_TAPE.
  const tapeFile = process.env.STUDY_TAPE || ".study-engine/tape.json";
  let tape: string[] = [];
  try {
    tape = JSON.parse(fs.readFileSync(tapeFile, "utf8"));
  } catch {
    tape = [];
  }

  try {
    if (cmd === "start") {
      const [capability, targetTask, successCriteria] = args;
      if (!capability || !targetTask || !successCriteria) {
        console.error('usage: start "<capability>" "<targetTask>" "<successCriteria>"');
        process.exit(1);
      }
      const res = find("study_start").handler(store, { capability, targetTask, successCriteria });
      tape = [];
      fs.writeFileSync(tapeFile, JSON.stringify(tape));
      console.log(JSON.stringify(res, null, 2));
    } else if (cmd === "status") {
      const [sessionId] = args;
      const res = find("study_status").handler(store, { sessionId });
      console.log(JSON.stringify(res, null, 2));
    } else if (cmd === "record") {
      const [sessionId, artifactType, artifactJson, targetId] = args;
      if (!sessionId || !artifactType || !artifactJson) {
        console.error('usage: record <sessionId> <artifactType> \'<artifactJson>\' [targetId]');
        process.exit(1);
      }
      const evidence = TYPE_TO_EVIDENCE[artifactType];
      if (evidence) tape.push(evidence);
      fs.writeFileSync(tapeFile, JSON.stringify(tape));
      const res = find("study_record_artifact").handler(store, {
        sessionId,
        artifactType,
        artifactJson,
        ...(targetId ? { targetId } : {}),
      });
      console.log(JSON.stringify(res, null, 2));
    } else if (cmd === "active-session") {
      // Returns the most recent session id (used by external sensory tools to
      // bind reported events). Prints the id, or empty string if none.
      const last = store.getLastSession();
      process.stdout.write((last?.id ?? "") + "\n");
    } else if (cmd === "record-event") {
      // Variant A entry point: external sensory tool reports one event.
      const opts = parseFlags(args);
      const subtype = opts.subtype;
      const payloadRaw = opts.payload;
      const learner = opts.learner || "external-tool";
      const sessionId = opts["session-id"] || store.getLastSession()?.id || null;
      const targetId = opts["target-id"] || null;
      if (!subtype || !payloadRaw) {
        console.error('usage: record-event --subtype <subtype> --payload \'<json>\' [--session-id <id>] [--learner <id>] [--target-id <id>]');
        process.exit(1);
      }
      let payload: { source_text_length?: number; result_length?: number; sourceTextLength?: number; resultLength?: number; nucleus?: string | null };
      try {
        payload = JSON.parse(payloadRaw);
      } catch {
        console.error("payload must be valid JSON");
        process.exit(1);
      }
      const VALID_SUBTYPES = ["identify_key_terms", "familiarity_scaffold", "neighborhood_expansion"];
      if (!VALID_SUBTYPES.includes(subtype)) {
        console.error(`unknown subtype '${subtype}'; expected one of ${VALID_SUBTYPES.join(", ")}`);
        process.exit(1);
      }
      const normPayload = {
        sourceTextLength: payload.sourceTextLength ?? payload.source_text_length ?? 0,
        resultLength: payload.resultLength ?? payload.result_length ?? 0,
        ...(payload.nucleus !== undefined ? { nucleus: payload.nucleus } : {}),
      };
      const eventId = store.recordSensoryEvent({
        learnerId: learner,
        studySessionId: sessionId,
        subtype,
        payload: normPayload,
      });
      let contaminationRecordId: string | undefined;
      if (targetId) {
        contaminationRecordId = store.openSensoryContamination({
          learnerId: learner,
          studySessionId: sessionId,
          targetId,
          subtype: subtype as "identify_key_terms" | "familiarity_scaffold" | "neighborhood_expansion",
          eventId,
        });
      }
      console.log(JSON.stringify({ eventId, contaminationRecordId: contaminationRecordId ?? null }, null, 2));

      // Execute-form wiring: (re)evaluate the active policy bundle so policies
      // keyed on sensory anchors fire. No-op if the session has no activation.
      if (sessionId) {
        const activation = store.getPolicyActivation(sessionId);
        if (activation) {
          const result = evaluateAfterSensoryEvent(store, { sessionId, targetId: targetId ?? undefined, eventId });
          const det = result.detections.find((d) => d.policyId === "bp_passive_consumption_after_sensory");
          console.error(`policy-eval: bp_passive_consumption_after_sensory=${det?.result ?? "n/a"} (confidence=${det?.confidence ?? "-"})`);
        }
      }
    } else if (cmd === "start-live") {
      const [capability, targetTask, successCriteria, retentionDays] = args;
      if (!capability || !targetTask || !successCriteria) {
        console.error('usage: start-live "<capability>" "<targetTask>" "<successCriteria>" [retentionDays]');
        process.exit(1);
      }
      const res = find("study_start").handler(store, {
        capability,
        targetTask,
        successCriteria,
        ...(retentionDays ? { retentionDays: Number(retentionDays) } : {}),
      });
      tape = [];
      fs.writeFileSync(tapeFile, JSON.stringify(tape));
      console.log(JSON.stringify(res, null, 2));
    } else if (cmd === "canvas") {
      const [sessionId] = args;
      if (!sessionId) { console.error("usage: canvas <sessionId>"); process.exit(1); }
      const res = find("study_capture_canvas").handler(store, { sessionId });
      console.log(JSON.stringify(res, null, 2));
    } else if (cmd === "confirm-canvas") {
      const [sessionId, observationIdsJson, note] = args;
      if (!sessionId || !observationIdsJson) { console.error('usage: confirm-canvas <sessionId> \'[ids]\' [note]'); process.exit(1); }
      let observationIds: string[];
      try { observationIds = JSON.parse(observationIdsJson); } catch { console.error("observationIds must be JSON array"); process.exit(1); }
      const res = find("study_confirm_canvas").handler(store, {
        sessionId, observationIds, ...(note ? { note } : {}),
      });
      console.log(JSON.stringify(res, null, 2));
    } else if (cmd === "next") {
      const [sessionId] = args;
      if (!sessionId) { console.error("usage: next <sessionId>"); process.exit(1); }
      const res = find("study_select_next").handler(store, { sessionId });
      console.log(JSON.stringify(res, null, 2));
    } else if (cmd === "attempt") {
      const [sessionId, operation, author, helpLevel, answerVisible, targetId, artifactJson] = args;
      if (!sessionId || !operation || !author || !helpLevel || !answerVisible) {
        console.error("usage: attempt <sessionId> <operation> <author> <helpLevel> <answerVisible> [targetId] [artifactJson]");
        process.exit(1);
      }
      const res = find("study_record_attempt").handler(store, {
        sessionId, operation, author, helpLevel,
        answerVisible: answerVisible === "true" || answerVisible === "1",
        ...(targetId ? { targetId } : {}),
        ...(artifactJson ? { artifactJson } : {}),
      });
      console.log(JSON.stringify(res, null, 2));
    } else if (cmd === "assess") {
      const [sessionId, targetId, dimensionsJson, criticalErrorsJson, answerVisibleBefore, delayed] = args;
      if (!sessionId || !targetId || !dimensionsJson) {
        console.error('usage: assess <sessionId> <targetId> \'<dimensionsJson>\' [criticalErrorsJson] [answerVisibleBefore] [delayed]');
        process.exit(1);
      }
      let dimensions: Record<string, unknown>; let criticalErrors: string[] = [];
      try { dimensions = JSON.parse(dimensionsJson); } catch { console.error("dimensions must be JSON"); process.exit(1); }
      if (criticalErrorsJson) { try { criticalErrors = JSON.parse(criticalErrorsJson); } catch { console.error("criticalErrors must be JSON"); process.exit(1); } }
      const res = find("study_record_assessment").handler(store, {
        sessionId, targetId, dimensions,
        criticalErrors,
        ...(answerVisibleBefore ? { answerWasVisibleBeforeAttempt: answerVisibleBefore === "true" || answerVisibleBefore === "1" } : {}),
        ...(delayed ? { delayed: delayed === "true" || delayed === "1" } : {}),
      });
      console.log(JSON.stringify(res, null, 2));
    } else if (cmd === "help") {
      const [sessionId, currentLevel, targetId, ...rest] = args;
      if (!sessionId) { console.error("usage: help <sessionId> [currentLevel] [targetId] [--explicit-answer] [--surrender] [--blocking]"); process.exit(1); }
      const flags = new Set(rest);
      const res = find("study_request_help").handler(store, {
        sessionId,
        ...(currentLevel ? { currentLevel: Number(currentLevel) } : {}),
        ...(targetId && !targetId.startsWith("--") ? { targetId } : {}),
        explicitAnswerRequest: flags.has("--explicit-answer"),
        explicitSurrender: flags.has("--surrender"),
        blockingPrerequisite: flags.has("--blocking"),
      });
      console.log(JSON.stringify(res, null, 2));
    } else if (cmd === "reviews") {
      const [sessionId] = args;
      if (!sessionId) { console.error("usage: reviews <sessionId>"); process.exit(1); }
      const res = find("study_reviews").handler(store, { sessionId });
      console.log(JSON.stringify(res, null, 2));
    } else if (cmd === "end") {
      const [sessionId] = args;
      if (!sessionId) { console.error("usage: end <sessionId>"); process.exit(1); }
      const status = find("study_status").handler(store, { sessionId });
      const verdict = find("study_select_next").handler(store, { sessionId });
      console.log(JSON.stringify({ status, runtimeVerdict: verdict }, null, 2));
    } else {
      console.error("unknown command. use: start | start-live | status | record | record-event | canvas | confirm-canvas | next | attempt | assess | help | reviews | end");
      process.exit(1);
    }
  } finally {
    store.close();
  }
}

main();
