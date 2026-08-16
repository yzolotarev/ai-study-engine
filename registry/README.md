# Studying Antipatterns Registry

Canonical source: `studying-antipatterns.registry.xml` (v1.1).

This registry is the human-authored, reviewable specification of learning
antipatterns (anti-theft protocol, provenance tracking, sensory-tool misuse).
It is **not** executable on its own — it is compiled into the deterministic
policy kernel via `src/core/policy/registry-compiler.ts`.

## Import pipeline (per ai-study-engine.md §18)

```
XML
  -> parseXml            (registry-xml.ts, dependency-free)
  -> validateStructure   (structural validation)
  -> METRIC_VOCABULARY   (XML <metric> -> runtime ValueExpression; human-reviewed)
  -> compileCondition    (ConditionAST)
  -> CorePolicySeed / CoreInterventionTemplateSeed / CoreParameterSeed
  -> SQLite (policy_definitions / intervention_templates / policy_parameters)
  -> deterministic evaluator (engine.ts)
```

## Human-review gate (rule #3 — no auto-enable)

The compiler NEVER activates anything. Two modes:

- **`strict`** (default, CI): any metric not fully resolvable by the runtime
  today aborts the whole compile with `RegistryCompileError`. Used to block
  silent activation.
- **`review`**: metrics classified `reviewable_*` compile to valid ASTs tagged
  `status: "experimental"` (never `"active"`); metrics classified `blocked`
  cannot be expressed and are skipped with actionable notes. Output is a draft
  needing human review + instrumentation before any bundle activation.

The compiler fails **closed**: an unmapped or unsupported metric is a hard
error, never a silently-`uncertain` policy.

## Metric vocabulary — the open backlog

The engine's `ValueExpression` resolves only `fact`, `parameter`, and
`event_count(eventType, windowMs?)`. The registry's 12 metrics map as follows
(see `registry-vocabulary.ts`):

| Metric | Class | Runtime target | Required before it can fire |
|---|---|---|---|
| `hours_until_deadline` | reviewable_fact | `fact: hours_until_deadline` | session must carry a deadline |
| `time_since_last_sensory_min` | reviewable_fact | `fact: minutes_since_last_sensory` | engine computes from last sensory event |
| `nucleus_specified` | reviewable_fact | `fact: nucleus_specified` | Expand tool records nucleus presence |
| `ai_contaminated_artifact_saved` | reviewable_fact | `fact: ai_contaminated_artifact_saved` | provenance tracker sets the fact |
| `sensory_input_count_24h` | reviewable_event | `event_count(sensory_input, 24h)` | emit `sensory_input` events |
| `encoding_operations_24h` | reviewable_event | `event_count(independent_encoding, 24h)` | emit `independent_encoding` events |
| `sensory_input_count` | reviewable_event | `event_count(sensory_input, sinceAnchor=last_independent_attempt)` | emits study_events 'sensory_input' from sensory tools (future); sinceAnchor runtime implemented in condition.ts/store/engine. |
| `independent_encoding_count` | reviewable_event | `event_count(independent_encoding, sinceAnchor=last_sensory_input)` | emits study_events 'independent_encoding' (future); sinceAnchor runtime implemented. |
| `expand_invocations` | **blocked** | — | needs `since=session_start` + `expand_invoke` events |
| `independent_reattempt_count` | reviewable_fact | `fact: independent_reconstruction_count` | derived from contamination closure (`closeContamination(method='independent_reconstruction')`); count 0/1. Literal count-since-anchor not expressible — see future work. |
| `correct_with_visible_answer` | **blocked** | — | needs cue-visibility flag + payload-aware counts |
| `correct_with_hidden_answer` | **blocked** | — | needs cue-visibility flag + `since=last_visible` |

The current `event_count` supports only a rolling `windowMs` from *now*, not
`since="<event_anchor>"`. Temporal anchoring and payload-aware attempt counting
require a runtime extension (`ValueExpression.event_count.sinceAnchor` +
`store.countStudyEventsByType` anchor support, or derived observation facts).

