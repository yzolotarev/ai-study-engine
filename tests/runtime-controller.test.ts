import assert from "node:assert/strict";
import test from "node:test";
import { StudyStore } from "../src/db/store.js";
import { CONCEPTUAL_DIALOGUE_V1 } from "../src/protocols/conceptual-dialogue.js";
import { selectNextAction } from "../src/core/runtime-controller.js";

function setup() {
  const store = new StudyStore(":memory:");
  store.ensureUser("learner-1");
  const objectiveId = store.createObjective({
    userId: "learner-1",
    title: "Test",
    observableOutcome: "Explain",
    targetTask: "Dialogue",
    assessmentFormat: "oral",
    stakes: "normal",
    provenance: { kind: "PRODUCT_DECISION", sourceIds: [], policyVersion: "test" },
  });
  const session = store.createSession("learner-1", objectiveId);
  return { store, session };
}

test("selectNextAction demands capture before interpretation", () => {
  const { store, session } = setup();
  const action = selectNextAction(store, { sessionId: session.id });
  assert.ok(action);
  assert.equal(action.kind, "capture_canvas");
  store.close();
});

test("selectNextAction returns the first protocol move once a canvas exists", () => {
  const { store, session } = setup();
  store.recordCanvasArtifact({
    runId: "r1",
    sessionId: session.id,
    captureJson: "{}",
    screenshotSha256: "abc",
    model: "ggml-org/gemma-4-E2B-it-GGUF:Q4_0",
  });
  const action = selectNextAction(store, { sessionId: session.id });
  assert.ok(action);
  assert.equal(action.kind, "protocol_move");
  assert.equal(action.evidenceNeeded.includes("preview_artifact"), true);
  store.close();
});

test("selectNextAction returns complete_session when protocol done and no targets/reviews", () => {
  const { store, session } = setup();
  store.recordCanvasArtifact({
    runId: "r1",
    sessionId: session.id,
    captureJson: "{}",
    screenshotSha256: "abc",
    model: "ggml-org/gemma-4-E2B-it-GGUF:Q4_0",
  });
  for (const node of CONCEPTUAL_DIALOGUE_V1.nodes) {
    store.recordProtocolEvidence({
      sessionId: session.id,
      nodeId: node.nodeId,
      evidenceToken: node.requiredEvidence[0] ?? node.operation,
    });
  }
  const action = selectNextAction(store, { sessionId: session.id });
  assert.ok(action);
  assert.equal(action.kind, "complete_session");
  store.close();
});

test("selectNextAction routes to remediate when a target is not stable/verified", () => {
  const { store, session } = setup();
  store.recordCanvasArtifact({
    runId: "r1",
    sessionId: session.id,
    captureJson: "{}",
    screenshotSha256: "abc",
    model: "ggml-org/gemma-4-E2B-it-GGUF:Q4_0",
  });
  for (const node of CONCEPTUAL_DIALOGUE_V1.nodes) {
    store.recordProtocolEvidence({
      sessionId: session.id,
      nodeId: node.nodeId,
      evidenceToken: node.requiredEvidence[0] ?? node.operation,
    });
  }
  store.upsertTargetEvidenceState({
    sessionId: session.id,
    targetId: "t1",
    readiness: "insufficient",
    ownershipStatus: "unverified",
  });
  const action = selectNextAction(store, { sessionId: session.id });
  assert.ok(action);
  assert.equal(action.kind, "remediate");
  store.close();
});
