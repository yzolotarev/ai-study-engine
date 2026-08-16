import assert from "node:assert/strict";
import test from "node:test";
import { CONCEPTUAL_DIALOGUE_V1 } from "../src/protocols/conceptual-dialogue.js";
import {
  getCurrentNodeId,
  isProtocolComplete,
  nextMove,
} from "../src/core/protocol-executor.js";

test("nextMove returns first uncompleted node when no artifacts", () => {
  const move = nextMove(CONCEPTUAL_DIALOGUE_V1, []);
  assert.ok(move);
  assert.equal(move.nodeId, "learner_preview");
  assert.equal(move.operation, "preview_material");
  assert.equal(move.executor, "learner");
  assert.equal(move.maxHelpLevel, "process_only");
});

test("nextMove advances after completing preview", () => {
  const move = nextMove(CONCEPTUAL_DIALOGUE_V1, ["preview_artifact"]);
  assert.ok(move);
  assert.equal(move.nodeId, "learner_questions");
  assert.equal(move.operation, "formulate_inquiry_questions");
});

test("nextMove returns reconstruction node after all encoding", () => {
  const move = nextMove(CONCEPTUAL_DIALOGUE_V1, [
    "preview_artifact",
    "questions_artifact",
    "grouping_artifact",
    "relations_artifact",
  ]);
  assert.ok(move);
  assert.equal(move.nodeId, "reconstruction");
  assert.equal(move.operation, "reconstruct_structure");
  assert.equal(move.maxHelpLevel, "none");
});

test("nextMove returns undefined when protocol complete", () => {
  const move = nextMove(CONCEPTUAL_DIALOGUE_V1, [
    "preview_artifact",
    "questions_artifact",
    "grouping_artifact",
    "relations_artifact",
    "reconstruction_artifact",
    "application_artifact",
    "delayed_retrieval_artifact",
  ]);
  assert.equal(move, undefined);
});

test("isProtocolComplete returns true when all evidence present", () => {
  const complete = isProtocolComplete(CONCEPTUAL_DIALOGUE_V1, [
    "preview_artifact",
    "questions_artifact",
    "grouping_artifact",
    "relations_artifact",
    "reconstruction_artifact",
    "application_artifact",
    "delayed_retrieval_artifact",
  ]);
  assert.equal(complete, true);
});

test("isProtocolComplete returns false when evidence missing", () => {
  const complete = isProtocolComplete(CONCEPTUAL_DIALOGUE_V1, [
    "preview_artifact",
    "questions_artifact",
  ]);
  assert.equal(complete, false);
});

test("getCurrentNodeId walks graph correctly", () => {
  assert.equal(getCurrentNodeId(CONCEPTUAL_DIALOGUE_V1, []), "learner_preview");
  assert.equal(
    getCurrentNodeId(CONCEPTUAL_DIALOGUE_V1, ["preview_artifact"]),
    "learner_questions",
  );
  assert.equal(
    getCurrentNodeId(CONCEPTUAL_DIALOGUE_V1, [
      "preview_artifact",
      "questions_artifact",
      "grouping_artifact",
    ]),
    "learner_relations",
  );
});