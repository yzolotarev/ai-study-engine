# Operator runbook: Methodology readiness / usability pilot

## Files

- Protocol: `docs/evaluation/real-pilot/pilot.methodology.usability.v1.protocol.json`
- StudyPack: `docs/evaluation/real-pilot/methodology.learning-vs-performance.v1.pack.json`
- Coaching text: `docs/evaluation/real-pilot/methodology.learning-vs-performance.v1.coaching.ru.md`

## 1) Validate and import

```bash
EVAL_DB=.study-engine/evaluation-pilot.sqlite \
  node --import tsx evaluation-cli.ts validate-protocol @docs/evaluation/real-pilot/pilot.methodology.usability.v1.protocol.json

EVAL_DB=.study-engine/evaluation-pilot.sqlite \
  node --import tsx evaluation-cli.ts validate-pack @docs/evaluation/real-pilot/methodology.learning-vs-performance.v1.pack.json

EVAL_DB=.study-engine/evaluation-pilot.sqlite \
  node --import tsx evaluation-cli.ts create-protocol @docs/evaluation/real-pilot/pilot.methodology.usability.v1.protocol.json

EVAL_DB=.study-engine/evaluation-pilot.sqlite \
  node --import tsx evaluation-cli.ts import-pack @docs/evaluation/real-pilot/methodology.learning-vs-performance.v1.pack.json
```

## 2) Assign a pilot trial

```bash
EVAL_DB=.study-engine/evaluation-pilot.sqlite \
  node --import tsx evaluation-cli.ts assign pilot.methodology.usability.v1 1 methodology.learning-vs-performance.v1 1 self-pilot-01 pilot-seed-001 human
```

## 3) Start the 10-minute session

```bash
EVAL_DB=.study-engine/evaluation-pilot.sqlite \
  node --import tsx evaluation-cli.ts start-trial <trialId>
```

## 4) Open the first checkpoint

```bash
EVAL_DB=.study-engine/evaluation-pilot.sqlite \
  node --import tsx evaluation-cli.ts open-checkpoint <trialId> pretest
```

## 5) Record true learner input via trusted human ingress

The operator copies the learner's own answer into the local CLI.
Do not answer for the learner.

```bash
EVAL_DB=.study-engine/evaluation-pilot.sqlite \
  node --import tsx evaluation-cli.ts record-artifact <checkpointId> text "<learner text>"
```

If the learner asks for help during the active attempt, record it as intervention exposure:

```bash
EVAL_DB=.study-engine/evaluation-pilot.sqlite \
  node --import tsx evaluation-cli.ts record-intervention <trialId> '{"trialId":"<trialId>","checkpointId":"<checkpointId>","pedagogicalIntent":"minimal orientation","technique":"process prompt","helpLevel":"process_prompt","phase":"pretest"}'
```

## 6) Check status

```bash
EVAL_DB=.study-engine/evaluation-pilot.sqlite \
  node --import tsx evaluation-cli.ts trial-status <trialId>
```

## 7) Complete immediate / transfer part

- assess the current checkpoint only after a learner artifact exists
- if the pretest is already clean, move to transfer rather than repeating the same explanation
- if help was given, start a new clean attempt before treating the next artifact as evidence
- the assigned policy can be inspected as a typed, prompt-free decision (operator-only):

```bash
EVAL_DB=.study-engine/evaluation-pilot.sqlite \
  node --import tsx evaluation-cli.ts policy-decision <trialId> '{"phase":"pretest","criteria":{"LP_DISTINCTION":"unknown","CONFOUND_DETECTION":"unknown","EVIDENCE_DESIGN":"unknown","ADAPTIVE_DECISION":"unknown"},"attemptContaminated":false,"helpExposureCount":0,"cleanAttemptAvailable":true,"sessionElapsedMs":0,"sessionBudgetMs":600000,"delayedDue":false}'
```

## 8) Later, find the due delayed checkpoint

```bash
EVAL_DB=.study-engine/evaluation-pilot.sqlite \
  node --import tsx evaluation-cli.ts show-due-delayed
```

Only open delayed once the due time is reached:

```bash
EVAL_DB=.study-engine/evaluation-pilot.sqlite \
  node --import tsx evaluation-cli.ts open-checkpoint <trialId> delayed
```

## 9) Summary report

```bash
EVAL_DB=.study-engine/evaluation-pilot.sqlite \
  node --import tsx evaluation-cli.ts comparison-report pilot.methodology.usability.v1 1 methodology.learning-vs-performance.v1 1 self-pilot-01 pilot-seed-001

EVAL_DB=.study-engine/evaluation-pilot.sqlite \
  node --import tsx evaluation-cli.ts preview-export summary pilot.methodology.usability.v1 1 methodology.learning-vs-performance.v1 1 self-pilot-01 pilot-seed-001 .study-engine/evaluation-exports/pilot-summary

# Use the exportId printed by preview-export; do not export from a stale preview.
EVAL_DB=.study-engine/evaluation-pilot.sqlite \
  node --import tsx evaluation-cli.ts export-bundle summary pilot.methodology.usability.v1 1 methodology.learning-vs-performance.v1 1 self-pilot-01 pilot-seed-001 .study-engine/evaluation-exports/pilot-summary --preview-id <previewId>
```

For research export, use the preview id from `preview-export` and confirm explicitly before export.
