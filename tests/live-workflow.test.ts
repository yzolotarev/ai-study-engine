import assert from "node:assert/strict";
import test from "node:test";
import { StudyStore } from "../src/db/store.js";
import { STUDY_TOOLS } from "../extensions/study-engine/study-tools.js";

function tool(name: string) {
  const t = STUDY_TOOLS.find((x) => x.name === name);
  if (!t) throw new Error(`missing tool ${name}`);
  return t;
}

function setup() {
  const store = new StudyStore(":memory:");
  store.ensureUser("learner-1");
  return store;
}

test("live workflow: start -> capture -> confirm -> protocol -> attempt -> assessment -> review -> help", () => {
  const store = setup();
  const start = tool("study_start").handler(store, {
    capability: "C",
    targetTask: "T",
    successCriteria: "S",
  }) as { sessionId: string; contractId: string };
  assert.ok(start.sessionId);
  assert.ok(start.contractId);
  const sessionId = start.sessionId;

  // 1. Without a canvas artifact, the runtime demands capture first.
  const nx0 = tool("study_select_next").handler(store, { sessionId }) as { kind: string };
  assert.equal(nx0.kind, "capture_canvas");

  // 2. Simulate Capture Core + transcription (no real tldraw/Gemma in unit test).
  store.recordCanvasArtifact({
    runId: "r1",
    sessionId,
    captureJson: "{}",
    screenshotSha256: "sha",
    model: "ggml-org/gemma-4-E2B-it-GGUF:Q4_0",
  });
  store.attachCanvasTranscription({
    runId: "r1",
    transcriptionJson: JSON.stringify({
      schema_version: "study-canvas-transcription/v1",
      texts: [{ id: "t1", text: "x" }],
      objects: [],
    }),
  });

  // 3. Learner confirms literal observations only.
  const confirm = tool("study_confirm_canvas").handler(store, {
    sessionId,
    observationIds: ["t1"],
  }) as { confirmed: boolean };
  assert.equal(confirm.confirmed, true);

  const bad = tool("study_confirm_canvas").handler(store, {
    sessionId,
    observationIds: ["ghost"],
  }) as { error: string };
  assert.equal(bad.error, "invalid_observation_ids_or_status");

  // 4. After capture, the runtime returns a protocol move.
  const nx1 = tool("study_select_next").handler(store, { sessionId }) as { kind: string };
  assert.equal(nx1.kind, "protocol_move");

  // 5. Record the first artifact. Evidence must come from SQLite, NOT the
  // caller-supplied completedArtifacts list (which is ignored).
  const rec = tool("study_record_artifact").handler(store, {
    sessionId,
    artifactType: "preview_artifact",
    artifactJson: "{}",
    targetId: "t1",
    completedArtifacts: JSON.stringify([
      "preview_artifact",
      "questions_artifact",
      "grouping_artifact",
      "relations_artifact",
      "reconstruction_artifact",
      "application_artifact",
      "delayed_retrieval_artifact",
    ]),
  }) as { status: string };
  assert.equal(rec.status, "recorded");
  const evidence = store.getValidProtocolEvidence(sessionId);
  assert.deepEqual(evidence, ["preview_artifact"]);

  // The runtime still reports a protocol move (not complete) because only one
  // evidence token exists in the database.
  const nx2 = tool("study_select_next").handler(store, { sessionId }) as { kind: string };
  assert.equal(nx2.kind, "protocol_move");

  // 6. Record an attempt with contamination metadata.
  const attempt = tool("study_record_attempt").handler(store, {
    sessionId,
    operation: "preview_material",
    author: "learner",
    helpLevel: "none",
    answerVisible: false,
    targetId: "t1",
  }) as { answerVisible: boolean };
  assert.equal(attempt.answerVisible, false);

  // 7. Record an assessment -> readiness derived + spaced review scheduled.
  const assess = tool("study_record_assessment").handler(store, {
    sessionId,
    targetId: "t1",
    dimensions: { factualAccuracy: 3, freeGeneration: 3, relationalStructure: 3 },
    criticalErrors: [],
    delayed: true,
  }) as { readiness: string; ownership: string };
  assert.equal(assess.readiness, "stable");
  assert.equal(assess.ownership, "verified_owned");

  // Schedule a past-due review to exercise getDueReviewItems.
  store.createPersistentReview({
    sessionId,
    targetId: "t1",
    dueAt: new Date(Date.now() - 1000).toISOString(),
  });
  const reviews = tool("study_reviews").handler(store, { sessionId }) as {
    dueCount: number;
  };
  assert.equal(reviews.dueCount, 1);

  // 8. Requesting help returns the minimal level 0 by default.
  const help = tool("study_request_help").handler(store, {
    sessionId,
    currentLevel: 2,
  }) as { level: number };
  assert.equal(help.level, 0);

  store.close();
});

test("study_open_gap records an open gap without erasing it", () => {
  const store = setup();
  const start = tool("study_start").handler(store, {
    capability: "C",
    targetTask: "T",
    successCriteria: "S",
  }) as { sessionId: string };
  const gap = tool("study_open_gap").handler(store, {
    sessionId: start.sessionId,
    targetId: "t1",
  }) as { gapId: string; status: string };
  assert.ok(gap.gapId);
  assert.equal(gap.status, "open");
  store.close();
});
