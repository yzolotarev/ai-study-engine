# Learning Evaluation Layer v0

Learning Evaluation Layer v0 is a local measurement sidecar for reproducible N-of-1 experiments.
It is **not** the mastery kernel and does **not** prove learning.

## What it collects

- protocol / pack / policy versions
- matched-set assignments
- executable, versioned policy runtime traces with deterministic fingerprints
- checkpoint status and rubric vectors
- stable attempt identities, including a new checkpoint/attempt for every clean retry after help
- contamination / help observations
- critical incidents
- subjective exit feedback
- local export bundles
- integrity checks and local SQLite backups
- hash-chained evaluation audit events for local replay/integrity checks
- opt-in AES-256-GCM encrypted backups and explicit participant deletion with a hashed tombstone

## What it does not collect

- learner name or email as required fields
- raw telemetry or network uploads
- automatic mastery probabilities
- hidden future assessment prompts in coaching views
- any claim that software tests equal learning

## Why it exists

To make local experiments reproducible:

`matched microtopic → pretest → policy → study session → immediate test → transfer test → delayed test → blind scoring → comparison report`

The layer only observes and summarizes. It does not change mastery semantics in the Harness kernel.

## Provenance boundary

Every new trial has an immutable, schema-backed `trialSubjectKind`:

- `human`
- `synthetic`

Rows created before this boundary are migrated to `legacy-unclassified`. They remain readable for
inspection but cannot be resumed, mutated, exported, or reclassified as human evidence.
The SQLite sidecar records this migration as evaluation store schema version `2` (the checkpoint
attempt/retry migration); the protocol and StudyPack definition schema remains version `1` because
executable policies and pack custodial metadata are required.

Every learner artifact also has immutable persisted provenance:

- `trusted-human` — accepted only by the trusted human ingress on a `human` trial
- `deterministic-fixture` — accepted only by the synthetic/test ingress on a `synthetic` trial
- `ai-simulation` — accepted only by the synthetic/test ingress on a `synthetic` trial
- `legacy-unclassified` — migration-only, read-only, and excluded from reports

The two ingresses reject the opposite trial kind. Domain names, notes, participant IDs, filename
prefixes, and calibration labels are not provenance and cannot bypass this boundary.
For an additional physical namespace boundary, run the CLI with `EVAL_DATASET_KIND=human` for a
human database or `EVAL_DATASET_KIND=synthetic` for a synthetic database; a store opened in either
mode rejects the other population.

`comparison-report`, summary export, and research export use only `human` trials whose artifacts are
all `trusted-human`. There is no CLI flag that adds synthetic or legacy records. Synthetic trials use
the separate `synthetic-behavioral-report`, which is always labelled:

`SYNTHETIC SOFTWARE/BEHAVIORAL CHECK — NOT HUMAN LEARNING EVIDENCE`

For the complete deterministic boundary check, `npm run evaluate -- synthetic-benchmark` executes all
64 isolated cells (2 policies × 4 readiness values × 4 seeds × 2 help modes), reports failures rather
than selecting a winner, and emits a reproducibility digest. It is still a software/behavioral check,
not a human-learning result.

## StudyPack and protocol

A `StudyPack` packages:

- pack/version/domain
- source hashes or references
- matched sets and microtopics
- goal contracts
- rubric
- pretest / immediate / transfer / delayed forms
- equivalence metadata
- classification (`human-ready`, `calibration-only`, or `synthetic-only`)
- hidden scoring materials, disagreement policy, author/reviewer, and change history

An `EvaluationProtocol` packages:

- protocol/version/title/domain
- hypothesis
- primary / secondary outcomes
- retention delay
- session budget
- policy variants
- topic assignment rules
- allowed artifact types
- scorer requirements
- timestamps / metadata

## How to avoid leakage

- keep forms isolated from coaching views
- only open the checkpoint that is currently due
- delayed checkpoints expose only due metadata before the retention interval; the prompt and ingress stay closed
- do not print future prompts in trial status
- treat the pack as experimental until reviewed

When substantive help is recorded against an active checkpoint, that attempt remains contaminated
and immutable. Re-opening the same phase creates a new `attemptId`/checkpoint identity; the clean
retry can be scored independently while the contaminated history remains visible in the report.

## How to run a 10-minute synthetic trial

The supported quickstart uses the synthetic fixture only:

```bash
npm run evaluate -- smoke-fixture
```

For a fuller run, import the fixture JSON into the local CLI and then:

```text
assign … synthetic → start-trial → open-checkpoint → record-synthetic-artifact
→ assess-checkpoint → open next checkpoint → … → trial-status
→ synthetic-behavioral-report
```

