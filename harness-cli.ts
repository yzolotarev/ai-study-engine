#!/usr/bin/env -S node --import tsx
import { StudyStore } from "./src/db/store.js";
import { SQLiteHarnessRepository, StudyHarness } from "./src/harness/index.js";
import type { ArtifactAuthor, AttemptKind, CriterionAssessmentInput, HelpKind, Subject, TargetDefinition } from "./src/harness/types.js";

const HELP = `Study Harness v2 CLI

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

assessmentsJson is [{"criterionId":"...","met":true,"quotes":["literal learner text"]}].
No command accepts passed, independent, delayed, or verified flags.`;

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
function json<T>(value: string, name: string): T {
  try { return JSON.parse(value) as T; } catch { throw new Error(`${name} must be valid JSON`); }
}

const [command, ...args] = process.argv.slice(2);
if (!command || command === "--help" || command === "help-cli") {
  console.log(HELP);
  process.exit(0);
}

const store = new StudyStore(process.env.STUDY_HARNESS_DB ?? ".study-engine/harness-v2.sqlite");
const harness = new StudyHarness(new SQLiteHarnessRepository(store));
try {
  let result: unknown;
  switch (command) {
    case "start": {
      const [learnerId, subject, capability, targetTask, successCriteria, retentionDays] = args;
      result = harness.start(required(learnerId, "learnerId"), {
        subject: required(subject, "subject") as Subject,
        capability: required(capability, "capability"),
        targetTask: required(targetTask, "targetTask"),
        successCriteria: required(successCriteria, "successCriteria"),
        ...(retentionDays ? { retentionDays: Number(retentionDays) } : {}),
      });
      break;
    }
    case "confirm": result = harness.confirm(required(args[0], "sessionId"), required(args[1], "confirmation")); break;
    case "targets": result = harness.defineTargets(required(args[0], "sessionId"), args[1] ? json<TargetDefinition[]>(args[1], "targetsJson") : undefined); break;
    case "next": result = harness.status(required(args[0], "sessionId")).next; break;
    case "begin-attempt": result = harness.beginAttempt(required(args[0], "sessionId"), {
      kind: required(args[1], "kind") as AttemptKind,
      ...(args[2] ? { targetIds: json<string[]>(args[2], "targetIdsJson") } : {}),
      ...(args[3] ? { prompt: args[3] } : {}),
    }); break;
    case "submit": result = harness.submit(required(args[0], "sessionId"), required(args[1], "attemptId"), required(args[2], "content"), (args[3] ?? "learner") as ArtifactAuthor); break;
    case "assess": result = harness.assess(required(args[0], "sessionId"), required(args[1], "attemptId"), json<CriterionAssessmentInput[]>(required(args[2], "assessmentsJson"), "assessmentsJson")); break;
    case "gap": result = harness.openGap(required(args[0], "sessionId"), { attemptId: required(args[1], "attemptId"), targetId: required(args[2], "targetId"), criterionId: required(args[3], "criterionId"), diagnosis: required(args[4], "diagnosis") }); break;
    case "remediate": result = harness.remediate(required(args[0], "sessionId"), required(args[1], "gapId"), required(args[2], "content"), (args[3] ?? "explanation") as "explanation" | "example" | "exercise" | "source"); break;
    case "help": result = harness.help(required(args[0], "sessionId"), required(args[2], "content"), required(args[1], "kind") as HelpKind, args[3]); break;
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
