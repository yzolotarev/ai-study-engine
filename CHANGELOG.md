# Changelog

All notable changes to this project are documented here.

## [0.2.0] - 2026-08-25

### Evaluation Layer completion pass

- Added schema-backed human/synthetic provenance, assessment isolation, immutable started snapshots,
  delayed gating, blind scoring, contamination-aware clean retries, and executable policy runtime.
- Added a deterministic 64-cell synthetic benchmark with no winner/effectiveness claim.
- Added hash-chained local evaluation audit events, integrity verification, opt-in encrypted backups,
  and explicit participant deletion with hashed tombstones.
- Added calibration StudyPack, operator runbook, export preview binding, and research redaction.
- Full local check: 232 tests passing; no human learning efficacy claim is implied.

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

### Security hardening (audit follow-up, pre-merge blockers)

- **Trusted learner ingress.** `StudyHarness` exposes no public path that emits a `learner` event; learner confirmation and artifact submission are gated behind `Symbol` keys reachable only via `TrustedLearnerIngress`, which is **not** registered as an AI-callable Pi tool. The packaged `study_v2_*` surface cannot create learner evidence or confirm a goal (`study_v2_confirm` does not exist; `study_v2_request_learner_input` records nothing and returns the trusted ingress instruction; `study_v2_submit` accepts only `ai`/`shared`). `harness-cli.ts` is the documented local human-operated ingress.
- **Fail-closed decoding.** Unknown event types, malformed payloads, bad actors, duplicate IDs, unknown targets/attempts/gaps, unsupported schemas, and invalid timestamps each replay as a visible audit anomaly without mutating evidence.
- **Schema/versioning.** `HARNESS_SCHEMA_VERSION` is now `3`; pre-hardening value `2` is `PRE_HARDENING_SCHEMA_VERSION` and replays as an unverified anomaly that cannot prove mastery. A separate `policyVersion` was deliberately not introduced.
- **Anomaly-gated completion.** `StudyHarness.complete()` records no completion event while the journal has any audit anomaly, and replay never hides or repairs such anomalies.
- **Deterministic novelty.** Transfer must differ from the primary retrieval by prompt and by artifact after NFKC normalization, case folding, punctuation/whitespace stripping, with Jaccard `< 0.72` and containment `< 0.85`. This is a copy-guard, not a semantic-proof.
- **Whitespace-only / punctuation-only evidence quotes are rejected**, and substantive help requires and contaminates an active unsubmitted attempt.
- **SQLite integrity.** `SQLiteHarnessRepository` fails closed on `UNVERIFIED_EVENT` / `PAYLOAD_HASH_MISMATCH` via SHA-256 `payload_hash` verification, without changing the legacy ledger contour.
- **Mutation resistance.** `MemoryHarnessRepository` and the projector clone on store/load/snapshot so callers cannot mutate stored or projected state.
- Added `tests/harness-hardening.test.ts` (adversarial suite) covering AI-impersonates-learner, anomaly-blocks-completion, corrupt-SQLite fail-closed, pre-hardening v2 replay, whitespace quotes, idempotent completion, mutation resistance, and the full `submit`/`assess`/`done` lifecycle.
- Added optional Hypothesis Stimulation v0 scaffolds to `NextAction`: deterministic domain prompts for learner prediction before feedback and model revision before remediation. Scaffolds are policy output only, never persisted evidence or completion requirements; `tests/hypothesis-stimulation.test.ts` covers the trusted boundary, determinism, no-ledger mutation, domain variants, disclosure safety, and backward-compatible completion.

### Compatibility

- Legacy v0.1 code and commands remain in place and its original 121 tests remain green.
- No release or tag is implied by this changelog entry.

## [0.1.0]

- Public experimental baseline release.
