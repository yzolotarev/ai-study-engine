# AI Study Engine

> An experimental, local-first learning system that separates **AI assistance**
> from **evidence of actual learner understanding**.

Most AI tutors quietly create an *illusion of understanding*: the AI explains,
structures, and solves; the learner recognizes a finished solution. AI Study
Engine inverts that. It tracks what the **learner independently produced**, how
much help was used, and whether they can still do it later or in a new context.

## Core invariant

```
AI output != learner evidence
```

AI may orchestrate, scaffold, verify, retrieve sources, and preserve state.
It must never silently become proof that the learner understands something.

## Why this exists

The core loop optimizes for **time-to-demonstrated-independent-capability**, not
speed of content consumption:

```
Goal
  → Independent attempt
  → Diagnose biggest blocker
  → Minimal intervention
  → Independent reattempt
  → Transfer / delayed retrieval
```

## Features

- Goal contracts
- Deterministic study-policy kernel (reproducible, no hidden LLM branching)
- SQLite canonical state
- Attempt / evidence tracking
- Contamination & provenance tracking (who produced each piece)
- Gaps
- Minimal-help escalation
- Delayed retrieval scheduling
- Transfer verification
- Optional tldraw learner-workspace integration
- AI-derived visual transcription kept strictly separate from learner evidence
- Pi extension + separate legacy and Harness v2 CLIs
- Pure event replay with fail-closed audit anomalies
- Deterministic adapters for general, history, law, and economics
- Deterministic tests and CI

## Current status

**Experimental / research prototype.**

This is **not** a validated medical or educational product. There is **no claim**
of guaranteed learning gains, scientifically proven efficacy, "100x"
improvement, or a complete implementation of any commercial course. The
methodology is under active experimentation.

## Architecture

```
tldraw (optional)
   │
   ▼
Capture Core
   │
   ▼
canonical learner artifact
   │
   ▼
optional AI transcription (kept separate)
   │
   ▼
Study Engine
   │
   ▼
attempts / evidence / gaps / reviews
   │
   ▼
SQLite
```

Key distinctions:

- **Capture** = learner fact (what they drew / wrote).
- **Transcription** = AI observation of that capture (non-canonical).
- **Learner attempt** = evidence.
- **Verified mastery** = independent + delayed / transfer evidence.

Design and upgrade notes:

- [ADR 0002: Harness v2 boundaries](docs/adr/0002-study-harness-v2-boundaries.md)
- [Migration from v0.1 to v0.2](docs/migration-v0.1-to-v0.2.md)
- [Changelog](CHANGELOG.md)

## Requirements

- Node.js >= 22.5
- npm
- Python 3 (for the optional tldraw bridge)
- Optional:
  - tldraw Offline with Local Canvas API
  - llama.cpp app/CLI
  - Gemma 4 E2B GGUF backend
  - NVIDIA GPU recommended for local vision (not required for the core engine)

## Installation

```bash
git clone https://github.com/<you>/ai-study-engine.git
cd ai-study-engine
npm install
npm run check
```

Optional config:

```bash
cp .study-engine/config.example.json .study-engine/config.local.json
# then edit the paths inside it
```

## Study Harness v2 quickstart

Harness v2 is separate from the legacy v0.1 CLI. Its deterministic cycle is:

```
Goal → Confirm → Targets → Baseline → Gap → Remediation
     → Independent retrieval → Transfer / delayed retrieval → Completion
```

List commands:

```bash
npm run harness -- --help
```

The following real history example uses fixed rubric IDs so the assessment can
cite each criterion. Each positive assessment quote must occur literally in the
submitted learner text.

