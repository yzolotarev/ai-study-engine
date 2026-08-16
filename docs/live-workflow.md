# AI Study Engine — LIVE V1 Workflow (tldraw + Gemma)

Local-first, evidence-constrained study engine. Freehand tldraw board →
capture → **non-canonical** AI transcription → runtime-controlled protocol.

## Hard constraints (enforced, not advisory)

- **Single vision backend**: `ggml-org/gemma-4-E2B-it-GGUF:Q4_0`. No fallback.
  If Gemma fails, the pipeline **fails closed** (no `latest_transcription.json`
  update, no canvas artifact recorded).
- **Capture Core is canonical and immutable** by the AI layer. `transcribe.py`
  only *reads* `latest_capture.json`; it can never modify it.
- **AI transcription is non-canonical and non-learner-owned**
  (`canonical:false`, `learner_owned:false`). It never creates semantic
  relations, never closes gaps, never raises mastery.
- **Protocol advancement comes from SQLite**, never from caller-supplied
  `completedArtifacts`. `study_record_artifact` ignores any `completedArtifacts`
  argument and reads `store.getValidProtocolEvidence(sessionId)` instead.
- The runtime controller (`selectNextAction`) is the **single source of truth**
  for the next action; it reads DB-persisted evidence and the protocol executor.

## Pipeline

```
tldraw (freehand) ──Capture Core──▶ latest_capture.json (CANONICAL)
                                       │
                          Gemma E2B (single inference)
                                       │
                                       ▼
                            latest_transcription.json (NON-CANONICAL)
                                       │
              study_capture_canvas records canvas_artifacts row (canonical_flag=0)
                                       │
                 study_confirm_canvas: learner confirms LITERAL observations only
                                       │
                       study_select_next: runtime controller decides next move
```

## Modules

| Layer | File | Role |
|-------|------|------|
| Capture | `transcriber/capture.py` (canonical, do not modify) | screenshot + metadata |
| Transcription | `transcriber/transcribe.py` + `transcription_prompt_v1.md` + `transcription_schema_v1.json` | one Gemma inference → observation |
| Bridge | `src/adapters/tldraw-bridge.ts` | runs capture+transcribe, binds verified SHA |
| Runtime | `src/core/runtime-controller.ts` | single source of truth for next action |
| Evidence | `src/core/evidence-ledger.ts` | pure, DB-free evidence rules |
| Learner state | `src/core/learner-state.ts` | derive ownership/readiness from rows |
| Help | `src/core/help-controller.ts` (`chooseMinimalHelp`) | minimal pedagogically safe help |
| Storage | `src/db/store.ts` + `src/db/migrations/010_runtime_engine.sql` | canvas/evidence/target/review tables |
| Tooling | `extensions/study-engine/study-tools.ts` + `index.ts` | Pi tools + `/study-*` commands |
| CLI | `study-cli.ts` (`npm run study`) | scriptable driver |

## CLI usage

```bash
export STUDY_DB=/tmp/ai-study-engine.sqlite   # or .study-engine/study.sqlite by default
npm run study -- start-live "<capability>" "<targetTask>" "<successCriteria>"
npm run study -- canvas <sessionId>
npm run study -- confirm-canvas <sessionId> '["t1","o1"]'
npm run study -- next <sessionId>
npm run study -- attempt <sessionId> <operation> <author> <helpLevel> <answerVisible> [targetId]
npm run study -- assess <sessionId> <targetId> '<dimensionsJson>' [criticalErrorsJson] [answerVisibleBefore] [delayed]
npm run study -- help <sessionId> [currentLevel] [targetId] [--explicit-answer] [--surrender] [--blocking]
npm run study -- reviews <sessionId>
npm run study -- end <sessionId>
```

## Pi commands

`/study-start`, `/study-status`, `/study-next`, `/study-canvas`,
`/study-runtime`, `/study-review`, `/study-end`. All study tools are also
registered as Pi tools.

## Tests

`tests/evidence-integrity.test.ts` (pure, no DB/AI), `tests/tldraw-bridge.test.ts`,
`tests/runtime-controller.test.ts`, `tests/live-workflow.test.ts`, plus the
existing engine suite. Run `npm run check` (tsc + node --test).

## Migration note

Runtime tables live in `src/db/migrations/010_runtime_engine.sql` (version 10),
registered after the existing migrations 001–009. It also links a goal contract
to its session (`study_sessions.contract_id`).
