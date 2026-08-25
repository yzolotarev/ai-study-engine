import assert from "node:assert/strict";
import test from "node:test";
import {
  BUILTIN_ADAPTERS,
  HARNESS_SCHEMA_VERSION,
  MemoryHarnessRepository,
  StudyHarness,
  evaluateCompletion,
  projectHarness,
  type CriterionAssessmentInput,
  type HarnessEvent,
  type TargetDefinition,
} from "../src/harness/index.js";

function clock(start = "2026-01-01T00:00:00.000Z") {
  let value = Date.parse(start);
  return {
    now: () => new Date(value).toISOString(),
    advance: (ms: number) => { value += ms; },
  };
}

function fixture(retentionDays?: number) {
  const time = clock();
  let sequence = 0;
  const harness = new StudyHarness(new MemoryHarnessRepository(), {
    now: time.now,
    id: () => `id-${++sequence}`,
  });
  const started = harness.start("learner", {
    capability: "Explain why the Weimar Republic collapsed",
    targetTask: "Write a causal historical argument",
    successCriteria: "Accurate chronology, evidence, and differentiated causation",
    subject: "history",
    ...(retentionDays === undefined ? {} : { retentionDays }),
  });
  harness.confirm(started.sessionId, "Yes, this is my goal");
  const state = harness.defineTargets(started.sessionId);
  const target = Object.values(state.targets)[0];
  assert.ok(target);
  return { harness, sessionId: started.sessionId, target, time };
}

function assessment(target: TargetDefinition, content: string, failedIndex?: number): CriterionAssessmentInput[] {
  const fragments = ["chronology", "evidence", "causes"];
  return target.criteria.map((criterion, index) => ({
    criterionId: criterion.id,
    met: index !== failedIndex,
    quotes: index === failedIndex ? [] : [fragments[index] ?? content.slice(0, 4)],
  }));
}

function artifactText() {
  return "chronology identifies 1929 before 1933; evidence includes unemployment and decree rule; causes are separated into structural and contingent factors";
}

function assessedAttempt(
  harness: StudyHarness,
  sessionId: string,
  target: TargetDefinition,
  kind: "baseline" | "retrieval" | "transfer",
  content = artifactText(),
  failedIndex?: number,
  author: "learner" | "ai" | "shared" = "learner",
) {
  const begun = harness.beginAttempt(sessionId, { kind, targetIds: [target.id] });
  harness.submit(sessionId, begun.attemptId, content, author);
  const state = harness.assess(sessionId, begun.attemptId, assessment(target, content, failedIndex));
  return { attemptId: begun.attemptId, state };
}

test("all required deterministic subject adapters are available", () => {
  assert.deepEqual(Object.keys(BUILTIN_ADAPTERS), ["general", "history", "law", "economics"]);
  for (const adapter of Object.values(BUILTIN_ADAPTERS)) {
    const targets = adapter.defineTargets({ capability: "Explain", targetTask: "Apply", successCriteria: "Accurate", subject: adapter.subject });
    assert.ok(targets.length > 0);
    assert.ok(targets.every((target) => target.criteria.length > 0));
  }
});

test("history acceptance: confirmation -> failed baseline -> gap -> remediation -> retrieval -> transfer -> completion", () => {
  const { harness, sessionId, target, time } = fixture();
  time.advance(1_000);
  const baseline = assessedAttempt(harness, sessionId, target, "baseline", artifactText(), 1);
  assert.equal(baseline.state.attempts[baseline.attemptId]?.assessment?.allMet, false);
  const gap = harness.openGap(sessionId, {
    attemptId: baseline.attemptId,
    targetId: target.id,
    criterionId: target.criteria[1]!.id,
    diagnosis: "Causal claims need specific evidence",
  });
  harness.remediate(sessionId, gap.gapId, "Use one named fact for each causal link.");
  time.advance(1_000);
  const retrieval = assessedAttempt(harness, sessionId, target, "retrieval");
  assert.equal(retrieval.state.gaps[gap.gapId]?.resolvedByAttemptId, retrieval.attemptId);
  time.advance(1_000);
  assessedAttempt(harness, sessionId, target, "transfer", "chronology of a novel case; evidence from that case; causes separated without copying");
  const completed = harness.complete(sessionId);
  assert.equal(completed.recorded, true);
  assert.ok(completed.projection.completedAt);
  assert.equal(completed.projection.anomalies.length, 0);
});

test("baseline is required but never counts as mastery", () => {
  const { harness, sessionId, target } = fixture();
  assessedAttempt(harness, sessionId, target, "baseline");
  const status = harness.status(sessionId);
  assert.equal(status.completion.complete, false);
  assert.ok(status.completion.reasons.some((reason) => reason.includes("independent passing retrieval")));
});

test("literal artifact quotes are mandatory for every positive criterion", () => {
  const { harness, sessionId, target } = fixture();
  const begun = harness.beginAttempt(sessionId, { kind: "baseline", targetIds: [target.id] });
  harness.submit(sessionId, begun.attemptId, artifactText());
  const bogus = target.criteria.map((criterion) => ({ criterionId: criterion.id, met: true, quotes: ["not in learner artifact"] }));
  const state = harness.assess(sessionId, begun.attemptId, bogus);
  assert.equal(state.attempts[begun.attemptId]?.assessment, undefined);
  assert.ok(state.anomalies.some((item) => item.code === "INVALID_ASSESSMENT"));
});

