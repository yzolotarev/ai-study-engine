# AI Study Engine v1 — Technical Specification

**Status:** Draft v1  
**Target:** reusable local-first study engine for multiple users, implemented as a Pi package  
**Methodological basis:** Justin Sung/iCanStudy principles plus explicitly marked product decisions  
**Created from:**
- internal research notes on Justin Sung / iCanStudy learning principles
- an audit of eight under-specified points in that methodology
- a research synthesis of ten mechanisms from an Obsidian vault
- supplied learning-methodology notes and the two Pi-learning video transcripts

---

## 1. Product definition

AI Study Engine is a tutor runtime that removes logistical and informational friction while preserving the learner's own relational encoding.

It is not an answer generator, automatic note maker, or universal flashcard generator. It is a deterministic learning state machine around an LLM tutor.

### 1.1 Product promise

The engine should minimize **time to demonstrated capability**, not maximize reading speed or content throughput.

A capability is demonstrated only through evidence appropriate to the target:
- free generation;
- relational explanation;
- reconstruction;
- application;
- transfer;
- delayed retrieval when long-term retention matters.

### 1.2 The 100× goal

“100× faster” is a product research target, not a methodological claim and not a launch promise.

It must be measured as:

```text
acceleration = baseline median time-to-criterion / engine median time-to-same-criterion
```

The comparison is valid only when both groups/tasks use:
- equivalent starting knowledge;
- the same target assessment;
- the same mastery rubric;
- equivalent delayed-retention checks;
- equivalent transfer checks.

The engine must never report acceleration based only on content consumed, summaries produced, confidence, recognition, or session duration.

### 1.3 Non-goals for v1

- Replacing teachers or authoritative sources.
- Claiming a scientifically proven 100× improvement.
- Automatically producing the learner's final conceptual map.
- Supporting every domain equally well at launch.
- A universal numerical model of human cognition.
- A fully autonomous calendar optimizer.
- A cloud multi-tenant service.

---

## 2. Provenance vocabulary

Every pedagogical rule, default, and generated factual claim must carry provenance.

| Label | Meaning |
|---|---|
| `SUNG_DIRECT` | Directly supported by a primary Justin Sung/iCanStudy source. |
| `SUNG_INFERRED` | Product interpretation compatible with direct Sung principles. |
| `LOCAL_PROTOCOL` | Existing user workflow found in the Obsidian vault. |
| `PRODUCT_DECISION` | Engineering decision made for this engine. |
| `EXPERIMENTAL` | Unvalidated policy that must be measured and may change. |
| `USER_PREFERENCE` | Individual configuration, never generalized to other users. |

The runtime must not present `SUNG_INFERRED`, `LOCAL_PROTOCOL`, or `PRODUCT_DECISION` as “Justin Sung says”.

---

## 3. Core invariants

These invariants are mandatory unless a future evidence review explicitly changes them.

### 3.1 Learner-owned cognition

The learner remains the author of:
- questions;
- meaningful groups/chunks;
- relationships and causal links;
- prioritization;
- hypotheses about structure;
- explanations;
- target-task application.

The AI may scaffold, inspect, challenge, verify, and compare these artifacts after an attempt. It may not silently substitute its own organization and then treat learner recognition as understanding.

**Provenance:** `SUNG_DIRECT` for active relational encoding; automation boundary is `SUNG_INFERRED`.

### 3.2 Logistics may be automated

The engine may automate:
- source discovery;
- source indexing;
- provenance capture;
- prerequisite hypotheses;
- scheduling;
- state persistence;
- retrieval/practice question generation after the relevant target has been encoded;
- neutral process prompts that do not supply inquiry content, groups, relations, or priorities;
- visual generation;
- fact-checking;
- reference storage;
- progress calculations.

### 3.3 Familiarity is not mastery

A layman explanation may be shown before dense study to create familiarity. It does not count as evidence of understanding.

### 3.4 Attempts precede evaluative feedback

During retrieval and diagnosis, the engine hides answers until the learner attempts the target or explicitly exits the attempt.

### 3.5 Inquiry/AI boundary

Initial inquiry is learner-owned. Before the learner's first inquiry/structure attempt for a target, AI must not supply content-bearing questions, headings, groups, relationships, order, or priorities that define what structure the learner should find.

AI may before that attempt:
- ask neutral process prompts such as “What seems important or confusing to you?”;
- provide source navigation and logistics;
- give a concise layman explanation of a concept already selected by the learner, marked as familiarity rather than mastery.

After a learner attempt, AI may localize gaps, challenge the artifact, or present separately labelled alternatives through the help ladder. AI-generated Bloom or target-task questions are allowed for retrieval/practice after the target has been encoded, provided answers remain hidden, cues vary, and the question tests generation rather than recognition.

Any externally supplied relational frame is marked `ai_authored` and cannot become learner-owned evidence until the learner independently reconstructs or applies it with a varied cue.

**Provenance:** learner-owned questions/grouping/order are `SUNG_DIRECT`; AI layman explanations and AI-generated practice questions are `SUNG_DIRECT`; this timing firewall and authorship rule are `SUNG_INFERRED` plus `PRODUCT_DECISION` because Sung provides no formal AI-specific policy.

### 3.6 No mastery from recognition alone

MCQ and recognition can screen broadly but cannot close a conceptual unit.

### 3.7 State is auditable

Every meaningful state change must point to evidence: an answer, artifact, assessment, source, or explicit user report.

### 3.7 One giant system prompt is forbidden

Phase rules, domain rules, user preferences, tool instructions, and historical lessons must remain separate and load progressively.

---

## 4. Architecture overview

```text
┌──────────────────────────────────────────────────────────────┐
│                         Pi TUI                               │
│ commands • quiz UI • widgets • messages • session transcript│
└─────────────────────────────┬────────────────────────────────┘
                              │
┌─────────────────────────────▼────────────────────────────────┐
│              Study Orchestrator Pi Extension                │
│ phase guard • tool routing • context injection • UI         │
└───────────────┬─────────────┬───────────────┬────────────────┘
                │             │               │
       ┌────────▼──────┐ ┌────▼────────┐ ┌────▼───────────────┐
       │Deterministic  │ │Phase Skills │ │Isolated Subagents  │
       │Domain Core    │ │Goal Protocols│ │research/verify/vis │
       └────────┬──────┘ └────┬────────┘ └────┬───────────────┘
                │             │               │
       ┌────────▼─────────────▼───────────────▼────────────────┐
       │ SQLite SSOT + immutable event log + source cache      │
       └──────────────────────┬─────────────────────────────────┘
                              │
       ┌──────────────────────▼─────────────────────────────────┐
       │ Obsidian projection: objectives, sessions, gaps, logs │
       └────────────────────────────────────────────────────────┘
```

