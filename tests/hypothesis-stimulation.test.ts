import assert from "node:assert/strict";
import test from "node:test";
import { StudyStore } from "../src/db/store.js";
import { HARNESS_TOOLS } from "../extensions/study-engine/harness-tools.js";
import {
  HARNESS_SCHEMA_VERSION,
  MemoryHarnessRepository,
  SQLiteHarnessRepository,
  StudyHarness,
  type HarnessRepository,
  TrustedLearnerIngress,
  type CriterionAssessmentInput,
  type Subject,
  type TargetDefinition,
} from "../src/harness/index.js";

const BASELINE_TEXT = "prediction with a reason and a falsifier grounded in the learner model";
const TRANSFER_TEXT = "a changed scenario produces a different result because its decisive condition changed";

function makeClock() {
  let millis = Date.parse("2026-07-01T00:00:00.000Z");
  return () => {
    millis += 1_000;
    return new Date(millis).toISOString();
  };
}

function makeHarness(repo: HarnessRepository = new MemoryHarnessRepository()) {
  let sequence = 0;
  return new StudyHarness(repo, {
    now: makeClock(),
    id: () => `hypothesis-${++sequence}`,
  });
}

function assessAll(target: TargetDefinition, content: string, failedIndex?: number): CriterionAssessmentInput[] {
  return target.criteria.map((criterion, index) => ({
    criterionId: criterion.id,
    met: index !== failedIndex,
    quotes: index === failedIndex ? [] : [content.slice(0, 10)],
  }));
}

function setup(subject: Subject = "general") {
  const harness = makeHarness();
  const started = harness.start("learner", {
    capability: "Apply a model",
    targetTask: "Explain a changed scenario",
    successCriteria: "Prediction, mechanism, and boundary",
    subject,
  });
  const ingress = new TrustedLearnerIngress(harness);
  ingress.confirmGoal(started.sessionId, "confirmed");
  harness.defineTargets(started.sessionId);
  const target = Object.values(harness.status(started.sessionId).projection.targets)[0]!;
  return { harness, ingress, sessionId: started.sessionId, target };
}

function submitAndAssess(
  harness: StudyHarness,
  ingress: TrustedLearnerIngress,
  sessionId: string,
  target: TargetDefinition,
  kind: "baseline" | "retrieval" | "transfer",
  content: string,
  failedIndex?: number,
) {
  const begun = harness.beginAttempt(sessionId, { kind, targetIds: [target.id] });
  ingress.submitArtifact(sessionId, begun.attemptId, content);
  const projection = harness.assess(sessionId, begun.attemptId, assessAll(target, content, failedIndex));
  return { attemptId: begun.attemptId, projection };
}

test("baseline next returns a deterministic commit scaffold with target and attempt bindings", () => {
  const { harness, sessionId, target } = setup("general");
  const initial = harness.status(sessionId).next;
  assert.equal(initial.stage, "baseline");
  assert.equal(initial.hypothesisScaffold?.phase, "commit");
  assert.equal(initial.hypothesisScaffold?.mode, "prediction");
  assert.deepEqual(initial.hypothesisScaffold?.targetIds, [target.id]);
  assert.equal(initial.hypothesisScaffold?.attemptId, undefined);
  assert.equal(initial.hypothesisScaffold?.disclosurePolicy, "commit-before-feedback");

  const begun = harness.beginAttempt(sessionId, { kind: "baseline", targetIds: [target.id] });
  const awaitingSubmission = harness.status(sessionId).next;
  assert.equal(awaitingSubmission.stage, "submit");
  assert.equal(awaitingSubmission.attemptId, begun.attemptId);
  assert.equal(awaitingSubmission.hypothesisScaffold?.attemptId, begun.attemptId);
  assert.deepEqual(awaitingSubmission.hypothesisScaffold?.targetIds, [target.id]);
});

test("repeated next is byte-for-byte deterministic and does not append events", () => {
  const repo = new MemoryHarnessRepository();
  const harness = makeHarness(repo);
  const { sessionId, target } = setupOn(harness, "history");
  const begun = harness.beginAttempt(sessionId, { kind: "baseline", targetIds: [target.id] });
  const count = repo.load(sessionId).length;
  const first = harness.status(sessionId).next;
  const second = harness.status(sessionId).next;
  assert.deepEqual(second, first);
  assert.equal(repo.load(sessionId).length, count);
  assert.equal(first.hypothesisScaffold?.attemptId, begun.attemptId);
});

function setupOn(harness: StudyHarness, subject: Subject) {
  const started = harness.start("learner", {
    capability: "Apply a model",
    targetTask: "Explain a changed scenario",
    successCriteria: "Prediction, mechanism, and boundary",
    subject,
  });
  const ingress = new TrustedLearnerIngress(harness);
  ingress.confirmGoal(started.sessionId, "confirmed");
  harness.defineTargets(started.sessionId);
  const target = Object.values(harness.status(started.sessionId).projection.targets)[0]!;
  return { ingress, sessionId: started.sessionId, target };
}

