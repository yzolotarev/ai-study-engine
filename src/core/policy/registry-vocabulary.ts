/**
 * Metric vocabulary — the human-reviewed contract between the registry XML and
 * the runtime ConditionAST value model.
 *
 * WHY THIS EXISTS
 * ---------------
 * The engine's `ValueExpression` only resolves three kinds today:
 *   - fact (key)            — runtime must populate `context.facts[key]`
 *   - parameter (id)        — runtime must have a policy parameter value
 *   - event_count (type)    — runtime must emit `study_events` of that type,
 *                             optionally within a rolling `windowMs` from NOW.
 *
 * The registry XML introduces 12 `<metric>` names plus `since="<anchor>"`
 * temporal anchoring and `<time_window>` that the current runtime does NOT
 * support. Mapping them blindly would emit ASTs that resolve to `uncertain`
 * forever (dead policies), which violates the anti-theft / human-review rule.
 *
 * So every metric is classified explicitly:
 *   - "ready"             : compiles to an AST fully resolvable by the runtime today
 *   - "reviewable_fact"   : compiles to {kind:"fact", key}; runtime must compute
 *                           the fact. Valid AST, but never fires until wired.
 *   - "reviewable_event"  : compiles to {kind:"event_count", eventType, windowMs};
 *                           runtime must emit that event type.
 *   - "blocked"           : requires runtime semantics that do not exist
 *                           (event anchoring, payload-aware counts). The compiler
 *                           ALWAYS fails closed on these — never emits a false AST.
 *
 * The `requires` field is the actionable instrumentation backlog for human
 * review. Update this file (and the runtime) together; do not let the compiler
 * guess mappings.
 */

import type { ValueExpression, SinceAnchor } from "./condition.js";

export type MetricMode = "ready" | "reviewable_fact" | "reviewable_event" | "blocked";

export interface MetricMapping {
  mode: MetricMode;
  /** Used when mode === "ready". */
  expr?: ValueExpression;
  /** Used when mode === "reviewable_fact". */
  factKey?: string;
  /** Used when mode === "reviewable_event". */
  eventType?: string;
  windowMs?: number;
  /** Used when mode === "reviewable_event" with temporal anchoring (fixed enum). */
  sinceAnchor?: SinceAnchor;
  /** Human-review backlog: what must exist before this metric can fire. */
  requires: string[];
}

const DAY = 24 * 60 * 60 * 1000;

