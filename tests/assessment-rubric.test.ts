import assert from "node:assert/strict";
import test from "node:test";
import { assessArtifact } from "../src/core/assessment-rubric.js";

test("assessArtifact passes when all required elements present", () => {
  const result = assessArtifact({
    artifactId: "artifact-1",
    protocolNodeId: "learner_preview",
    content: {
      structure_overview: "Three main sections",
      key_areas: "Derivatives, integrals, theorems",
      uncertainty_zones: "Mobius transformations",
    },
  });

  assert.equal(result.score, 3);
  assert.equal(result.maxScore, 3);
  assert.equal(result.passed, true);
  assert.equal(result.evidenceTypes.length, 3);
});

test("assessArtifact fails when required elements missing", () => {
  const result = assessArtifact({
    artifactId: "artifact-2",
    protocolNodeId: "reconstruction",
    content: {
      independent_explanation: "My explanation",
    },
  });

  assert.equal(result.score, 1);
  assert.equal(result.passed, false);
  assert.ok(result.feedback.some((f) => f.includes("Missing elements")));
});

test("assessArtifact returns zero score for unknown protocol node", () => {
  const result = assessArtifact({
    artifactId: "artifact-3",
    protocolNodeId: "unknown_node",
    content: {},
  });

  assert.equal(result.score, 0);
  assert.equal(result.passed, false);
  assert.ok(result.feedback.some((f) => f.includes("No rubric defined")));
});

test("assessArtifact passes reconstruction with minimum elements", () => {
  const result = assessArtifact({
    artifactId: "artifact-4",
    protocolNodeId: "reconstruction",
    content: {
      independent_explanation: "Complex derivative is stricter",
      no_source_reference: "true",
    },
  });

  assert.equal(result.score, 2);
  assert.equal(result.passed, true);
});