### 4.1 Why a Pi extension

The Pi extension provides:
- custom tools with strict schemas;
- custom commands and quiz UI;
- session lifecycle hooks;
- phase-specific context injection through `before_agent_start`;
- session-local entries through `pi.appendEntry()`;
- custom renderers and status widgets;
- dynamic tool activation;
- isolated subagents;
- hot reload during development.

### 4.2 Why the LLM is not the state machine

The LLM may propose decisions but cannot be the authoritative transition controller because it can:
- skip phases;
- leak answers;
- invent mastery;
- lose state after compaction;
- apply inconsistent policies.

All transitions are validated by deterministic TypeScript code.

### 4.3 Why SQLite is the SSOT

**Decision:** `PRODUCT_DECISION`.

SQLite in WAL mode is the v1 source of truth because the product needs:
- transactional updates;
- indexing across many sessions;
- evidence and provenance queries;
- safe schema migrations;
- multiple independent projections;
- a future path beyond one Obsidian vault.

Pi JSONL remains the conversation/session transcript, not the canonical learner model. Obsidian Markdown is a human-readable projection, not the canonical database.

### 4.4 Branch semantics

Pi sessions are trees. Study state must therefore record:
- `pi_session_id`;
- `pi_entry_id` when available;
- `study_session_id`;
- `attempt_branch_id`;
- `parent_event_id`.

Forking a Pi session creates a new study attempt branch on first mutation. A branch never silently rewrites evidence from its parent.

---

## 5. Proposed package structure

```text
ai-study-engine/
├── package.json
├── README.md
├── docs/
│   ├── v1-technical-spec.md
│   ├── provenance.md
│   └── protocol-and-capability-contracts.md
├── extensions/
│   └── study-engine/
│       ├── index.ts
│       ├── commands.ts
│       ├── tools.ts
│       ├── ui.ts
│       ├── prompt-router.ts
│       └── session-bridge.ts
├── src/
│   ├── core/
│   │   ├── state-machine.ts
│   │   ├── transition-guards.ts
│   │   ├── help-controller.ts
│   │   ├── mastery.ts
│   │   ├── gaps.ts
│   │   ├── next-step.ts
│   │   ├── policy/
│   │   │   ├── condition.ts
│   │   │   └── conflict-resolver.ts
│   │   ├── scheduler.ts
│   │   ├── load-monitor.ts
│   │   └── provenance.ts
│   ├── db/
│   │   ├── migrations.ts
│   │   ├── migrations/
│   │   │   ├── 001_initial.sql
│   │   │   ├── 002_normalized_events.sql
│   │   │   └── 003_policy_kernel.sql
│   │   ├── schema-v1-legacy.sql
│   │   ├── repository.ts
│   │   └── event-store.ts
│   ├── protocols/
│   │   ├── contract.ts
│   │   ├── conceptual-dialogue.ts
│   │   ├── procedural-performance.ts
│   │   ├── proof-derivation.ts
│   │   ├── factual-recall.ts
│   │   ├── argument-source-analysis.ts
│   │   └── project-creation.ts
│   ├── capabilities/
│   │   ├── mathematics.ts
│   │   ├── programming.ts
│   │   ├── humanities.ts
│   │   └── language.ts
│   ├── projections/
│   │   └── obsidian.ts
│   └── verification/
│       ├── claims.ts
│       ├── citations.ts
│       └── deterministic-checks.ts
├── skills/
│   ├── study-prime/SKILL.md
│   ├── study-encode/SKILL.md
│   ├── study-retrieve/SKILL.md
│   ├── study-remediate/SKILL.md
│   └── study-reflect/SKILL.md
├── agents/
│   ├── researcher.md
│   ├── verifier.md
│   ├── visualizer.md
│   └── evaluator.md
└── tests/
    ├── unit/
    ├── integration/
    ├── simulations/
    └── fixtures/
```

The package is distributable through Pi's package mechanism. Runtime dependencies live in `dependencies`; Pi core packages and `typebox` live in `peerDependencies`.

---

## 6. Domain data model

All records use UUIDs, ISO-8601 UTC timestamps, and explicit schema versions.

### 6.1 UserProfile

```ts
interface UserProfile {
  id: string;
  displayName?: string;
  locale: string;
  timezone: string;
  accessibility: {
    voiceMode: boolean;
    conciseMode: boolean;
  };
  preferences: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
```

No learning-style classification is stored. Observable habits and current constraints belong in evidence records.

### 6.2 LearningObjective

```ts
interface LearningObjective {
  id: string;
  userId: string;
  title: string;
  observableOutcome: string;
  targetTask: string;
  assessmentFormat: string;
  deadline?: string;
  stakes: "low" | "normal" | "high" | "competitive";
  targetBloom: 1 | 2 | 3 | 4 | 5 | 6;
  targetSolo: "unistructural" | "multistructural" | "relational" | "extended_abstract";
  status: "draft" | "active" | "met" | "paused" | "archived";
  provenance: Provenance;
}
```

### 6.3 KnowledgeUnit

```ts
interface KnowledgeUnit {
  id: string;
  objectiveId: string;
  label: string;
  learnerDescription?: string;
  pacer: Array<"procedural" | "analogous" | "conceptual" | "evidence" | "reference">;
  layer: 1 | 2 | 3 | 4 | "unknown";
  criticality: "core" | "supporting" | "optional";
  status: "unseen" | "familiar" | "encoding" | "retrievable" | "stable" | "deferred";
}
```

### 6.4 KnowledgeRelation

Relations recorded as learner knowledge require learner evidence.

