# Operator runbook: rotated calibration/usability pilot

This runbook uses the rotated v2 StudyPack. The v1 pack was invalidated after
an operator-side validation command echoed its assessment prompts. Do not use
v1 for a clean measurement.

## Files

- Protocol: `docs/evaluation/real-pilot/pilot.methodology.usability.v1.protocol.json`
- StudyPack: `docs/evaluation/real-pilot/methodology.learning-vs-performance.v2.pack.json`
- Coaching text: `docs/evaluation/real-pilot/methodology.learning-vs-performance.v1.coaching.ru.md`

## Validate and import

`validate-pack` now emits metadata only. Never paste raw pack JSON into a learner-facing channel.

```bash
EVAL_DB=.study-engine/evaluation-pilot.sqlite node --import tsx evaluation-cli.ts validate-protocol @docs/evaluation/real-pilot/pilot.methodology.usability.v1.protocol.json
EVAL_DB=.study-engine/evaluation-pilot.sqlite node --import tsx evaluation-cli.ts validate-pack @docs/evaluation/real-pilot/methodology.learning-vs-performance.v2.pack.json
EVAL_DB=.study-engine/evaluation-pilot.sqlite node --import tsx evaluation-cli.ts create-protocol @docs/evaluation/real-pilot/pilot.methodology.usability.v1.protocol.json
EVAL_DB=.study-engine/evaluation-pilot.sqlite node --import tsx evaluation-cli.ts import-pack @docs/evaluation/real-pilot/methodology.learning-vs-performance.v2.pack.json
```

## Assign and start

```bash
EVAL_DB=.study-engine/evaluation-pilot.sqlite node --import tsx evaluation-cli.ts assign pilot.methodology.usability.v1 1 methodology.learning-vs-performance.v2 2 self-pilot-01 pilot-seed-002 human
EVAL_DB=.study-engine/evaluation-pilot.sqlite node --import tsx evaluation-cli.ts start-trial <trialId>
EVAL_DB=.study-engine/evaluation-pilot.sqlite node --import tsx evaluation-cli.ts open-checkpoint <trialId> pretest
```

The operator must not answer, paraphrase, or reveal unopened forms. The learner
enters their own artifact directly through trusted human ingress:

```bash
EVAL_DB=.study-engine/evaluation-pilot.sqlite node --import tsx evaluation-cli.ts record-artifact <checkpointId> text "<learner text>"
```

If help is requested, record the intervention and require a separate clean attempt.
Use `trial-status` between phases. If pretest is clean, move to transfer; do not
repeat orientation. Delayed retrieval is opened only after the ledger reports it due:

```bash
EVAL_DB=.study-engine/evaluation-pilot.sqlite node --import tsx evaluation-cli.ts show-due-delayed
EVAL_DB=.study-engine/evaluation-pilot.sqlite node --import tsx evaluation-cli.ts open-checkpoint <trialId> delayed
```

## Reports

```bash
EVAL_DB=.study-engine/evaluation-pilot.sqlite node --import tsx evaluation-cli.ts comparison-report pilot.methodology.usability.v1 1 methodology.learning-vs-performance.v2 2 self-pilot-01 pilot-seed-002
EVAL_DB=.study-engine/evaluation-pilot.sqlite node --import tsx evaluation-cli.ts preview-export summary pilot.methodology.usability.v1 1 methodology.learning-vs-performance.v2 2 self-pilot-01 pilot-seed-002 .study-engine/evaluation-exports/pilot-summary
```

Research export is not part of the pilot run. No learner answers belong in chat,
commit messages, issue trackers, or telemetry.