export const METRIC_VOCABULARY: Record<string, MetricMapping> = {
  // ---- blocked: need temporal "since=<anchor>" or payload-aware counting ----
  sensory_input_count: {
    mode: "reviewable_event",
    eventType: "sensory_input",
    sinceAnchor: "last_independent_attempt",
    requires: [
      "Emit study_events event_type='sensory_input' from Objects/Summary/Expand tools (not yet instrumented; the sinceAnchor runtime support is implemented).",
      "sinceAnchor 'last_independent_attempt' resolves via store.findAnchorTimestamp (MAX occurred_at of independent_attempt events in the session).",
    ],
  },
  independent_encoding_count: {
    mode: "reviewable_event",
    eventType: "independent_encoding",
    sinceAnchor: "last_sensory_input",
    requires: [
      "Emit study_events event_type='independent_encoding' for learner-owned encoding operations (not yet instrumented).",
      "sinceAnchor 'last_sensory_input' resolves via store.findAnchorTimestamp (MAX occurred_at of sensory_input events in the session).",
    ],
  },
  expand_invocations: {
    mode: "blocked",
    requires: [
      "Emit study_events event_type='expand_invoke' from the Expand tool.",
      "Anchor 'session_start' is NOT in the fixed SinceAnchor enum (only last_independent_attempt, last_sensory_input, last_contamination_event, phase_start) — left blocked by task scope.",
    ],
  },
  independent_reattempt_count: {
    mode: "reviewable_fact",
    factKey: "independent_reconstruction_count",
    requires: [
      "Literal 'count of independent attempts since contamination_event' is NOT expressible: ValueExpression.event_count has no sinceAnchor, and study_events emission would require attemptBranchId plumbing (appendEvent) plus a target_id that appendEvent does not carry. Per ai-study-engine.md §18, convert only supported predicates.",
      "Faithful supported equivalent: map to fact 'independent_reconstruction_count' (integer 0..n) derived from the contamination closure — store.closeContamination already records closureMethod='independent_reconstruction'. Count = (closureMethod === 'independent_reconstruction' ? 1 : 0); the registry's 'eq 0' means no reconstruction yet. Reclassified from 'blocked' to 'reviewable_fact'.",
      "Future (literal) option: add sinceAnchor to ValueExpression.event_count + store.countStudyEventsByType and emit study_events contamination_event/independent_attempt; would also unblock sensory_input_count, independent_encoding_count, expand_invocations, correct_with_hidden_answer.",
    ],
  },
  correct_with_visible_answer: {
    mode: "blocked",
    requires: [
      "Record attempt outcomes with a cue-visibility flag (visible vs hidden answer).",
      "Add payload-aware counting to event_count (current engine counts only by event_type).",
    ],
  },
  correct_with_hidden_answer: {
    mode: "blocked",
    requires: [
      "Record attempt outcomes with a cue-visibility flag (visible vs hidden answer).",
      "Add payload-aware counting and 'since last_visible' anchoring to event_count.",
    ],
  },

  // ---- reviewable_fact: valid AST, needs the engine to compute the fact ----
  time_since_last_sensory_min: {
    mode: "reviewable_fact",
    factKey: "minutes_since_last_sensory",
    requires: ["Engine must compute minutes_since_last_sensory from the last 'sensory_input' event."],
  },
  nucleus_specified: {
    mode: "reviewable_fact",
    factKey: "nucleus_specified",
    requires: ["Expand tool must record whether a nucleus was provided (boolean fact)."],
  },
  ai_contaminated_artifact_saved: {
    mode: "reviewable_fact",
    factKey: "ai_contaminated_artifact_saved",
    requires: [
      "The provenance tracker ALREADY opens a contamination_records row (status='contaminated') in store.recordOperation when a contaminating help level (structure_reveal/direct_answer/full_solution) is recorded for a target. Do NOT invent a new boolean; the engine derives this fact from getContaminationStatus(targetId) === 'contaminated' (see engine.deriveRegistryFacts).",
      "Scoped per target; the policy evaluator receives targetId and derives the fact for that target. No new event emission needed.",
    ],
  },
  hours_until_deadline: {
    mode: "reviewable_fact",
    factKey: "hours_until_deadline",
    requires: ["Session must carry a deadline; engine computes hours_until_deadline."],
  },

  // ---- reviewable_event: valid AST within a rolling window, needs event emission ----
  sensory_input_count_24h: {
    mode: "reviewable_event",
    eventType: "sensory_input",
    windowMs: DAY,
    requires: ["Emit study_events event_type='sensory_input' from Objects/Summary/Expand tools."],
  },
  encoding_operations_24h: {
    mode: "reviewable_event",
    eventType: "independent_encoding",
    windowMs: DAY,
    requires: ["Emit study_events event_type='independent_encoding' for learner-owned encoding operations."],
  },
};

/**
 * Registry intervention `type` values do not map 1:1 onto the runtime's
 * `intervention_templates.kind` enum (process_only | content_cue | structure_reveal).
 * None of the registry interventions are content_cue/structure_reveal, so the
 * anti-theft boundary is preserved by reducing all of them to `process_only`.
 * The reduction is recorded as a review note — it is a deliberate simplification.
 */
export const INTERVENTION_KIND_REDUCTION: Record<string, "process_only"> = {
  process_only: "process_only",
  blocking: "process_only",
  mandatory: "process_only",
  scheduling: "process_only",
  verification: "process_only",
  triage: "process_only",
};

/** Implementation priority (higher = evaluated/fired first). Mirrors the registry's stated import priority. */
export const BEHAVIOR_PRIORITY: Record<string, number> = {
  bp_answer_theft: 100,
  bp_passive_consumption_after_sensory: 90,
  bp_recognition_mistaken_for_recall: 80,
  bp_expand_without_nucleus: 70,
  bp_cramming_before_deadline: 60,
};

export const SEVERITY_RANK: Record<string, number> = {
  critical: 3,
  high: 2,
  warning: 1,
  medium: 1,
  low: 0,
};