```ts
interface KnowledgeRelation {
  id: string;
  objectiveId: string;
  fromUnitId: string;
  toUnitId: string;
  type: "causes" | "enables" | "contrasts" | "part_of" | "depends_on" | "analogous_to" | "other";
  learnerStatement: string;
  status: "hypothesis" | "supported" | "challenged" | "rejected";
  evidenceAttemptIds: string[];
  sourceClaimIds: string[];
}
```

AI-generated prerequisite relations are stored separately as `SystemHypothesis` until the learner uses or verifies them. They must not appear as learner-owned relations.

### 6.5 Attempt

```ts
interface Attempt {
  id: string;
  sessionId: string;
  objectiveId: string;
  unitIds: string[];
  mode: "probe" | "encode" | "retrieve" | "apply" | "transfer" | "explain";
  promptId?: string;
  responseHash: string;
  diagnosticExcerpt?: string;
  rawResponseArtifactId?: string; // temporary or explicit-consent storage only
  inputModality: "text" | "voice_transcript" | "code" | "image" | "mixed";
  assistanceKind: "none" | "hint" | "partial_solution" | "full_answer";
  startedAt: string;
  completedAt?: string;
  answerWasVisibleBeforeAttempt: boolean;
  helpLevelUsed: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  selfReport?: {
    confidence: 1 | 2 | 3 | 4 | 5;
    effort: 1 | 2 | 3 | 4 | 5;
    focus: 1 | 2 | 3 | 4 | 5;
  };
}
```

The engine does not retain full responses indefinitely by default. Permanent evidence contains the prompt/object IDs, verdict, error type, help level, confidence, timestamp, a short diagnostic excerpt, response hash, and source/rubric reference. Full text is temporary or opt-in for disputes and longitudinal explanation analysis. Raw voice recordings are never retained automatically. Pi's own session transcript is governed separately and must be disclosed to the user.

### 6.6 AssessmentEvidence

```ts
interface AssessmentEvidence {
  id: string;
  attemptId: string;
  evaluator: "deterministic" | "ai" | "human" | "self";
  rubricVersion: string;
  verdict: "correct" | "partial" | "gap" | "uncertain" | "disputed";
  dimensions: {
    factualAccuracy?: 0 | 1 | 2 | 3;
    freeGeneration?: 0 | 1 | 2 | 3;
    relationalStructure?: 0 | 1 | 2 | 3;
    reconstruction?: 0 | 1 | 2 | 3;
    application?: 0 | 1 | 2 | 3;
    transfer?: 0 | 1 | 2 | 3;
    communication?: 0 | 1 | 2 | 3;
  };
  criticalErrors: string[];
  unsupportedClaims: string[];
  evaluatorNotes: string;
  confidence: number; // 0..1, evaluator confidence, not learner mastery
  createdAt: string;
}
```

### 6.7 Gap

```ts
interface Gap {
  id: string;
  objectiveId: string;
  unitIds: string[];
  question: string;
  classification:
    | "term"
    | "notation"
    | "fact"
    | "relation"
    | "mechanism"
    | "procedure"
    | "prerequisite"
    | "transfer"
    | "unknown";
  severity: "minor" | "major" | "blocking";
  state: "open" | "cause_hypothesized" | "remediating" | "provisional_closed" | "verified_closed" | "reopened" | "deferred";
  detectedByEvidenceId: string;
  remediationAttemptIds: string[];
  provisionalClosedByEvidenceId?: string;
  verifiedByEvidenceId?: string;
  nextCheckAt?: string;
}
```

### 6.8 Source and Claim

```ts
interface Source {
  id: string;
  uri: string;
  title?: string;
  author?: string;
  publishedAt?: string;
  retrievedAt: string;
  authorityClass: "primary" | "peer_reviewed" | "official" | "textbook" | "reputable_secondary" | "informal" | "unknown";
  contentHash?: string;
}

interface Claim {
  id: string;
  text: string;
  sourceIds: string[];
  locator?: string;
  status: "unverified" | "supported" | "contested" | "rejected" | "generated_hypothesis";
  confidence: number;
  checkedAt?: string;
}
```

### 6.9 ReviewItem and LoadSample

```ts
interface ReviewItem {
  id: string;
  userId: string;
  objectiveId: string;
  targetType: "unit" | "relation" | "gap" | "procedure" | "target_task";
  targetId: string;
  dueWindowStart: string;
  dueWindowEnd: string;
  stage: number;
  lastEvidenceId?: string;
  status: "scheduled" | "done" | "snoozed" | "cancelled";
}

interface LoadSample {
  id: string;
  sessionId: string;
  timestamp: string;
  selfFocus?: 1 | 2 | 3 | 4 | 5;
  selfEffort?: 1 | 2 | 3 | 4 | 5;
  responseLatencyMs?: number;
  errorStreak: number;
  helpLevel: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  processingSlowdownRatio?: number;
  action: "continue" | "reduce_layer" | "switch_mode" | "break_suggested" | "stop";
}
```

### 6.10 Immutable DomainEvent

Every mutation emits an event before updating projections.

```ts
interface DomainEvent<T = unknown> {
  id: string;
  userId: string;
  studySessionId?: string;
  attemptBranchId: string;
  parentEventId?: string;
  type: string;
  schemaVersion: number;
  payload: T;
  actor: "user" | "engine" | "ai" | "human_reviewer";
  provenance: Provenance;
  createdAt: string;
}
```

---

## 7. Learning state machine

### 7.1 States

```text
ONBOARD
  → OUTCOME
  → BASELINE_PROBE
  → PRIME_L1
  → AIM
  → SHOOT_ENCODE
  → SKIN
  → RETRIEVE
  → INTERLEAVE
  → DELAY
  → COMPLETE
```

Supporting states:

```text
REFERENCE
GAP
REMEDIATE
META
BREAK
OVERLEARN
PAUSED
```

### 7.2 State responsibilities

