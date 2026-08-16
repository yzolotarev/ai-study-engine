import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parseXml, childrenByName, childByName } from "../src/core/policy/registry-xml.js";
import { compileRegistry, validateStructure, RegistryCompileError } from "../src/core/policy/registry-compiler.js";
import type { ConditionAST } from "../src/core/policy/condition.js";

const XML_PATH = fileURLToPath(new URL("../registry/studying-antipatterns.registry.xml", import.meta.url));
const XML = readFileSync(XML_PATH, "utf8");

test("registry XML parses into a regular tree", () => {
  const doc = parseXml(XML);
  assert.equal(doc.tag, "learning_registry");
  assert.equal(doc.attributes.version, "1.1");
  const behaviors = childrenByName(doc, "behavior_patterns").flatMap((b) => childrenByName(b, "behavior"));
  assert.equal(behaviors.length, 5);
  const params = childrenByName(doc, "policy_parameters").flatMap((g) => childrenByName(g, "parameter"));
  assert.equal(params.length, 7);
});

test("structural validation passes on the canonical registry", () => {
  const doc = parseXml(XML);
  assert.equal(validateStructure(doc).length, 0);
});

test("strict mode fails closed — no metric is fully resolvable today", () => {
  assert.throws(() => compileRegistry(XML, { mode: "strict" }), RegistryCompileError);
  try {
    compileRegistry(XML, { mode: "strict" });
  } catch (err) {
    assert.ok(err instanceof RegistryCompileError);
    // every behavior carries at least one blocked/reviewable metric note
    assert.ok(err.notes.length >= 5);
  }
});

test("review mode compiles only behaviors whose metrics are reviewable", () => {
  const result = compileRegistry(XML, { mode: "review" });
  // bp_cramming_before_deadline (3 reviewable metrics), bp_answer_theft (2 reviewable_fact)
  // and bp_passive_consumption_after_sensory (2 anchored events + 1 fact) compile;
  // bp_expand_without_nucleus and bp_recognition_mistaken_for_recall remain blocked.
  assert.equal(result.summary.behaviors, 5);
  assert.equal(result.summary.compiled, 3);
  assert.equal(result.summary.blocked, 2);

  const cramming = result.policies.find((p) => p.policyId === "bp_cramming_before_deadline");
  assert.ok(cramming, "bp_cramming should compile in review mode");
  assert.equal(cramming!.status, "experimental");
  assert.equal(cramming!.priority, 60);

  const theft = result.policies.find((p) => p.policyId === "bp_answer_theft");
  assert.ok(theft, "bp_answer_theft should compile in review mode after vocabulary fix");
  assert.equal(theft!.status, "experimental");
  assert.equal(theft!.priority, 100);
  const theftCond = theft!.condition as ConditionAST;
  assert.equal(theftCond.op, "all");
  const theftLefts = (theftCond as { args: ConditionAST[] }).args.map((a) => (a as { left: unknown }).left);
  assert.deepEqual(theftLefts, [
    { kind: "fact", key: "ai_contaminated_artifact_saved" },
    { kind: "fact", key: "independent_reconstruction_count" },
  ]);

  const passive = result.policies.find((p) => p.policyId === "bp_passive_consumption_after_sensory");
  assert.ok(passive, "bp_passive_consumption_after_sensory must now compile (sinceAnchor reviewable)");
  assert.equal(passive!.status, "experimental");
  assert.equal(passive!.priority, 90);
  const passiveCond = passive!.condition as ConditionAST;
  assert.equal(passiveCond.op, "all");
  const passiveArgs = (passiveCond as { args: ConditionAST[] }).args;
  // metric 1: sensory_input_count since last_independent_attempt gte pol_sensory_threshold (parameter)
  assert.deepEqual(passiveArgs[0], {
    op: "compare",
    left: { kind: "event_count", eventType: "sensory_input", sinceAnchor: "last_independent_attempt" },
    cmp: "gte",
    right: { kind: "parameter", id: "pol_sensory_threshold" },
  });
  // metric 2: independent_encoding_count since last_sensory_input eq 0
  assert.deepEqual(passiveArgs[1], {
    op: "compare",
    left: { kind: "event_count", eventType: "independent_encoding", sinceAnchor: "last_sensory_input" },
    cmp: "eq",
    right: { kind: "literal", value: 0 },
  });
});

test("blocked behaviors are skipped with actionable instrumentation notes", () => {
  const result = compileRegistry(XML, { mode: "review" });
  const theftCompiled = result.policies.find((p) => p.policyId === "bp_answer_theft");
  assert.ok(theftCompiled, "bp_answer_theft must now be compiled (reviewable_fact), not blocked");

  const recognitionBlocked = result.notes.find(
    (n) => n.behaviorId === "bp_recognition_mistaken_for_recall" && n.status === "blocked",
  );
  assert.ok(recognitionBlocked, "bp_recognition_mistaken_for_recall must remain blocked (cue-visibility metrics)");
  assert.ok(recognitionBlocked!.requires && recognitionBlocked!.requires.length > 0);
});

test("interventions and parameters compile to experimental seeds", () => {
  const result = compileRegistry(XML, { mode: "review" });
  assert.equal(result.interventions.length, 6);
  const reconstruction = result.interventions.find((i) => i.id === "i_require_reconstruction");
  assert.ok(reconstruction);
  assert.equal(reconstruction!.kind, "process_only"); // anti-theft boundary preserved
  assert.equal(reconstruction!.status, "experimental");

  assert.equal(result.parameters.length, 7);
  const sensory = result.parameters.find((p) => p.parameterId === "pol_sensory_threshold");
  assert.ok(sensory);
  assert.equal(sensory!.value, 3);
  assert.equal(sensory!.status, "experimental");
});

test("structural validation rejects an unsupported operator", () => {
  const broken = XML.replace('<condition operator="all">', '<condition operator="xor">');
  const doc = parseXml(broken);
  const errors = validateStructure(doc);
  assert.ok(errors.some((e) => e.includes("xor")));
});