Net effect: in `review` mode **`bp_cramming_before_deadline`**, **`bp_answer_theft`**, and
**`bp_passive_consumption_after_sensory`** compile today (their metrics are all
`reviewable_*`, including the new `sinceAnchor` anchored event counts). The remaining
2 behaviors (`bp_expand_without_nucleus`, `bp_recognition_mistaken_for_recall`) each
contain at least one `blocked` metric (`session_start` anchor is outside the fixed
4-anchor enum; cue-visibility metrics need payload-aware counting) and are held.

## sinceAnchor (temporal anchoring) — implemented

`ValueExpression.event_count` gained an optional `sinceAnchor` field (fixed enum:
`last_independent_attempt | last_sensory_input | last_contamination_event |
phase_start`). Resolution: `store.findAnchorTimestamp(learnerId, sessionId, anchor)`
returns epoch-ms or `null`; `store.countStudyEventsByTypeSince(...)` counts events at/after
it. The evaluator treats a missing anchor as `uncertain` (never `false`). Rolling
`windowMs` event_count is unchanged (backward compatible). `phase_start` and
`last_contamination_event` resolve to null until their events are emitted — see
`registry-since-anchor.test.ts`.

## Vertical slice wired: `bp_answer_theft`

`bp_answer_theft` is the first behavior proven end-to-end (see
`tests/registry-answer-theft.test.ts`):

- The two metrics map to facts already supported by the provenance model — no
  new event emission, no `sinceAnchor` AST extension:
  - `ai_contaminated_artifact_saved` → `getContaminationStatus(target) === 'contaminated'`
  - `independent_reattempt_count` → `independent_reconstruction_count`
    (`closeContamination(method='independent_reconstruction')` → 1, else 0)
- `engine.ts` derives those facts via `deriveRegistryFacts(store, targetId)`,
  merged into `context.facts` before evaluation — callers need no change.
- `store.deployRegistryBundle(compiled)` inserts the intervention templates +
  policy definitions + bundle; `store.activateBundle(sessionId, …)` switches the
  session's active bundle. Both are human-invoked only (review gate).
- Test asserts: recording a contaminating `recordOperation` (status `contaminated`)
  → detection `matched` + intervention `i_require_reconstruction` selected;
  `closeContamination(..., 'independent_reconstruction')` → detection `not_matched`.

This deliberately uses the existing `contamination_records` state rather than
inventing a parallel boolean fact or emitting `study_events` (which would
require `attemptBranchId` plumbing and a `target_id` that `appendEvent` does not
carry). Per ai-study-engine.md §18, only supported predicates are converted.

## Intervention kind reduction (review note)

Registry `<intervention type>` values (`blocking`, `mandatory`, `scheduling`,
`verification`, `triage`, `process_only`) do not map 1:1 onto the runtime
`intervention_templates.kind` enum (`process_only | content_cue | structure_reveal`).
All registry interventions reduce to `process_only`. This is deliberate and
preserves the anti-theft boundary (none become `content_cue`/`structure_reveal`).

## Overlap with hand-seeded core policies

`src/core/policy/core-policies.ts` already seeds two policies "from
studying-antipatterns.registry.xml":

- `bp_procedural_consumption_without_attempt` ≈ `bp_passive_consumption_after_sensory`
  (conceptual sibling; different metric vocabulary)
- `bp_missed_consolidation_window` exists independently.

When the registry is activated as bundle `registry-antipatterns`, the
conflict-resolver must dedupe/retire overlapping core policies to avoid double
interventions. This is a human-review item before activation.

## Run

```bash
node --import tsx --test tests/registry-compiler.test.ts
```

To compile a registry string:

```ts
import { compileRegistry } from "./src/core/policy/registry-compiler.js";
const result = compileRegistry(xmlString, { mode: "review" });
// result.policies / result.interventions / result.parameters -> insert as experimental
```