| State | Learner operation | AI operation | Exit evidence |
|---|---|---|---|
| `OUTCOME` | Chooses observable use/assessment | Offers formats and detects ambiguity | Target task and depth explicit |
| `BASELINE_PROBE` | Attempts without teaching | Broad-to-deep diagnostic | Prior-knowledge map with uncertainty |
| `PRIME_L1` | Skims, identifies main ideas/questions | Familiarity scaffold, images, terms | Learner can state tentative big picture |
| `AIM` | Groups, hypothesizes, asks | Canvas and prompts only | Learner-owned backbone/questions |
| `SHOOT_ENCODE` | Targeted study; maps or practices | Retrieves sources, gives short scaffolds | Updated learner relations/explanation |
| `SKIN` | Rechunks, prioritizes, prunes | Checks GRINDE criteria after attempt | Coherent learner-owned structure |
| `REFERENCE` | Classifies detail value | Stores details/card candidates | Detail justified or deferred |
| `RETRIEVE` | Explains/solves without source | Hides answers, evaluates after attempt | Target rubric evidence |
| `GAP` | States a precise missing question | Classifies and finds relevant context | Actionable gap question |
| `REMEDIATE` | Studies and reattempts | Minimum sufficient scaffold | Independent correct reattempt |
| `INTERLEAVE` | Compares/applies with variation | Generates controlled variation | Success across relevant variations |
| `DELAY` | Leaves knowledge unused temporarily | Schedules a loose review window | Review becomes due |
| `META` | Cue→monitor→adjust | Records one testable adjustment | Next experiment specified |
| `OVERLEARN` | Extra high-standard trials | Simulates competitive standard | External excellence requirement met |
| `COMPLETE` | Summarizes model and open uncertainty | Exports auditable state | Delayed/transfer target met |

### 7.3 Hard transition guards

1. `PRIME_L1 → AIM`: learner has produced at least one question or tentative relation.
2. `AIM → SHOOT_ENCODE`: learner has a concrete backbone, not only empty category labels.
3. `SHOOT_ENCODE → SKIN`: there is a learner artifact or recorded explanation to revise.
4. `SKIN → RETRIEVE`: source is hidden and learner has encoded before testing.
5. `RETRIEVE → COMPLETE`: forbidden without target-format evidence; conceptual objectives additionally require relational evidence.
6. `GAP → provisional_closed`: forbidden without a new independent attempt.
7. `provisional_closed → verified_closed`: requires delayed or varied evidence according to objective stakes.
8. `REFERENCE`: cannot create unlimited cards; debt check must pass.
9. `OVERLEARN`: disabled by default unless stakes are `competitive` or explicitly requested.
10. Any critical factual error blocks mastery regardless of self-confidence.

---

## 8. Mechanism 1 — Help and direct-answer controller

**Status:** `PRODUCT_DECISION`, informed by `SUNG_DIRECT` scaffolding and local protocols.

### 8.1 Interaction modes

| Mode | Answer visibility | Default help policy |
|---|---|---|
| `familiarity` | Direct concise explanation allowed | Start at level 3 |
| `encoding` | Partial support allowed | Start at level 1 |
| `retrieval` | Hidden until attempt | Start at level 0 |
| `assessment` | Hidden; no hints unless test permits | Level 0 |
| `remediation` | Escalating support | Resume at failure-dependent level |
| `reference` | Direct factual lookup allowed | Level 5, marked as reference |

### 8.2 Help ladder

| Level | Intervention |
|---:|---|
| 0 | No help; request an attempt. |
| 1 | Localize the exact point of difficulty. |
| 2 | Give a direction/category/prerequisite cue. |
| 3 | Give one relevant fact, definition, representation, or layman scaffold. |
| 4 | Show a partial worked step or expanded context around the exact gap. |
| 5 | Give the concise full answer or complete worked solution. |
| 6 | Full teaching reset: lower layer, rebuild prerequisites, then restart target. |

### 8.3 Escalation rules

- A user may always explicitly request the answer. It is recorded as `assisted/full_answer`, never mastery.
- After a full answer, the required sequence is: learner paraphrase → explain the relationship/mechanism → new analogous task → delayed independent retrieval.
- During retrieval, at least one attempt or explicit surrender is required before level 5.
- A factual lookup in `reference` mode does not require struggle.
- Mechanical errors repeat the same target before introducing a new example.
- Conceptual errors receive context and then a new analogous target before returning to the original target.
- A blocking prerequisite moves to level 6 rather than repeatedly hinting at the impossible target.
- After any level 3–6 help, the answer cannot produce mastery evidence until an independent reattempt.

### 8.4 Adaptive default

Escalation is based on attempts and load, not a universal timer:

```text
if assessment_mode: remain L0
else if explicit_answer_request: L5, mark contaminated attempt
else if blocking_prerequisite: L6
else if overload signals >= 2: raise one level or lower content layer
else if two materially distinct attempts failed: raise one level
else: remain at current level
```

Two attempts are `LOCAL_PROTOCOL` (`theory_live_v4.md`). Requiring them to be materially different is `SUNG_INFERRED`/`PRODUCT_DECISION`: repeating the same response does not create new evidence. Factual non-knowledge, a genuinely new topic, or a blocking fundamental confusion may escalate earlier.

### 8.5 Content-bearing help guard

Help level alone does not determine whether an intervention steals inquiry. Every intervention is additionally classified as:
- `process_only`: asks the learner to perform an operation without suggesting its content;
- `content_cue`: supplies a fact, category, candidate relation, or direction;
- `structure_reveal`: supplies a grouping, order, relational frame, explanation, or solution.

Before the first learner structure attempt, only `process_only` help is allowed, except a learner-requested familiarity explanation for a learner-selected concept. After an attempt, `content_cue` and then `structure_reveal` may be used progressively. Exposed structures remain contaminated until varied independent reconstruction/application.

This guard is a `PRODUCT_DECISION` derived from the distinction between learner-owned inquiry and AI-supported retrieval documented in the internal research note on AI assistance boundaries.

---

## 9. Mechanisms 2–3 — Learner model and updates

### 9.1 Model principles

- Store observations, not personality labels.
- Keep self-report separate from demonstrated performance.
- Keep source truth separate from learner belief.
- Keep learner-owned relations separate from AI prerequisite hypotheses.
- Preserve contradictory evidence instead of overwriting it.
- Make every derived status reproducible from events.

### 9.2 Evidence priority

Default ordering for conflicting evidence:

```text
delayed target-task performance
> immediate target-task performance
> free reconstruction/explanation
> cued recall
> recognition/MCQ
> self-confidence
```