```bash
export STUDY_HARNESS_DB=/tmp/weimar-harness.sqlite
rm -f "$STUDY_HARNESS_DB"

START=$(npm run --silent harness -- start learner-1 history \
  "Explain why the Weimar Republic collapsed" \
  "Write a causal historical argument" \
  "Accurate chronology, specific evidence, differentiated causes")
SID=$(printf '%s' "$START" | jq -r .sessionId)

npm run --silent harness -- confirm "$SID" "Yes, this is my goal"
npm run --silent harness -- targets "$SID" '[{"id":"weimar","description":"Explain the collapse","criteria":[{"id":"chronology","description":"Accurate chronology and actors"},{"id":"evidence","description":"Specific evidence for causal claims"},{"id":"causation","description":"Distinguish context, causes, and consequences"}]}]'

BASE=$(npm run --silent harness -- begin-attempt "$SID" baseline '["weimar"]')
BASE_ID=$(printf '%s' "$BASE" | jq -r .attemptId)
npm run --silent harness -- submit "$SID" "$BASE_ID" \
  "chronology runs from 1929 to 1933; causes include institutional weakness"
npm run --silent harness -- assess "$SID" "$BASE_ID" '[{"criterionId":"chronology","met":true,"quotes":["chronology runs from 1929 to 1933"]},{"criterionId":"evidence","met":false,"quotes":[]},{"criterionId":"causation","met":true,"quotes":["causes include institutional weakness"]}]'

GAP=$(npm run --silent harness -- gap "$SID" "$BASE_ID" weimar evidence \
  "Causal claims lack named evidence")
GAP_ID=$(printf '%s' "$GAP" | jq -r .gapId)
npm run --silent harness -- remediate "$SID" "$GAP_ID" \
  "Add one named fact for each causal link" exercise

RETRY=$(npm run --silent harness -- begin-attempt "$SID" retrieval '["weimar"]')
RETRY_ID=$(printf '%s' "$RETRY" | jq -r .attemptId)
ANSWER="chronology links the 1929 crash to 1933; evidence includes mass unemployment and presidential decrees; causation separates structural weakness from contingent elite decisions"
npm run --silent harness -- submit "$SID" "$RETRY_ID" "$ANSWER"
npm run --silent harness -- assess "$SID" "$RETRY_ID" '[{"criterionId":"chronology","met":true,"quotes":["chronology links the 1929 crash to 1933"]},{"criterionId":"evidence","met":true,"quotes":["evidence includes mass unemployment and presidential decrees"]},{"criterionId":"causation","met":true,"quotes":["causation separates structural weakness from contingent elite decisions"]}]'

TRANSFER=$(npm run --silent harness -- begin-attempt "$SID" transfer '["weimar"]' \
  "Use the causal framework on a different democratic breakdown")
TRANSFER_ID=$(printf '%s' "$TRANSFER" | jq -r .attemptId)
NOVEL="chronology orders the novel case; evidence names its constitutional crisis; causation separates long-run polarization from the triggering coup"
npm run --silent harness -- submit "$SID" "$TRANSFER_ID" "$NOVEL"
npm run --silent harness -- assess "$SID" "$TRANSFER_ID" '[{"criterionId":"chronology","met":true,"quotes":["chronology orders the novel case"]},{"criterionId":"evidence","met":true,"quotes":["evidence names its constitutional crisis"]},{"criterionId":"causation","met":true,"quotes":["causation separates long-run polarization from the triggering coup"]}]'

npm run --silent harness -- complete "$SID"
```

If `retentionDays` is supplied to `start`, transfer does **not** complete the
session. A second clean retrieval must begin after that many real elapsed days.
Call `status` or `next` at any time; both are computed by replaying the journal.

### Legacy v0.1 CLI

Legacy commands remain available unchanged:

```bash
npm run study -- start-live "<capability>" "<targetTask>" "<successCriteria>"
npm run study -- status <sessionId>
npm run study -- next <sessionId>
```

### Optional tldraw workflow

1. Install tldraw Offline + a local vision backend (see
   `integrations/tldraw/README.md`).
2. Point `captureCoreDir` / `transcribeDir` in your `config.local.json` at
   `integrations/tldraw/`.
3. From a session: `npm run study -- canvas <sessionId>` then
   `npm run study -- confirm-canvas <sessionId> '[<observationId>]'`.

## Tests

```bash
npm run check
```

This runs the TypeScript typecheck and the complete legacy + Harness v2 test
suite. The original **121 v0.1 tests** remain part of the check.

## Privacy

- Study state is local SQLite by default.
- Learner artifacts stay local unless you explicitly publish them.
- If you replace the local vision backend with a remote one, that backend has
  its own privacy characteristics — the project does not send learner data
  anywhere by default.

## Design principles

- Nodes are cheap; arrows are sacred.
- The learner owns grouping and relations.
- AI assistance must not silently become evidence.
- Recognition != recall.
- Protocol completion != mastery.
- Uncertainty != absence of cognition.

## Repository structure

```
ai-study-engine/
├── src/                  # legacy core plus event-sourced harness/, policy, db
├── extensions/           # Pi extension + legacy and study_v2 tools
├── registry/             # antipattern registry (XML)
├── tests/                # deterministic test suite
├── docs/                 # spec, ADRs, research notes
├── integrations/
│   └── tldraw/           # optional capture/transcription bridge (scripts only)
├── skills/               # Pi skills
├── study-cli.ts          # legacy CLI driver
├── harness-cli.ts        # Harness v2 CLI driver
├── package.json
├── README.md
├── LICENSE
├── CONTRIBUTING.md
├── SECURITY.md
└── .gitignore
```

## Contributing

Bug reports, learning-protocol experiments, UX experiments, evidence-model
criticism, and reproducible test cases are all welcome. See
[CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE).

## Acknowledgements

Inspired in part by publicly discussed learning principles associated with
Justin Sung / iCanStudy, but this is an **independent experimental
implementation** and is **not affiliated with or endorsed by** Justin Sung or
iCanStudy. No proprietary course material is included.