test("scaffold is projection-only: it neither changes mastery nor permits completion", () => {
  const { harness, sessionId, target } = setup("general");
  const before = harness.status(sessionId);
  const action = before.next;
  const after = harness.status(sessionId);
  assert.deepEqual(after.projection, before.projection);
  assert.deepEqual(after.completion, before.completion);
  assert.equal(after.completion.complete, false);
  assert.equal(action.hypothesisScaffold?.disclosurePolicy, "commit-before-feedback");
  assert.equal(harness.complete(sessionId).recorded, false);
  void target;
});

test("AI-facing tools can request a hypothesis but cannot record it as learner evidence", () => {
  const store = new StudyStore(":memory:");
  const call = (name: string, params: Record<string, unknown>) => {
    const tool = HARNESS_TOOLS.find((candidate) => candidate.name === name);
    assert.ok(tool);
    return tool.handler(store, params) as any;
  };
  assert.equal(HARNESS_TOOLS.some((tool) => tool.name === "study_v2_record_hypothesis"), false);
  const started = call("study_v2_start", {
    learnerId: "learner", subject: "general", capability: "C", targetTask: "T", successCriteria: "S",
  });
  const before = store.db.prepare("SELECT COUNT(*) AS count FROM study_events WHERE correlation_id = ?").get(started.sessionId) as { count: number };
  const requested = call("study_v2_request_learner_input", { sessionId: started.sessionId });
  assert.equal(requested.recorded, false);
  assert.equal(requested.next.hypothesisScaffold, undefined);
  assert.throws(
    () => call("study_v2_submit", { sessionId: started.sessionId, attemptId: "unknown", content: "my hypothesis", author: "learner" }),
    /ai or shared/,
  );
  const after = store.db.prepare("SELECT COUNT(*) AS count FROM study_events WHERE correlation_id = ?").get(started.sessionId) as { count: number };
  assert.equal(after.count, before.count);
  store.close();
});

test("trusted learner submission keeps the ordinary baseline lifecycle", () => {
  const { harness, ingress, sessionId, target } = setup("general");
  const begun = harness.beginAttempt(sessionId, { kind: "baseline", targetIds: [target.id] });
  ingress.submitArtifact(sessionId, begun.attemptId, BASELINE_TEXT);
  const assessing = harness.status(sessionId).next;
  assert.equal(assessing.stage, "assess");
  assert.equal(assessing.attemptId, begun.attemptId);
  assert.equal(assessing.hypothesisScaffold, undefined);
  const projected = harness.assess(sessionId, begun.attemptId, assessAll(target, BASELINE_TEXT));
  assert.equal(projected.attempts[begun.attemptId]?.artifact?.author, "learner");
  assert.equal(projected.attempts[begun.attemptId]?.assessment?.allMet, true);
});

test("failed assessment followed by an open gap returns a non-blocking revise scaffold", () => {
  const { harness, ingress, sessionId, target } = setup("history");
  const baseline = submitAndAssess(harness, ingress, sessionId, target, "baseline", BASELINE_TEXT, 0);
  assert.equal(harness.status(sessionId).next.stage, "diagnose");
  const diagnosis = "private assessor rationale that must not leak into the scaffold";
  const gap = harness.openGap(sessionId, {
    attemptId: baseline.attemptId,
    targetId: target.id,
    criterionId: target.criteria[0]!.id,
    diagnosis,
  });
  const next = harness.status(sessionId).next;
  assert.equal(next.stage, "remediate");
  assert.equal(next.hypothesisScaffold?.phase, "revise");
  assert.equal(next.hypothesisScaffold?.gapId, gap.gapId);
  assert.equal(next.hypothesisScaffold?.attemptId, baseline.attemptId);
  assert.deepEqual(next.hypothesisScaffold?.targetIds, [target.id]);
  assert.equal(next.hypothesisScaffold?.question.includes(diagnosis), false);
  assert.equal(next.hypothesisScaffold?.responseFrame.join(" ").includes(diagnosis), false);
});

test("transfer gets a domain commit scaffold only after an assessed retrieval", () => {
  const { harness, ingress, sessionId, target } = setup("economics");
  submitAndAssess(harness, ingress, sessionId, target, "baseline", BASELINE_TEXT);
  submitAndAssess(harness, ingress, sessionId, target, "retrieval", BASELINE_TEXT);
  const transfer = harness.beginAttempt(sessionId, { kind: "transfer", targetIds: [target.id] });
  const next = harness.status(sessionId).next;
  assert.equal(next.stage, "submit");
  assert.equal(next.attemptId, transfer.attemptId);
  assert.equal(next.hypothesisScaffold?.phase, "commit");
  assert.equal(next.hypothesisScaffold?.mode, "mechanism");
  assert.deepEqual(next.hypothesisScaffold?.targetIds, [target.id]);
  assert.match(next.hypothesisScaffold?.question ?? "", /predict|direction|reverse/i);
});