This is a `PRODUCT_DECISION`; the ordering follows Sung's qualitative hierarchy but exact weights are not his.

### 9.3 Update events

The model updates only on typed events such as:
- `attempt_started`;
- `attempt_submitted`;
- `assessment_recorded`;
- `gap_opened`;
- `gap_reclassified`;
- `gap_provisional_closed`;
- `gap_verified_closed`;
- `gap_reopened`;
- `relation_hypothesized`;
- `relation_supported`;
- `relation_rejected`;
- `review_scheduled`;
- `load_sample_recorded`;
- `adjustment_committed`.

### 9.4 Reconciliation

When evidence conflicts:

1. Preserve both records.
2. Mark the affected mastery dimension `uncertain`.
3. Prefer delayed and target-format evidence for immediate routing.
4. Schedule a discriminating assessment rather than averaging incompatible observations.
5. Record why the next assessment was selected.

No mastery status is downgraded solely because time passed; decay creates a due check, not an invented failure.

---

## 10. Mechanism 4 — Machine understanding rubric

### 10.1 Vector, not scalar

The engine stores separate dimensions. It may display a summary status but must not discard the vector.

Dimension scale:

| Score | Meaning |
|---:|---|
| 0 | No usable evidence or critical failure. |
| 1 | Partial/cue-dependent performance. |
| 2 | Independent performance on the learned form. |
| 3 | Independent, accurate performance with reconstruction or meaningful variation. |

### 10.2 Default gates by objective

#### Conceptual objective

Minimum provisional mastery:
- factual accuracy ≥2;
- free generation ≥2;
- relational structure ≥2;
- no critical error;
- answer not exposed before attempt.

Stable mastery additionally requires delayed evidence or transfer ≥2.

#### Procedural objective

Minimum provisional mastery:
- application ≥2 on a non-identical task;
- critical steps correct;
- no answer exposure before attempt.

Stable mastery requires delayed application or transfer ≥2.

#### Reference/factual objective

Minimum provisional mastery:
- cued or free recall ≥2 when memorization is truly required.

If lookup is allowed in the target environment, retrieval speed and source use may replace memorization.

### 10.3 Evaluators

Priority:
1. deterministic verification where possible;
2. explicit answer key or primary source;
3. AI comparison against an explicit rubric and cited source;
4. learner self-assessment as an additional signal only.

- Deterministic checks override LLM judgment for exact arithmetic, tests, parsers, and executable code.
- AI evaluators produce rubric evidence plus confidence and citations to the submitted response.
- If AI cannot present a checkable basis, verdict is `uncertain`, not `wrong`.
- If the learner disputes an AI verdict: suspend closure → show rubric → show source/key → accept the learner's argument → run an independent check → retain `disputed` if unresolved.
- AI's previous verdict is never evidence of its own correctness.
- Self-score influences support and load, never closes a unit by itself.
- High-stakes assessments may require human verification.

All numeric thresholds are `EXPERIMENTAL` defaults.

---

## 11. Mechanism 5 — Gap lifecycle

```text
OPEN
  → CAUSE_HYPOTHESIZED
  → REMEDIATING
  → PROVISIONAL_CLOSED
  → VERIFIED_CLOSED
                     ↘
            REOPENED ─┘

Any state → DEFERRED (explicit scope decision)
```

### 11.1 Detection

A gap may be opened by:
- factual error;
- “I do not know”;
- inability to explain a relationship;
- contradictory learner relations;
- failed application;
- dependence on an unavailable cue;
- missing prerequisite;
- learner-declared confusion.

### 11.2 Classification and remediation

| Gap | Default remediation |
|---|---|
| term/fact | concise definition/source, then recall |
| notation | translate representations, then reconstruct |
| mechanical | same task recalculation |
| relation/mechanism | context expansion, learner remapping, Feynman reattempt |
| procedure | worked partial step, then new analogous task |
| prerequisite | lower layer/unit, then return |
| transfer | compare cases and interleave variants |

### 11.3 Closure

`PROVISIONAL_CLOSED` requires:
- a new response after remediation;
- no visibility contamination for the closing attempt;
- the relevant rubric gate passed.

`VERIFIED_CLOSED` requires:
- delayed or meaningfully varied evidence;
- no critical contradiction with dependent knowledge.

A later failure automatically emits `gap_reopened`; prior successful evidence remains in history.

---

## 12. Mechanism 6 — Next-step selector

### 12.1 Hard filters

A candidate is ineligible when:
- a blocking prerequisite is open;
- cognitive load policy currently forbids its difficulty;
- it is arbitrary detail outside assessment scope;
- it would create excessive review debt;
- required source material is unavailable or quarantined.

### 12.2 Candidate classes

1. Blocking prerequisite.
2. Open blocking/major gap.
3. Due target-format retrieval.
4. Current objective's next Layer 1/2 operation.
5. Deadline-critical assessment requirement.
6. Weak relationship or provisional closure check.
7. Learner curiosity question.
8. Layer 3 detail.
9. Optional enrichment/overlearning.

### 12.3 v1 scoring

After hard filters, compute an explainable score:

```text
score =
  0.30 * goal_impact
+ 0.25 * prerequisite_unlock
+ 0.20 * gap_severity
+ 0.15 * due_urgency
+ 0.10 * learner_curiosity
- 0.20 * overload_risk
- 0.10 * review_debt_cost
```

All inputs are normalized to 0..1. Weights are `EXPERIMENTAL`.

The selector must return:
- selected action;
- top three alternatives;
- score breakdown;
- assumptions;
- which hard filters removed candidates.

The user can override selection. Overrides become preference evidence, not a permanent general rule.

---

## 13. Mechanism 7 — AI content reliability

### 13.1 Claim pipeline

```text
GENERATED
  → CLAIM EXTRACTION
  → SOURCE RETRIEVAL
  → CITATION VALIDATION
  → CONFLICT CHECK
  → SUPPORTED / CONTESTED / QUARANTINED
```

### 13.2 Required provenance

The following require a source or deterministic verification before being taught as fact:
- definitions central to the objective;
- numerical claims;
- formulas;
- historical claims;
- medical/legal/safety claims;
- claims challenged by the learner;
- claims used to mark the learner wrong.