Use `deterministic-fixture` or `ai-simulation` explicitly when recording a synthetic artifact.
Never route fixture or agent-generated text through `record-artifact`, which is reserved for trusted
human ingress.

## Real calibration/usability pilot pack

For the first real manual pilot, use the prepared local files:

- `docs/evaluation/real-pilot/pilot.methodology.usability.v1.protocol.json`
- `docs/evaluation/real-pilot/methodology.learning-vs-performance.v1.pack.json`
- `docs/evaluation/real-pilot/methodology.learning-vs-performance.v1.coaching.ru.md`
- `docs/evaluation/real-pilot/methodology.learning-vs-performance.v1.runbook.md`

This pack is explicitly marked as a calibration/usability pilot and must not be used as efficacy evidence.

## Delayed test

Delayed outcomes are only valid after the protocol's retention delay has elapsed.
Before due, a delayed checkpoint exposes only its due timestamp and remains `not-yet-due`;
artifact ingress and scorer execution are rejected. Once due, it must be opened again before
the hidden prompt is released.

## Backup, restore, and deletion

The normal `backup` command creates a local SQLite snapshot. For an opt-in encrypted copy, keep the
passphrase outside the repository and run:

```bash
EVAL_BACKUP_PASSPHRASE='use-a-long-local-passphrase' npm run evaluate -- backup-encrypted ./backup.evaluation.enc
EVAL_BACKUP_PASSPHRASE='use-a-long-local-passphrase' npm run evaluate -- restore-encrypted ./backup.evaluation.enc ./restored.evaluation.sqlite
```

The encrypted format uses scrypt plus AES-256-GCM, refuses overwrites, and does not store the
passphrase. To honour a participant deletion request, an operator must provide the exact typed
confirmation; dependent rows are removed and only a hashed participant tombstone remains:

```bash
npm run evaluate -- delete-participant self-pilot-01 --confirm 'DELETE self-pilot-01'
```

Every evaluation snapshot write is also recorded in a local hash-chained audit stream. `integrity-check`
checks both SQLite and that stream; direct edits or missing current snapshots fail closed. The audit
stream is an integrity aid, not a remote tamper-proof log.

## Blind scoring

Supported scorers:

- trusted human/manual scorer
- deterministic scorer for synthetic fixtures
- future AI semantic scorer interface

Scorers receive only the immutable task, learner artifact, rubric, allowed guidance, and scorer metadata.
They do not receive the experimental condition or a desired result.

## Summary vs research export

### summary

Default mode. Includes:

- protocol / pack / policy IDs and versions
- aggregated rubric vectors
- durations and counts
- critical incident categories
- missing-data indicators
- environment/app version
- hashes instead of raw source material

Excludes:

- raw conversation
- learner artifact text
- raw voice/audio
- absolute paths
- names/emails
- secrets

### research

Opt-in only. Includes everything in summary plus:

- selected pseudonymized artifacts/events
- manifest of exact files
- consent / acknowledgement record
- export timestamp
- redaction report

Before research export, the CLI must show a preview and require explicit confirmation.
If probable API keys, cookies, or credentials are detected, export is blocked until the data is cleaned.
Both summary and research exports require the `previewId` from an unchanged preview; the manifest
contains hashes of the exact bytes written.

## Policy runtime and matrix checks

`policy-decision` executes a policy's typed deterministic transition without seeing assessment
prompts or learner artifacts. `synthetic-matrix` describes the complete 2 × 4 × 4 × 2 synthetic
software-check matrix (policies × readiness personas × seeds × help modes). Its output is never
human learning evidence.

The local operator can also verify and back up the sidecar:

```bash
EVAL_DB=.study-engine/evaluation-pilot.sqlite node --import tsx evaluation-cli.ts integrity-check
EVAL_DB=.study-engine/evaluation-pilot.sqlite node --import tsx evaluation-cli.ts backup .study-engine/evaluation-pilot.backup.sqlite
```

## Deleting local evaluation data

Delete the local sidecar database and exports, for example:

```bash
rm -f .study-engine/evaluation.sqlite
rm -rf .study-engine/evaluation-exports
```

## What remains unknown

- whether a given policy improves learning for real people
- whether a synthetic fixture generalizes to any real domain
- how much subject-matter preparation a real pack needs
- how to interpret small-sample comparisons beyond descriptive signals

## Before any external beta

A public or external trial would need separate privacy/legal review, a real StudyPack,
scorer calibration, and a written analysis plan.
