# Migrating from v0.1 to v0.2

v0.2 adds Study Harness v2 **beside** the v0.1 engine. It does not delete, rewrite, or automatically convert legacy objectives, sessions, protocols, targets, attempts, reviews, or policy-kernel records.

## What stays compatible

- Existing `npm run study -- ...` commands and `study_*` Pi tools remain available.
- Existing SQLite migrations and legacy tables remain intact.
- Optional tldraw capture/transcription remains available through the legacy adapter.
- A v0.1 database is upgraded by the existing migration runner and can also hold v2 events.

## What is new

- `npm run harness -- ...` drives the deterministic v2 loop.
- Pi exposes `study_v2_*` tools separately from legacy `study_*` tools.
- v2 writes only `harness.*` events (schema version 2) to the existing append-only event ledger.
- v2 state and completion are reconstructed from those events; mutable legacy state is not consulted.

## Important semantic changes

| v0.1 pattern | v0.2 Harness rule |
|---|---|
| Caller supplies readiness/independence/delay booleans | Kernel derives them from event order, authorship, help, assessment, and timestamps |
| Protocol completion may be displayed as progress | Protocol/stage progress is not mastery |
| Assessment JSON shape can be sufficient | Every positive criterion requires literal learner-artifact quotes |
| Transfer or caller-marked delay | Transfer is accepted only when retention is unspecified; delay is elapsed time between clean retrievals |
| Invalid command sequence may fail at a mutable-state boundary | Invalid v2 events remain replayable audit anomalies and do not become evidence |

## Adoption

1. Keep the current database or set a dedicated one with `STUDY_HARNESS_DB`.
2. Run `npm run check`.
3. Start new work with `npm run harness -- start ...`.
4. Do not copy legacy mastery/readiness flags into v2. Define a fresh goal, confirmation, and targets.
5. Keep legacy sessions for audit/history. There is intentionally no automatic evidence migration because v0.1 records may not prove the v2 invariants.

## Rollback

Switch back to the v0.1 CLI/tools. v2 events are namespaced and ignored by legacy flows. Do not delete them; they are the v2 audit trail.