A familiarity analogy can be uncited if clearly labelled as an analogy and not presented as mechanism.

### 13.3 Source hierarchy

Default hierarchy, configurable by domain:

```text
primary source / governing specification
peer-reviewed or authoritative textbook
official institution/statistics
reputable secondary source
expert informal source
unknown source
```

Search ranking never equals truth. Contradictions are surfaced, not averaged away.

### 13.4 Quarantine policy

If a claim cannot be verified:
- mark it `unverified`;
- do not use it to grade the learner;
- do not write it into the learner knowledge model as truth;
- it may be offered only as a hypothesis with uncertainty.

### 13.5 Deterministic checks

Use when available:
- recalculate arithmetic;
- execute tests/code in a sandbox;
- parse formulas/types;
- compare quotations against source spans;
- validate URL/content hash and locator;
- require two independent sources only when the domain policy demands it.

---

## 14. Mechanism 8 — Goal protocols and domain capabilities

### 14.1 Selection order

The engine must not infer a fixed outcome from a subject name. The learner alone originates and chooses the outcome. AI may ask neutral clarification questions and structure the learner's stated intent into fields, but it must not propose, expand, or silently substitute the goal. The learner confirms every created or revised goal contract.

Runtime selection is compositional:

```text
learner goal / target task
  → assessment conditions
  → knowledge-unit type (PACER)
  → learning phase and current gap
  → goal protocol
  → domain verification capabilities
```

Example: mathematics may use a conceptual-dialogue protocol, a procedural-problem protocol, a proof protocol, factual recall, or several at once. History may likewise target factual chronology, causal explanation, source criticism, essay argument, or oral dialogue.

### 14.2 GoalProtocol contract

```ts
interface GoalProtocol {
  id: string;
  version: string;
  supports(objective: LearningObjective, unit: KnowledgeUnit): number;
  requiredLearnerArtifacts(objective: LearningObjective): ArtifactSpec[];
  buildProbe(context: ProbeContext): AssessmentSpec[];
  buildEncodingMove(context: EncodingContext): LearningMove[];
  buildRetrieval(context: RetrievalContext): AssessmentSpec[];
  masteryGate(evidence: AssessmentEvidence[]): GateDecision;
  remediationFor(gap: Gap): RemediationPlan;
}
```

v1 goal protocols:
- `conceptual-dialogue`: understand, explain simply, compare, and discuss;
- `procedural-performance`: perform a procedure or solve a class of problems;
- `proof-derivation`: derive or prove from prerequisites;
- `factual-recall`: reproduce exact required facts;
- `argument-source-analysis`: build and challenge evidence-based positions;
- `project-creation`: produce a working artifact under real constraints;
- `communicative-production`: understand and produce language in context.

The process described in an internal article on the learning process ("Статья о процессе обучения") is primarily a `conceptual-dialogue` protocol: preview → goal → rough learner map → relevance filter → comparison → chunking/rechunking → Feynman → delayed reconstruction. It is not the only protocol for mathematics or any other subject.

### 14.3 PACER routing inside a goal

Every unit is also classified by information type:
- Procedural → perform/practice.
- Analogous → critique limits and mapping.
- Conceptual → map relations and explain.
- Evidence → connect evidence to the claim it supports.
- Reference → store; memorize only if the learner's target requires it.

One objective may contain all five types. The protocol can therefore switch operation from unit to unit without changing the subject.

### 14.4 DomainCapability contract

```ts
interface DomainCapability {
  id: string;
  version: string;
  supports(material: MaterialDescriptor, targetTask: TargetTask): number;
  deterministicChecks(attempt: Attempt): Promise<CheckResult[]>;
  sourcePolicy(): SourcePolicy;
  representations(): RepresentationTool[];
  commonGapClassifiers(): GapClassifier[];
}
```

Domain capabilities do not choose the learner's outcome or learning protocol. They only provide available representations, verifiers, source rules, and common error classifications.

Examples:
- mathematics: symbolic/arithmetic checking, proof structure, graphing;
- programming: execution, tests, types, linting, debugging traces;
- humanities: claim-evidence maps, chronology, source conflict handling;
- language: speech/text analysis, pronunciation, comprehension and production measures.

The deterministic core owns transitions. Goal protocols propose learning moves. Domain capabilities verify domain-specific evidence.

---

## 15. Mechanism 9 — Review scheduler

### 15.1 Scheduled object

The scheduler reviews units, relationships, gaps, procedures, and target tasks—not only flashcards.

### 15.2 Loose windows

v1 uses windows rather than exact timestamps.

Default conceptual sequence after provisional success:

```text
stage 0: 1 day ± 12 hours
stage 1: 7 days ± 2 days
stage 2: 30 days ± 7 days
```

A gap remediation check may begin earlier. Whole-part-whole may use a ≥3-day delay when that technique is selected.

These defaults are `EXPERIMENTAL`; the loose 1d/1w/1m pattern is `SUNG_DIRECT`, but machine windows are ours.

### 15.3 Evidence adjustment

- Score 3 without help: advance one stage.
- Score 2: keep stage, schedule near middle of current window.
- Score 1 or critical error: reset to short remediation window and reopen gap.
- Score 0/no attempt: no false failure; reschedule with missed-review policy.
- Strong encoding may reduce review count.
- Review debt cap can defer low-criticality Layer 3/4 items.

### 15.4 Debt guard

Before creating a review item, estimate future cost. The engine must display:
- why it needs memorization;
- expected number/type of reviews;
- whether lookup is allowed;
- what higher-priority work would be displaced.

Auto-created flashcards are off by default.

---

## 16. Mechanism 10 — Cognitive load and stopping

### 16.1 Signals

The load monitor uses:
- learner focus/effort report;
- response latency relative to that learner's rolling baseline;
- error streak;
- repeated inability to use the same representation;
- help-level escalation;
- observable processing slowdown;
- time of day only as context, never destiny.

### 16.2 No fixed Pomodoro

The engine may offer beginner timers, but the primary stop rule is adaptive.

### 16.3 v1 action policy

```text
0–1 degradation signals:
  continue

2 signals across two consecutive interactions:
  reduce one content layer OR switch representation/mode

signals persist after adjustment:
  suggest a real break

critical fatigue report, safety issue, or repeated deterioration:
  stop high-load work and preserve state
```

