#!/usr/bin/env -S node --import tsx
import { StudyStore } from "./src/db/store.js";
import {
  SQLiteHarnessRepository,
  StudyHarness,
  TrustedLearnerIngress,
  parseCriterionAssessments,
  parseTargetDefinitions,
} from "./src/harness/index.js";
import type { AttemptKind, HelpKind, Subject } from "./src/harness/types.js";

const HELP = `Study Harness v2 CLI (trusted local human ingress)

Commands:
  start <learnerId> <subject> <capability> <targetTask> <successCriteria> [retentionDays]
  confirm <sessionId> <confirmation>
  targets <sessionId> [targetsJson]
  next <sessionId>
  begin-attempt <sessionId> <baseline|retrieval|transfer> [targetIdsJson] [prompt]
  submit <sessionId> <attemptId> <content> [learner|ai|shared]
  assess <sessionId> <attemptId> <assessmentsJson>
  gap <sessionId> <attemptId> <targetId> <criterionId> <diagnosis>
  remediate <sessionId> <gapId> <content> [explanation|example|exercise|source]
  help <sessionId> <process_prompt|content_hint|worked_example|answer> <content> [attemptId]
  status <sessionId>
  complete <sessionId>

The CLI is a trusted local operator boundary: confirm and learner submit assert
that the human copied learner-originated input. AI-callable Pi tools cannot make
that assertion. The next and status commands include an optional non-persisted
hypothesisScaffold; it asks for a learner prediction before feedback and never
changes the ledger or completion decision. No command accepts passed,
independent, delayed, or verified.`;

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
function json(value: string, name: string): unknown {
  try { return JSON.parse(value); } catch { throw new Error(`${name} must be valid JSON`); }
}
function subject(value: string): Subject {
  if (value === "general" || value === "history" || value === "law" || value === "economics") return value;
  throw new Error("subject must be general, history, law, or economics");
}
function attemptKind(value: string): AttemptKind {
  if (value === "baseline" || value === "retrieval" || value === "transfer") return value;
  throw new Error("invalid attempt kind");
}
function helpKind(value: string): HelpKind {
  if (value === "process_prompt" || value === "content_hint" || value === "worked_example" || value === "answer") return value;
  throw new Error("invalid help kind");
}
function remediationKind(value: string): "explanation" | "example" | "exercise" | "source" {
  if (value === "explanation" || value === "example" || value === "exercise" || value === "source") return value;
  throw new Error("invalid remediation kind");
}
function targetIds(value: string): readonly string[] {
  const parsed = json(value, "targetIdsJson");
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) throw new Error("targetIdsJson must be a JSON string array");
  return parsed;
}

const [command, ...args] = process.argv.slice(2);
if (!command || command === "--help" || command === "help-cli") {
  console.log(HELP);
  process.exit(0);
}

const store = new StudyStore(process.env.STUDY_HARNESS_DB ?? ".study-engine/harness-v2.sqlite");
const harness = new StudyHarness(new SQLiteHarnessRepository(store));
const learner = new TrustedLearnerIngress(harness);
try {
  let result: unknown;
  switch (command) {
    case "start": {
      const [learnerId, rawSubject, capability, targetTask, successCriteria, retentionDays] = args;
      result = harness.start(required(learnerId, "learnerId"), {
        subject: subject(required(rawSubject, "subject")),
        capability: required(capability, "capability"),
        targetTask: required(targetTask, "targetTask"),
        successCriteria: required(successCriteria, "successCriteria"),
        ...(retentionDays ? { retentionDays: Number(retentionDays) } : {}),
      });
      break;
    }
    case "confirm": result = learner.confirmGoal(required(args[0], "sessionId"), required(args[1], "confirmation")); break;
    case "targets": {
      const parsed = args[1] ? parseTargetDefinitions(json(args[1], "targetsJson")) : undefined;
      if (args[1] && !parsed) throw new Error("targetsJson has invalid target definitions");
      result = harness.defineTargets(required(args[0], "sessionId"), parsed);
      break;
    }
    case "next": result = harness.status(required(args[0], "sessionId")).next; break;
    case "begin-attempt": result = harness.beginAttempt(required(args[0], "sessionId"), {
      kind: attemptKind(required(args[1], "kind")),
      ...(args[2] ? { targetIds: targetIds(args[2]) } : {}),
      ...(args[3] ? { prompt: args[3] } : {}),
    }); break;
    case "submit": {
      const sessionId = required(args[0], "sessionId");
      const attemptId = required(args[1], "attemptId");
      const content = required(args[2], "content");
      const author = args[3] ?? "learner";
      if (author === "learner") result = learner.submitArtifact(sessionId, attemptId, content);
      else if (author === "ai" || author === "shared") result = harness.recordArtifact(sessionId, attemptId, content, author);
      else throw new Error("author must be learner, ai, or shared");
      break;
    }
    case "assess": {
      const assessments = parseCriterionAssessments(json(required(args[2], "assessmentsJson"), "assessmentsJson"));
      if (!assessments) throw new Error("assessmentsJson has invalid assessment entries");
      result = harness.assess(required(args[0], "sessionId"), required(args[1], "attemptId"), assessments);
      break;
    }
    case "gap": result = harness.openGap(required(args[0], "sessionId"), { attemptId: required(args[1], "attemptId"), targetId: required(args[2], "targetId"), criterionId: required(args[3], "criterionId"), diagnosis: required(args[4], "diagnosis") }); break;
    case "remediate": result = harness.remediate(required(args[0], "sessionId"), required(args[1], "gapId"), required(args[2], "content"), remediationKind(args[3] ?? "explanation")); break;
    case "help": result = harness.help(required(args[0], "sessionId"), required(args[2], "content"), helpKind(required(args[1], "kind")), args[3]); break;
    case "status": result = harness.status(required(args[0], "sessionId")); break;
    case "complete": result = harness.complete(required(args[0], "sessionId")); break;
    default: throw new Error(`Unknown command: ${command}\n\n${HELP}`);
  }
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  store.close();
}
