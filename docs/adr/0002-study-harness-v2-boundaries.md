# ADR 0002: Study Harness v2 boundaries and evidence ownership

- **Status:** Accepted
- **Date:** 2026-08-25
- **Decision scope:** v0.2 Harness only; the v0.1 runtime remains supported beside it

## Context

The v0.1 engine contains useful protocols, policy experiments, and SQLite tables, but several APIs can accept caller-computed readiness properties. A practical harness needs one reproducible daily loop and a stronger boundary between tutoring output and evidence of learner performance.

## Decision

Harness v2 is an event-sourced subsystem under `src/harness/`. Its only canonical input is the ordered `harness.*` event stream. The projector fails closed: a malformed, unauthorized, or out-of-order event creates an audit anomaly and does not mutate evidence-bearing state.

### Boundaries

1. **Kernel (`types`, `projector`, `evidence-validity`, `completion-policy`)**
   - Pure and deterministic; no SQLite, UI, clock, random IDs, or model calls.
   - Replays state and computes completion.
   - Derives independence, contamination, delay, criterion pass, and completion. These are not command inputs.
   - Positive criterion judgments require literal quotes present in the learner artifact.

2. **Policy (`policies/evidence-loop`)**
   - Selects the next stage from a projection.
   - May recommend an action but cannot create evidence or override the kernel.

3. **Domain adapters (`adapters/builtins`)**
   - Deterministically create rubrics and transfer prompts for `general`, `history`, `law`, and `economics`.
   - Their output is scaffolding, never mastery evidence.

4. **Tutor/runtime (`runtime`)**
   - Turns commands into events and supplies clock/ID dependencies.
   - Records substantive help as contamination of an active attempt.
   - May append a gap-resolution event only after replay proves a clean passing reattempt.

5. **Artifact adapters**
   - Learner text is stored as an artifact with explicit authorship.
   - AI/shared artifacts remain auditable but cannot become learner evidence.
   - tldraw stays optional and outside the kernel. Capture/transcription does not imply learner ownership or criterion satisfaction.

6. **Persistence (`SQLiteHarnessRepository`)**
   - Reuses the existing append-only `study_events` ledger with schema version 2 and stable Harness event IDs.
   - Uses `correlation_id` as the Harness session stream key, avoiding a new mutable state table and avoiding changes to legacy sessions.

## Completion rule

Completion is a function of replayed events only. It requires:

- explicit learner goal confirmation;
- a non-empty target/rubric set;
- an assessed baseline for every target (baseline never counts as mastery);
- no open gaps;
- a clean learner-authored passing retrieval for every target; and
- either clean novel transfer or real delayed retrieval.

When `retentionDays` is present, transfer cannot substitute for a second clean retrieval whose ledger timestamps show the required elapsed interval.

## Consequences

- Invalid history remains visible as anomalies instead of being repaired into evidence.
- The ledger can reproduce decisions and completion fingerprints.
- Assessment still depends on an AI or human reviewer for semantic judgment; the kernel verifies quote grounding and structure, not truth in the external world.
- SQLite serializes writes, but v2 does not yet expose optimistic stream-version checks for concurrent writers.