test("transfer remains rejected before an assessed retrieval", () => {
  const { harness, ingress, sessionId, target } = setup("law");
  submitAndAssess(harness, ingress, sessionId, target, "baseline", BASELINE_TEXT);
  assert.throws(
    () => harness.beginAttempt(sessionId, { kind: "transfer", targetIds: [target.id] }),
    /PRIMARY_RETRIEVAL_REQUIRED/,
  );
  const retrieval = harness.beginAttempt(sessionId, { kind: "retrieval", targetIds: [target.id] });
  ingress.submitArtifact(sessionId, retrieval.attemptId, BASELINE_TEXT);
  assert.throws(
    () => harness.beginAttempt(sessionId, { kind: "transfer", targetIds: [target.id] }),
    /OVERLAPPING_ATTEMPT/,
  );
});

test("assessment and done actions do not expose a new commit scaffold", () => {
  const { harness, ingress, sessionId, target } = setup("general");
  const baseline = submitAndAssess(harness, ingress, sessionId, target, "baseline", BASELINE_TEXT);
  const retrieval = submitAndAssess(harness, ingress, sessionId, target, "retrieval", BASELINE_TEXT);
  assert.equal(baseline.projection.attempts[baseline.attemptId]?.assessment?.allMet, true);
  assert.equal(retrieval.projection.attempts[retrieval.attemptId]?.assessment?.allMet, true);
  const transfer = harness.beginAttempt(sessionId, { kind: "transfer", targetIds: [target.id] });
  ingress.submitArtifact(sessionId, transfer.attemptId, TRANSFER_TEXT);
  const assessing = harness.status(sessionId).next;
  assert.equal(assessing.stage, "assess");
  assert.equal(assessing.hypothesisScaffold, undefined);
  harness.assess(sessionId, transfer.attemptId, assessAll(target, TRANSFER_TEXT));
  assert.equal(harness.complete(sessionId).recorded, true);
  const done = harness.status(sessionId).next;
  assert.equal(done.stage, "done");
  assert.equal(done.hypothesisScaffold, undefined);
});

test("all domain adapters provide distinct, answer-free deterministic scaffolds", () => {
  const questions = new Map<Subject, string>();
  for (const subject of ["general", "history", "law", "economics"] as const) {
    const { harness, sessionId } = setup(subject);
    const scaffold = harness.status(sessionId).next.hypothesisScaffold!;
    questions.set(subject, scaffold.question);
    assert.equal(scaffold.disclosurePolicy, "commit-before-feedback");
    assert.equal(scaffold.question.includes("assessor"), false);
    assert.equal(scaffold.question.includes("correct answer"), false);
    assert.equal(scaffold.responseFrame.some((line) => /answer is|the rule is|the factor is/i.test(line)), false);
  }
  assert.equal(new Set(questions.values()).size, 4);
});

test("ignoring the optional scaffold preserves the existing completion flow", () => {
  const { harness, ingress, sessionId, target } = setup("history");
  // The caller ignores hypothesisScaffold entirely and follows submit/assess.
  const baseline = harness.beginAttempt(sessionId, { kind: "baseline", targetIds: [target.id] });
  ingress.submitArtifact(sessionId, baseline.attemptId, BASELINE_TEXT);
  harness.assess(sessionId, baseline.attemptId, assessAll(target, BASELINE_TEXT));
  const retrieval = harness.beginAttempt(sessionId, { kind: "retrieval", targetIds: [target.id] });
  ingress.submitArtifact(sessionId, retrieval.attemptId, BASELINE_TEXT);
  harness.assess(sessionId, retrieval.attemptId, assessAll(target, BASELINE_TEXT));
  const transfer = harness.beginAttempt(sessionId, { kind: "transfer", targetIds: [target.id] });
  ingress.submitArtifact(sessionId, transfer.attemptId, TRANSFER_TEXT);
  harness.assess(sessionId, transfer.attemptId, assessAll(target, TRANSFER_TEXT));
  assert.equal(harness.complete(sessionId).recorded, true);
});

test("policy output uses no random IDs or timestamps and remains optional to persisted SQLite state", () => {
  const store = new StudyStore(":memory:");
  const first = makeHarness(new SQLiteHarnessRepository(store));
  const started = first.start("learner", {
    capability: "C", targetTask: "T", successCriteria: "S", subject: "law",
  });
  new TrustedLearnerIngress(first).confirmGoal(started.sessionId, "yes");
  first.defineTargets(started.sessionId);
  const before = store.db.prepare("SELECT COUNT(*) AS count FROM study_events WHERE correlation_id = ?").get(started.sessionId) as { count: number };
  const next1 = first.status(started.sessionId).next;
  const next2 = first.status(started.sessionId).next;
  const after = store.db.prepare("SELECT COUNT(*) AS count FROM study_events WHERE correlation_id = ?").get(started.sessionId) as { count: number };
  assert.deepEqual(next1, next2);
  assert.equal(before.count, after.count);
  assert.equal(next1.hypothesisScaffold?.attemptId, undefined);
  assert.equal(next1.hypothesisScaffold?.targetIds.length, 1);
  assert.equal(next1.hypothesisScaffold?.disclosurePolicy, "commit-before-feedback");
  store.close();
});
