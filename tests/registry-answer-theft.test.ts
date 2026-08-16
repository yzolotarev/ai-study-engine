import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { StudyStore } from "../src/db/store.js";
import { compileRegistry } from "../src/core/policy/registry-compiler.js";
import { evaluatePolicies } from "../src/core/policy/engine.js";

const XML_PATH = fileURLToPath(new URL("../registry/studying-antipatterns.registry.xml", import.meta.url));
const XML = readFileSync(XML_PATH, "utf8");

function setup() {
  const store = new StudyStore(":memory:");
  store.ensureUser("learner");
  const objectiveId = store.createObjective({
    userId: "learner",
    title: "Antitheft",
    observableOutcome: "Reconstruct independently",
    targetTask: "Generate the answer without help",
    assessmentFormat: "written",
    stakes: "normal",
    provenance: { kind: "PRODUCT_DECISION", sourceIds: [] },
  });
  const session = store.createSession("learner", objectiveId);
  const compiled = compileRegistry(XML, { mode: "review" });
  store.deployRegistryBundle(compiled);
  store.activateBundle(session.id, compiled.bundle.bundleId, compiled.bundle.bundleVersion);
  return { store, session, compiled };
}

test("bp_answer_theft fires when an AI-contaminated artifact is saved as learner-owned", () => {
  const { store, session } = setup();
  store.recordOperation({
    sessionId: session.id,
    targetId: "T1",
    operation: "reconstruct_structure",
    author: "ai",
    helpLevel: "full_solution",
    contaminationScope: "target",
  });

  const result = evaluatePolicies(store, { sessionId: session.id, targetId: "T1" });
  const theft = result.detections.find((d) => d.policyId === "bp_answer_theft");
  assert.ok(theft, "bp_answer_theft detection present in registry bundle");
  assert.equal(theft!.result, "matched");
  assert.ok(result.selectedIntervention, "an intervention must be selected");
  assert.equal(result.selectedIntervention!.templateId, "i_require_reconstruction");
  store.close();
});

test("bp_answer_theft clears after independent reconstruction", () => {
  const { store, session } = setup();
  store.recordOperation({
    sessionId: session.id,
    targetId: "T1",
    operation: "reconstruct_structure",
    author: "ai",
    helpLevel: "full_solution",
    contaminationScope: "target",
  });

  const before = evaluatePolicies(store, { sessionId: session.id, targetId: "T1" });
  assert.equal(before.detections.find((d) => d.policyId === "bp_answer_theft")!.result, "matched");

  // learner reconstructs independently, contamination closed as such
  store.recordOperation({
    sessionId: session.id,
    targetId: "T1",
    operation: "reconstruct_structure",
    author: "learner",
    helpLevel: "none",
    attemptIndependent: true,
    contaminationScope: "target",
  });
  const status = store.getContaminationStatus("T1")!;
  store.closeContamination(status.recordId, "independent_reconstruction");

  const after = evaluatePolicies(store, { sessionId: session.id, targetId: "T1" });
  assert.equal(after.detections.find((d) => d.policyId === "bp_answer_theft")!.result, "not_matched");
  store.close();
});

test("engine derives registry facts from the contamination model", () => {
  const { store, session } = setup();
  assert.equal(store.getContaminationStatus("T1"), undefined);

  store.recordOperation({
    sessionId: session.id,
    targetId: "T1",
    operation: "reconstruct_structure",
    author: "ai",
    helpLevel: "direct_answer",
    contaminationScope: "target",
  });
  const open = store.getContaminationStatus("T1")!;
  assert.equal(open.status, "contaminated");
  assert.equal(open.closureMethod, undefined);

  store.closeContamination(open.recordId, "independent_reconstruction");
  const closed = store.getContaminationStatus("T1")!;
  assert.equal(closed.status, "provisional_owned");
  assert.equal(closed.closureMethod, "independent_reconstruction");
  store.close();
});
