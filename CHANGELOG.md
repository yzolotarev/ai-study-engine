# Changelog

All notable changes to this project are documented here.

## [0.2.0] - 2026-08-25

### Added

- Event-sourced Study Harness v2 with pure fail-closed replay and audit anomalies.
- Projection-only completion policy for baseline, clean retrieval, transfer, and real delayed retrieval.
- Literal quote grounding for every positive rubric criterion.
- Deterministic subject adapters for general study, history, law, and economics.
- SQLite v2 event repository using the existing append-only ledger.
- Twelve `study_v2_*` Pi tools and a separate `npm run harness` CLI.
- Acceptance, unit, negative, temporal-delay, event-order, and SQLite replay tests.
- Harness architecture ADR, v0.1 migration note, quickstart, and CI.

### Changed

- `StudyStore.appendEvent()` can preserve caller-supplied event IDs and schema versions.
- Package version is now `0.2.0`.

### Compatibility

- Legacy v0.1 code and commands remain in place and its original 121 tests remain green.
- No release or tag is implied by this changelog entry.

## [0.1.0]

- Public experimental baseline release.