A “signal” threshold is personalized against rolling baselines. Exact thresholds are `EXPERIMENTAL`.

### 16.4 Break behavior

A break should not create more cognitive work. The UI records:
- reason;
- current open loop;
- exact restart point;
- first action on return.

This reduces context-rebuild cost without forcing an arbitrary break duration.

---

## 17. Pi integration specification

### 17.1 Commands

| Command | Purpose |
|---|---|
| `/study-start` | Capture the learner-originated objective, obtain learner confirmation, and select material, target assessment, goal protocol, and capabilities. |
| `/study-status` | Compact status: state, next action, open gaps, due reviews, load. |
| `/study-next` | Run deterministic selector and explain recommendation. |
| `/study-gaps` | View/filter gap lifecycle. |
| `/study-review` | Start due retrieval. |
| `/study-map` | Show learner-owned units/relations and AI hypotheses separately. |
| `/study-source` | Show source provenance and contested claims. |
| `/study-pause` | Persist restart point and stop high-load mode. |
| `/study-end` | Run short META close and write projections. |
| `/study-export` | Rebuild Obsidian projections or portable export. |
| `/study-config` | User preferences and experimental policy settings. |

### 17.2 LLM-callable tools

Tools are narrow and transactional:

- `study_get_state`
- `study_record_attempt`
- `study_record_assessment`
- `study_open_gap`
- `study_update_gap`
- `study_record_relation`
- `study_select_next`
- `study_request_help`
- `study_record_load`
- `study_schedule_review`
- `study_verify_claims`
- `study_project_obsidian`

The LLM cannot directly write the database. Each tool validates actor, current state, expected version, and transition guard.

### 17.3 Dynamic tool activation

Register all tools at startup but activate only those relevant to the current state. Keep `study_get_state` and a loader/router tool active throughout.

Examples:
- `AIM`: relation/question/artifact tools active; assessment closure inactive.
- `RETRIEVE`: attempt/assessment/gap tools active; source answer tools gated.
- `REFERENCE`: source and storage tools active; map-generation tools inactive.

### 17.4 Context injection

On `before_agent_start`, inject only:
- objective and target task;
- current state;
- current next action;
- open blocking gaps;
- help mode/maximum permitted help;
- active goal protocol and domain capabilities;
- concise anti-theft rule.

Do not inject full history. Fetch details through tools.

### 17.5 Pi session persistence

Use:
- tool result `details` for branch-correct snapshots needed by Pi;
- `pi.appendEntry()` for lightweight UI/state checkpoints that do not enter LLM context;
- SQLite for canonical cross-session learner state;
- `session_start` and `session_tree` to reconstruct the active bridge;
- `session_shutdown` to flush pending projections.

### 17.6 Custom UI

v1 UI components:
- adaptive questionnaire/quiz;
- status widget above editor;
- compact phase and load indicator;
- gap viewer;
- source/provenance card;
- retrieval prompt with answer-hidden state.

The engine must still work in RPC/print modes without custom TUI. In those modes it returns structured text and never assumes dialog support.

### 17.7 Compaction

External SSOT prevents loss of study state. A custom compaction summary should retain only:
- active objective;
- current state;
- learner's latest model changes;
- unresolved questions/gaps;
- answer-visibility contamination;
- committed next action.

The extension re-injects current canonical state after compaction.

---

## 18. Skills and prompt policy

### 18.1 Progressive disclosure

Use one small skill per phase. Skill descriptions trigger only when relevant.

Each phase skill contains:
- goal;
- allowed AI actions;
- forbidden AI actions;
- expected learner artifact;
- exit criteria;
- recovery route.

### 18.2 User preferences

User preferences belong in configuration, not methodology skills. Examples:
- voice response length;
- preferred language;
- Obsidian vault path;
- notification style;
- whether calendar integration is enabled.

### 18.3 Historical incidents

Past assistant mistakes become tests or concise guardrails, not hundreds of prompt lines.

Example:

```text
Incident: AI grouped the learner's ideas into a finished map.
Invariant test: no AI-generated group can be persisted as learner-owned before learner evidence.
```

---

## 19. Subagent design

Subagents have isolated context and no direct write access to the SSOT.

### 19.1 Researcher

- Read-only source discovery.
- Returns source packets with provenance.
- Does not teach directly or grade.

### 19.2 Verifier

- Receives atomic claims and source packet.
- Validates citations, locators, contradictions.
- Returns supported/contested/unverified claims.

### 19.3 Visualizer

- Creates diagrams only from approved content.
- Visuals are scaffolds or post-attempt comparisons.
- It does not create a learner-owned conceptual map.

### 19.4 Evaluator

- Receives rubric, target, and learner attempt.
- Preferably blind to self-confidence and previous scores.
- Returns evidence, not direct database transitions.

### 19.5 Parent validation

The orchestrator validates all subagent outputs. Subagent text is untrusted until parsed and checked against a schema.

---

## 20. Obsidian projection

### 20.1 Configuration

```json
{
  "obsidian": {
    "enabled": true,
    "vaultPath": "/path/to/vault",
    "rootFolder": "Study Engine"
  }
}
```

No hardcoded user path is allowed in the distributable package.

### 20.2 Generated structure

```text
Study Engine/
├── Objectives/
├── Sessions/
├── Gaps/
├── Sources/
├── Artifacts/
└── Reviews/
```

### 20.3 Projection rules

- Projection is idempotent and rebuildable from SQLite.
- Stable IDs live in frontmatter.
- Generated sections use explicit markers.
- User-authored content outside generated markers is never overwritten.
- Learner maps/artifacts are immutable inputs or versioned files.
- AI hypotheses and learner relations are displayed separately.

Example frontmatter:

```yaml
---
study_engine_id: obj_...
schema_version: 1
projection_updated: 2026-05-02T00:00:00Z
status: active
---
```

### 20.4 Markdown session log

The log includes:
- outcome;
- phase transitions;
- learner artifacts;
- attempts and answer contamination;
- gaps and remediation;
- evidence vector;
- load events;
- one committed adjustment;
- next retrieval window.

