# Mechanism 04: Provenance & Contamination Tracker

Status: CANONICAL SPEC
Version: 1.0
Date: 2026-08-15

## 1. Core Invariant

AI may help around learning but must never perform cognition-creating
operations on behalf of the learner. Any AI-supplied question, grouping,
relationship, priority, explanation, or answer becomes learner knowledge
ONLY after the learner independently generates, reconstructs, or applies
it with a varied cue, preferably with delayed verification.

## 2. Taxonomy of Learner-Owned Operations

### 2.1 Goal and Outcome
- `formulate_goal` — learner formulates the desired capability
- `choose_target_task` — learner chooses verification format
- `define_success_criteria` — learner defines what "knowing" means

### 2.2 Orienting / Priming
- `preview_material` — scan structure without deep reading
- `identify_key_terms` — notice terms without imposed importance
- `activate_prior_knowledge` — recall what is already known
- `request_layman_explanation` — request simple explanation of learner-selected concept

### 2.3 Inquiry and Initial Structure
- `formulate_inquiry_questions` — formulate questions BEFORE studying
- `hypothesize_structure` — guess how the topic is organized
- `build_rough_map` — deliberately imperfect first map
- `select_scope` — choose what to study first

### 2.4 Relational Encoding
- `group_elements` — group concepts
- `chunk_elements` — form semantic chunks
- `propose_relation` — propose a relationship
- `justify_relation` — explain why the relationship holds
- `prioritize` — rank importance
- `choose_order` — choose study order

### 2.5 Explanation / Application
- `explain_simply` — explain in own words
- `reconstruct_structure` — rebuild map without source
- `apply_or_transfer` — apply in new context
- `compare_models` — compare own model with source/AI
- `sustain_dialogue` — answer follow-up questions

### 2.6 Metacognition / Evidence
- `self_report_confusion` — report confusion
- `self_report_passivity` — report passive reading
- `request_help` — request help
- `dispute_assessment` — dispute a verdict

## 3. Taxonomy of AI Operations

| AI operation | Pedagogical meaning | Risk |
|---|---|---|
| `neutral_process_prompt` | "What seems important?" | Low |
| `logistics_support` | source navigation | Low |
| `familiarity_scaffold` | layman explanation, terms | Creates familiarity, NOT mastery |
| `content_cue` | direction, one fact | Partial contamination |
| `one_fact` | single term/fact | Requires independent reattempt |
| `partial_step_or_context` | partial solution | Elevated risk |
| `structure_reveal` | groups, relations, map, priorities | Strong contamination |
| `direct_answer` | full answer | Very strong contamination |
| `full_solution` | complete solution | Very strong contamination |
| `ai_rewrite` | polishes learner explanation | Critical: may be credited to learner |
| `ai_generated_retrieval_question` | post-encoding practice question | Allowed after encoding |
| `ai_assessment` | evidence-based evaluation | Must not be sole judge |

## 4. Operation Attributes

Every significant operation records:

```
target: concept/relation/goal
author: learner | ai | source | shared
help_level: none | process_only | familiarity | content_cue | partial_step | structure_reveal | direct_answer | full_solution
answer_visible: boolean
cue_varied: boolean
attempt_independent: boolean
contamination_scope: target | relation | group | priority | explanation | question
evidence_id: link to artifact/attempt/retrieval
confidence: high | medium | low | uncertain
status: clean | familiarity_only | assisted | contaminated | provisional_owned | verified_owned | disputed | unknown
```

**Critical:** absence of recorded operation ≠ absence of cognition.
If the system did not observe a learner operation, status must be `uncertain`, never an accusation.

## 5. Contamination Levels

### Level 0: Clean / Independent
Learner performed without content-bearing AI help.
Can count as learner-owned evidence.

### Level 1: Familiarity-only
AI gave layman explanation, terms, image.
Creates familiarity. NOT mastery.

### Level 2: Content cue / assisted hint
AI gave direction, one fact, search area.
Attempt after this is NOT fully independent.

