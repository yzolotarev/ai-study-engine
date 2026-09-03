import assert from "node:assert/strict";
import test from "node:test";
import { StudyStore } from "../src/db/store.js";
import studyEngineExtension from "../extensions/study-engine/index.js";
import { HARNESS_TOOLS } from "../extensions/study-engine/harness-tools.js";
import { SQLiteHarnessRepository, StudyHarness, TrustedLearnerIngress } from "../src/harness/index.js";

const expected = [
  "study_v2_start", "study_v2_request_learner_input", "study_v2_targets", "study_v2_next",
  "study_v2_begin_attempt", "study_v2_submit", "study_v2_assess", "study_v2_gap",
  "study_v2_remediate", "study_v2_help", "study_v2_status", "study_v2_complete",
];

test("Pi exposes the complete Harness v2 tool surface without caller evidence flags", () => {
  assert.deepEqual(HARNESS_TOOLS.map((tool) => tool.name), expected);
  for (const tool of HARNESS_TOOLS) {
    assert.ok(tool.description.length > 0);
    const schema = JSON.stringify(tool.parameters);
    for (const forbidden of ["passed", "independent", "delayed", "verified"]) {
      assert.equal(schema.includes(`\"${forbidden}\"`), false, `${tool.name} exposes ${forbidden}`);
    }
  }
});

test("the packaged Pi extension registers every Harness v2 tool", () => {
  const names: string[] = [];
  studyEngineExtension({
    on() {},
    registerCommand() {},
    registerTool(tool: { name: string }) { names.push(tool.name); },
  } as any);
  for (const name of expected) assert.ok(names.includes(name), `extension did not register ${name}`);
});

test("Harness v2 Pi tools persist and replay through SQLite", () => {
  const store = new StudyStore(":memory:");
  const call = (name: string, params: Record<string, unknown>) => {
    const tool = HARNESS_TOOLS.find((candidate) => candidate.name === name);
    assert.ok(tool);
    return tool.handler(store, params) as any;
  };
  const started = call("study_v2_start", {
    learnerId: "pi-learner", subject: "law", capability: "Apply negligence",
    targetTask: "Analyze a novel fact pattern", successCriteria: "Issue, rule, application, counterargument",
  });
  // Learner confirmation is a trusted local ingress, not an AI-callable tool.
  new TrustedLearnerIngress(new StudyHarness(new SQLiteHarnessRepository(store))).confirmGoal(started.sessionId, "confirmed");
  call("study_v2_targets", { sessionId: started.sessionId });
  const next = call("study_v2_next", { sessionId: started.sessionId });
  assert.equal(next.stage, "baseline");
  const status = call("study_v2_status", { sessionId: started.sessionId });
  assert.equal(status.projection.goal.subject, "law");
  assert.equal(Object.keys(status.projection.targets).length, 1);
  store.close();
});