It does not dump hidden chain-of-thought or internal model reasoning.

---

## 21. Security and privacy

- Local-first by default.
- Explicit consent before sending private vault material to remote providers.
- Source packets minimized to required spans.
- Secrets never written to Obsidian or session logs.
- Project-local Pi extensions/agents require trusted projects.
- Subagents default to user-level definitions; project agents require confirmation.
- Database supports per-user separation even in local installations.
- Export and deletion operate by user/objective ID.
- Logs distinguish learner text, AI text, and source quotations.

---

## 22. Observability and metrics

### 22.1 Learning metrics

Primary:
- time-to-provisional criterion;
- time-to-stable criterion;
- delayed retention;
- transfer success;
- help required per successful attempt;
- reopened-gap rate.

Secondary:
- review debt;
- source-verification failures;
- answer contamination rate;
- cognitive-load stop accuracy;
- learner override rate;
- abandoned-session rate.

Vanity metrics explicitly excluded:
- pages read;
- summaries produced;
- number of notes/cards;
- raw session length;
- user confidence without evidence.

### 22.2 100× experiment record

Every claimed acceleration experiment stores:
- baseline method;
- task and starting probe;
- target rubric version;
- elapsed active time;
- delayed interval;
- transfer task;
- sample size;
- uncertainty and exclusions.

---

## 23. Testing strategy

### 23.1 Unit tests

- Every state transition and guard.
- Help ladder escalation and contamination.
- Gap lifecycle and reopen behavior.
- Mastery vector derivation.
- Review windows and debt guard.
- Next-step hard filters and score explanation.
- Claim quarantine.
- GoalProtocol and DomainCapability contract validation.
- SQLite migrations and event replay.

### 23.2 Property/invariant tests

- No mastery from recognition-only evidence.
- No gap closure without reattempt.
- No learner-owned relation without learner evidence.
- No unverified claim used for grading.
- No answer-visible attempt counted as independent retrieval.
- Event replay always produces the same projection.
- Branch mutation never alters parent branch evidence.

### 23.3 Integration tests

- Pi session start/resume/fork/tree/reload.
- Dynamic active-tool changes.
- TUI and non-TUI behavior.
- Subagent cancellation and malformed output.
- Obsidian idempotence and preservation of user text.
- Compaction followed by correct state reinjection.

### 23.4 Simulation tests

Scripted learner profiles are behavior simulations, not fixed learning styles:
- confident recognition-only learner;
- low-confidence but accurate learner;
- overloaded learner;
- repeated mechanical error;
- missing prerequisite;
- conflicting sources;
- high-stakes exam;
- procedural programming task.

### 23.5 Human validation

No local protocol is considered validated merely because it exists in the vault. A/B or crossover trials compare policies using the same outcome rubric.

---

## 24. v1 acceptance criteria

v1 is complete when:

1. A new user can create an objective and target assessment.
2. The engine can run `OUTCOME → PRIME/AIM → ENCODE → RETRIEVE → GAP/REMEDIATE → DELAY`.
3. The user, not AI, creates the persisted learner groups and relations.
4. Attempts and answer contamination are recorded.
5. Conceptual and procedural objectives use different rubrics.
6. Gaps can be opened, provisionally closed, delayed-verified, and reopened.
7. The next-step selector provides an auditable explanation.
8. Claims used for grading have provenance or deterministic verification.
9. State survives Pi restart, compaction, and session resume.
10. Obsidian projection is rebuildable and never overwrites user-authored text.
11. Review windows work for units, relations, procedures, and gaps.
12. Load monitoring can reduce difficulty, suggest a break, and preserve restart state.
13. Tests enforce all hard invariants.
14. No UI or documentation promises 100× before valid experiments support it.

---

## 25. Implementation sequence

### Milestone 0 — Repository and executable specification

- Package skeleton.
- TypeScript config and test runner.
- SQLite schema/migrations.
- Domain types and provenance.
- State transition tests.

### Milestone 1 — Deterministic core

- Event store.
- State machine.
- Gap lifecycle.
- Mastery vectors.
- Help controller.
- Next-step selector.

### Milestone 2 — Minimal Pi runtime

- Study extension.
- `/study-start`, `/study-status`, `/study-next`, `/study-end`.
- Transactional tools.
- Minimal phase context injection.
- Resume/reload/branch support.

### Milestone 3 — Assessment and UI

- Questionnaire/retrieval UI.
- Attempt contamination.
- Evaluator interface.
- Status and gap widgets.

### Milestone 4 — Sources and Obsidian

- Source/claim pipeline.
- Verifier subagent.
- Obsidian projection.
- Markdown session logs.

### Milestone 5 — Protocols, capabilities, and scheduling

- Goal protocols for conceptual dialogue, procedure, proof, facts, argument, projects, and communication.
- Domain capabilities for mathematics, programming, humanities, and language.
- Review windows and debt guard.
- Load monitor.

### Milestone 6 — Evaluation

- Behavior simulations.
- Human pilot protocol.
- Baseline comparisons.
- Policy tuning with provenance-preserving config versions.

---

## 26. Decisions deferred beyond v1

- Cloud synchronization and multi-device conflict resolution.
- Calendar auto-booking.
- Voice daemon integration.
- Automatic mind-map OCR.
- Full graphical learner-map editor.
- FSRS or another advanced scheduler.
- Bayesian learner-model updates.
- Human teacher dashboard.
- Institution-managed source allow-lists.
- Claims of quantified acceleration.

These are deferred to keep v1 focused on the pedagogical control loop rather than surrounding productivity infrastructure.

---

## 27. Final design statement

The engine is built around a strict division:

```text
AI owns orchestration, scaffolding, verification, retrieval generation,
source logistics, persistence, and adaptation.

The learner owns questions, grouping, relationships, prioritization,
explanation, reconstruction, and application.
```

The deterministic core protects that boundary. Pi supplies the agent runtime and interface. SQLite supplies auditable cross-session state. Obsidian supplies a human-readable projection. Phase skills, goal protocols, and domain capabilities keep context small. Subagents accelerate research and verification without being trusted to mutate learning state.

This is the v1 foundation. Every unverified policy remains configurable, measurable, and explicitly marked as an engine decision rather than attributed to Justin Sung.