### Level 3: Structure reveal
AI showed grouping, relations, map, priorities, order.
Strong risk of encoding theft.
Exposed structure marked `ai_authored`.

### Level 4: Direct answer / full solution
AI gave direct answer or full solution.
Maximum mastery risk.
Requires: paraphrase → relation explanation → analogous task → delayed retrieval.

### Level 5: Authorship violation
AI artifact persisted as learner-owned without independent reconstruction.
Critical violation of engine invariant.
Must be re-authored.

## 6. Cleaning Rules

Contamination is removed by independent learner generation with varied cue,
NOT by time, repetition of the same answer, or recognition.

### Lifecycle

```
CLEAN
  ↓ AI gave familiarity
FAMILIARITY_ONLY
  ↓ AI gave content cue
ASSISTED
  ↓ AI revealed structure/answer
CONTAMINATED_OPEN
  ↓ learner independently reconstructed/applied
PROVISIONAL_OWNED
  ↓ delayed/varied retrieval succeeded
VERIFIED_OWNED
```

Plus: `REOPENED`, `DISPUTED`, `UNCERTAIN`.

### Familiarity-only
No cleaning needed; mastery requires encoding/retrieval evidence.

### Content cue
New attempt required: without showing previous answer, with varied or no cue,
generation not recognition.
On success → `provisional_owned`. After delayed retrieval → `verified_owned`.

### Structure reveal
Immediate repetition of revealed structure does NOT clean.
Required: independent reconstruction without AI map, OR application in new task,
with varied cue.

### Direct answer
Mandatory cycle:
1. Paraphrase in own words
2. Explain the relation
3. Solve analogous task
4. Delayed retrieval with varied cue

### Authorship violation
Mark artifact as `ai_authored` or `shared`. Remove from learner-owned evidence.
Learner re-performs operation with process_only help.

### Reopening
`verified_owned` is not eternal. Reopen on:
- failed delayed retrieval
- inability to apply in new context
- recognition without generation
- explanation collapses under varied cue
- discovery that previously credited artifact was AI-authored

### Disputed cases
Status `DISPUTED`. Do not pressure with verdict. Show criterion, source,
offer independent check, allow additional attempt. If evidence ambiguous → `uncertain`.

### Uncertainty
`absence of recorded artifact ≠ absence of cognition`.
Default to `uncertain`, not accusation.

## 7. Visualization Principles

AI-authored and learner-authored objects must NEVER silently merge into one "learner model".

### Visible statuses
- **Yours** — learner created independently
- **Yours, verified** — independent + delayed evidence
- **AI hinted** — AI gave cue/fact
- **AI structure** — AI showed groups/relations/map
- **Requires reconstruction** — contaminated, needs independent reproduction
- **Not yet understanding** — familiarity without generation
- **Source** — from source, not appropriated
- **Disputed** — learner disagrees or evidence weak
- **Unknown** — no observations

### Map layers
Learner map = learner's own model.
AI/source reference map = separate toggleable layer (ghost/dashed).
AI map may be shown AFTER learner attempt as reference, never as primary.

### Contamination card
For each contaminated object show:
- what AI supplied
- why it is contaminated
- what action will clean it

### Tone
Not accusatory. Phrasing: "This is not yet fully yours. To make it yours, do X."

## 8. Product Decisions (to be configured)

These remain configurable, not fixed:
- number of independent attempts before first hint
- exact delayed retrieval intervals
- number of varied reattempts after full answer
- threshold for "too detailed" hint
- contamination score calculation (if any)
- specific UI visualization
- rubric weights

## 9. Relation to Other Mechanisms

- **GoalContract (Mechanism 01):** contamination scope refers to goal targets
- **Cognitive Scaffolding (Mechanism 02):** help_level classification drives escalation
- **Gap Lifecycle (Mechanism 06):** contaminated targets cannot close gaps as learner-owned
- **Policy Engine:** detects contamination violations, suggests process_only interventions
- **Protocol Executor:** chooses next move but respects contamination state
