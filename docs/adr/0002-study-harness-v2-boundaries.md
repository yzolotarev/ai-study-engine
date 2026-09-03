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
   - May attach an optional deterministic hypothesis scaffold; the scaffold is instructional output, not an event or evidence.

3. **Domain adapters (`adapters/builtins`)**
   - Deterministically create rubrics, transfer prompts, and domain-appropriate hypothesis scaffolds for `general`, `history`, `law`, and `economics`.
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
   - Reuses the existing append-only `study_events` ledger with hardened schema version 3 and stable Harness event IDs.
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

## Hardening amendments (post-audit)

These decisions close the P0/P1 findings from the pre-merge audit. They are merge blockers for Study Harness v2 and are exercised by `tests/harness-hardening.test.ts`.

### Trusted learner ingress boundary

The audit finding is that caller-supplied provenance (`author: "learner"`, a `confirm: true` flag, or a prompt promise) is not security. Anything a model can place in a tool call is untrusted.

- `StudyHarness` exposes no public method that emits a `learner` event. Learner confirmation and learner artifact submission are gated behind `Symbol` keys (`TRUSTED_CONFIRM`, `TRUSTED_SUBMIT`) reachable only through `TrustedLearnerIngress`.
- `TrustedLearnerIngress` is intentionally **not** registered as an AI-callable Pi tool. The packaged AI surface (`extensions/study-engine/harness-tools.ts`) therefore cannot create learner evidence or confirm a goal. `study_v2_confirm` does not exist; `study_v2_request_learner_input` returns the trusted human ingress instruction and records nothing.
- `study_v2_submit` only accepts `ai` or `shared` authorship; it can never produce `learner` evidence. `recordArtifact` enforces the same at the runtime layer.
- `harness-cli.ts` remains a local human-operated ingress with the documented trust assumption that the operator is the learner. This is the only supported path for learner confirmation/evidence; the limitation and the required future Pi user-role integration are recorded here.
- The kernel derives nothing from caller strings: no `passed`/`independent`/`delayed`/`verified` flags survive into the event model or the completion decision.

### Schema and versioning strategy (chosen: schema version bump, not a separate policyVersion)

The vulnerable completion policy shipped only inside the still-Draft, unreleased Harness v2. There is no released v2 stream to stay compatible with, and preserving the vulnerable policy for compatibility would have re-introduced the finding.

- We chose to **bump `HARNESS_SCHEMA_VERSION` from 2 to 3** and treat the prior pre-hardening value as `PRE_HARDENING_SCHEMA_VERSION = 2`.
- A *separate* `policyVersion` was rejected: replay-derived completion couples schema shape and policy semantics, so a distinct `policyVersion` would have implied a backward-compatibility contract we do not have. One monotonic schema version is simpler and fail-closed.
- Any event decoded with `schemaVersion === 2` replays as a `PRE_HARDENING_SCHEMA` audit anomaly and **cannot** contribute to mastery. Version 1 (legacy contour) and any other value replay as `UNSUPPORTED_SCHEMA`. Raw/malformed envelopes replay as `MALFORMED_EVENT`; unknown types as `UNKNOWN_EVENT_TYPE`. All of these retain the raw row as a visible anomaly rather than mutating evidence.
- Legacy v0.1 code, tables, tools, and tests are untouched; no legacy evidence is auto-migrated.

### Deterministic novelty heuristic (copy-guard, not a semantic-proof)

`isNovelTransfer` blocks transfer that merely re-cases, re-punctuates, or re-spaces an earlier artifact or prompt.

- `normalizeForNovelty` applies Unicode NFKC, lower-casing, removal of all non-letter/non-digit characters, and whitespace collapsing.
- `compareTextNovelty` reports Jaccard token similarity and containment; a transfer is *not* distinct when `tokenJaccard >= 0.72` or `tokenContainment >= 0.85`.
- Prompt and artifact are compared **separately**; both must be distinct and the transfer must start after the passing assessed primary retrieval.
- This is explicitly a guard against obvious duplication, **not** a proof of semantic novelty. Semantic judgment stays with the assessor. (Recorded here per the audit requirement.)

### SQLite integrity

`SQLiteHarnessRepository` fails closed on tampered history: every row must carry `integrity_status = 'verified'` and a SHA-256 `payload_hash` matching `payload_json`, otherwise it replays as `UNVERIFIED_EVENT` / `PAYLOAD_HASH_MISMATCH`. This is added without changing the legacy ledger contour.

### Mutation resistance

`MemoryHarnessRepository` stores `structuredClone` copies and `load` returns clones; `projectHarness` snapshots via `structuredClone`. A caller cannot mutate projected or stored state in place.

## Hypothesis Stimulation v0 amendment

Hypothesis Stimulation is a policy-layer scaffold for the loop:

```text
AI/system asks → learner commits prediction → feedback becomes available
→ learner compares → learner updates the model
```

- The AI/system may formulate a situation or question, but it does not generate the learner's hypothesis. Only the existing trusted learner ingress can receive the learner's response; there is no hypothesis-specific learner event or AI-callable recording tool.
- The optional `NextAction.hypothesisScaffold` uses `disclosurePolicy: "commit-before-feedback"`. It can appear for a baseline or transfer commit, and as a `revise` prompt before remediation. It is deterministic, backward-compatible, and carries no assessor rationale, evidence quote, answer, or remediation content.
- The scaffold does not append events, create evidence, close gaps, increase mastery, or become a completion prerequisite. Prediction error is a learning strategy, not a reward for being wrong and not a completion criterion. Existing callers may ignore the optional field and follow the existing lifecycle unchanged.
- A scaffold response is expected to be included in the learner's ordinary trusted attempt artifact. The artifact remains subject to the existing provenance and quote-grounded assessment rules; no parallel hypothesis evidence is persisted.
- Domain prompts ask for prediction, reason/mechanism, confidence or decisive factor, and a falsifying or boundary condition. Revision prompts ask what assumption failed, what question remains, what model change is expected, and what next prediction follows. They intentionally avoid disclosing the answer, assessor rationale, evidence quotes, or concrete remediation before submission.
- This feature stimulates hypothesis generation but does not establish the quality of the learner's thinking, causal model, or semantic novelty. No universal learning guarantee is claimed.
- The feature lives in the policy layer because it is a deterministic recommendation about the next learner action. Putting it in the evidence kernel would incorrectly turn an optional instructional prompt into an evidence or mastery rule.