test("substantive help contaminates the active attempt", () => {
  const { harness, sessionId, target } = fixture();
  assessedAttempt(harness, sessionId, target, "baseline");
  const begun = harness.beginAttempt(sessionId, { kind: "retrieval", targetIds: [target.id] });
  harness.help(sessionId, "The key causal answer is the Depression.", "content_hint", begun.attemptId);
  harness.submit(sessionId, begun.attemptId, artifactText());
  const state = harness.assess(sessionId, begun.attemptId, assessment(target, artifactText()));
  assert.equal(state.attempts[begun.attemptId]?.contaminated, true);
  assert.equal(evaluateCompletion(state).complete, false);
});

test("AI/shared artifacts never become learner evidence", () => {
  for (const author of ["ai", "shared"] as const) {
    const { harness, sessionId, target } = fixture();
    assessedAttempt(harness, sessionId, target, "baseline");
    const attempt = assessedAttempt(harness, sessionId, target, "retrieval", artifactText(), undefined, author);
    assert.equal(attempt.state.attempts[attempt.attemptId]?.assessment, undefined);
    assert.equal(harness.complete(sessionId).recorded, false);
  }
});

test("a caller-labelled transfer must still differ from retrieval prompt and artifact", () => {
  const { harness, sessionId, target } = fixture();
  assessedAttempt(harness, sessionId, target, "baseline");
  const retrieval = assessedAttempt(harness, sessionId, target, "retrieval");
  const retrievalPrompt = retrieval.state.attempts[retrieval.attemptId]?.prompt;
  assessedAttempt(harness, sessionId, target, "transfer", artifactText());
  const transfer = Object.values(harness.status(sessionId).projection.attempts).find((item) => item.kind === "transfer");
  assert.notEqual(transfer?.prompt, retrievalPrompt, "runtime supplies a domain transfer prompt");
  assert.equal(harness.complete(sessionId).recorded, false, "identical artifact is not novel transfer evidence");
});

test("retentionDays requires actual elapsed time; transfer cannot substitute", () => {
  const { harness, sessionId, target, time } = fixture(2);
  assessedAttempt(harness, sessionId, target, "baseline");
  time.advance(1_000);
  assessedAttempt(harness, sessionId, target, "retrieval");
  time.advance(1_000);
  assessedAttempt(harness, sessionId, target, "transfer");
  assert.equal(harness.complete(sessionId).recorded, false);
  time.advance(86_400_000);
  assessedAttempt(harness, sessionId, target, "retrieval");
  assert.equal(harness.complete(sessionId).recorded, false, "caller timing cannot declare a one-day attempt delayed by two days");
  time.advance(86_400_000 + 1_000);
  assessedAttempt(harness, sessionId, target, "retrieval");
  assert.equal(harness.complete(sessionId).recorded, true);
});

test("empty targets and open gaps block completion", () => {
  const { harness, sessionId, target } = fixture();
  const baseline = assessedAttempt(harness, sessionId, target, "baseline", artifactText(), 0);
  const gap = harness.openGap(sessionId, { attemptId: baseline.attemptId, targetId: target.id, criterionId: target.criteria[0]!.id, diagnosis: "missing chronology" });
  assert.equal(harness.status(sessionId).projection.gaps[gap.gapId]?.resolvedAt, undefined);
  assert.ok(harness.status(sessionId).completion.reasons.some((reason) => reason.includes("remain open")));

  const events: HarnessEvent[] = [{
    eventId: "start", sessionId: "empty", type: "harness.session.started", schemaVersion: HARNESS_SCHEMA_VERSION,
    occurredAt: "2026-01-01T00:00:00Z", actor: "engine",
    payload: { learnerId: "l", goal: { capability: "c", targetTask: "t", successCriteria: "s", subject: "general" } },
  }, {
    eventId: "confirm", sessionId: "empty", type: "harness.goal.confirmed", schemaVersion: HARNESS_SCHEMA_VERSION,
    occurredAt: "2026-01-01T00:00:01Z", actor: "learner", payload: { confirmation: "yes" },
  }, {
    eventId: "targets", sessionId: "empty", type: "harness.targets.defined", schemaVersion: HARNESS_SCHEMA_VERSION,
    occurredAt: "2026-01-01T00:00:02Z", actor: "engine", payload: { targets: [], generatedBy: "adapter" },
  }];
  const empty = projectHarness(events);
  assert.equal(Object.keys(empty.targets).length, 0);
  assert.ok(empty.anomalies.some((item) => item.code === "EMPTY_TARGETS"));
  assert.equal(evaluateCompletion(empty).complete, false);
});

test("out-of-order events remain audit anomalies and do not create evidence", () => {
  const event: HarnessEvent = {
    eventId: "submission", sessionId: "s", type: "harness.artifact.submitted", schemaVersion: HARNESS_SCHEMA_VERSION,
    occurredAt: "2026-01-01T00:00:00Z", actor: "learner",
    payload: { attemptId: "missing", artifactId: "a", author: "learner", content: "answer" },
  };
  const state = projectHarness([event]);
  assert.equal(Object.keys(state.attempts).length, 0);
  assert.deepEqual(state.anomalies.map((item) => item.code), ["INVALID_SUBMISSION"]);
});
