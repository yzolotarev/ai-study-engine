# AI Study Engine

> An experimental, local-first learning system that separates **AI assistance**
> from **evidence of actual learner understanding**.

Most AI tutors quietly create an *illusion of understanding*: the AI explains,
structures, and solves; the learner recognizes a finished solution. AI Study
Engine inverts that. It tracks what the **learner independently produced**, how
much help was used, and whether they can still do it later or in a new context.

## Core invariant

```
AI output != learner cognition
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
- Pi extension + CLI
- Deterministic tests

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

## Basic use

```bash
npm run study -- start-live "<capability>" "<targetTask>" "<successCriteria>"
npm run study -- status <sessionId>
npm run study -- next <sessionId>
npm run study -- attempt <sessionId> <operation> <author> <helpLevel> <answerVisible> [targetId] [artifactJson]
npm run study -- help <sessionId>
npm run study -- reviews <sessionId>
npm run study -- --help
```

See `npm run study -- --help` for the full command list.

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

This runs the TypeScript typecheck and the full test suite
(**120 tests**, all passing as of v0.1.0).

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
├── src/                  # core engine, policy kernel, db
├── extensions/           # Pi extension + study tools
├── registry/             # antipattern registry (XML)
├── tests/                # deterministic test suite
├── docs/                 # spec, ADRs, research notes
├── integrations/
│   └── tldraw/           # optional capture/transcription bridge (scripts only)
├── skills/               # Pi skills
├── study-cli.ts          # CLI driver
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
