import assert from "node:assert/strict";
import test from "node:test";
import { enforceProvenance } from "../src/core/provenance-enforcement.js";
import type { ProtocolMove } from "../src/core/protocol-executor.js";

const testMove: ProtocolMove = {
  nodeId: "reconstruction",
  operation: "reconstruct_structure",
  executor: "learner",
  expectedArtifact: "independent_reconstruction",
  maxHelpLevel: "none",
  instruction: "Закрой источник и карту. Объясни тему с нуля, своими словами, без подсказок.",
};

test("enforceProvenance allows move when no contamination", () => {
  const result = enforceProvenance(testMove, undefined);
  assert.equal(result.contaminationBlocked, false);
  assert.equal(result.enforcedHelpLevel, "none");
  assert.equal(result.move.instruction, testMove.instruction);
});

test("enforceProvenance allows move when contamination is provisional_owned", () => {
  const result = enforceProvenance(testMove, "provisional_owned");
  assert.equal(result.contaminationBlocked, false);
  assert.equal(result.enforcedHelpLevel, "none");
  assert.equal(result.move.instruction, testMove.instruction);
});

test("enforceProvenance blocks help when contamination is contaminated", () => {
  const moveWithHelp: ProtocolMove = {
    nodeId: "learner_relations",
    operation: "propose_relation",
    executor: "learner",
    expectedArtifact: "proposed_relations",
    maxHelpLevel: "content_cue",
    instruction: "Предложи связи между группами. Объясни, почему каждая связь существует.",
  };

  const result = enforceProvenance(moveWithHelp, "contaminated");
  assert.equal(result.contaminationBlocked, true);
  assert.equal(result.enforcedHelpLevel, "none");
  assert.equal(result.move.maxHelpLevel, "none");
  assert.ok(result.move.instruction.includes("загрязнён"));
});

test("enforceProvenance preserves operation and executor when blocking", () => {
  const moveWithHelp: ProtocolMove = {
    nodeId: "learner_relations",
    operation: "propose_relation",
    executor: "learner",
    expectedArtifact: "proposed_relations",
    maxHelpLevel: "content_cue",
    instruction: "Предложи связи между группами.",
  };

  const result = enforceProvenance(moveWithHelp, "contaminated");
  assert.equal(result.move.operation, "propose_relation");
  assert.equal(result.move.executor, "learner");
  assert.equal(result.move.expectedArtifact, "proposed_relations");
  assert.equal(result.move.maxHelpLevel, "none");
});