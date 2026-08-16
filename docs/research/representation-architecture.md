# Исследование архитектуры представления AI Study Engine

Дата исследования: 2026-08-15

## 0. Статус доказательств

В отчёте используются метки:

- **[TECHNICAL_EVIDENCE]** — вывод непосредственно поддерживается техническим стандартом, официальной документацией или текущей реализацией.
- **[LOCAL_REQUIREMENT]** — требование взято из предоставленного ТЗ.
- **[INFERRED]** — инженерный вывод из нескольких требований/свойств, а не прямое утверждение источника.
- **[PRODUCT_RECOMMENDATION]** — предлагаемый продуктовый/архитектурный выбор.
- **[UNKNOWN]** — данных недостаточно.

Педагогические утверждения не расширялись внешними теориями. В доступных материалах присутствует только ТЗ исследования; упомянутые в нём локальные foundation research-файлы не были предоставлены в этой сессии. Поэтому педагогические инварианты в этом отчёте трактуются как **LOCAL_REQUIREMENT**, а не как независимо подтверждённые научные выводы.

---

# 1. Краткий вердикт

**[PRODUCT_RECOMMENDATION] Рекомендуемая архитектура: SQLite-first hybrid**

```text
                         immutable/versioned definitions
                    ┌──────────────────────────────────────┐
                    │ ProtocolDefinition + typed flow     │
                    │ PolicyDefinition + ConditionAST     │
                    │ Provenance + PolicyParameter        │
                    └──────────────────────────────────────┘
                                      │
                                      v
events/evidence ──> SQLite event log ──> deterministic reducer
                                      │
                    ┌─────────────────┼─────────────────┐
                    v                 v                 v
             protocol state     policy facts      learner model
             /instances         /detections       nodes+edges
                    │                 │                 │
                    └────────────┬────┴───────────────┘
                                 v
                     deterministic conflict resolver
                                 │
                                 v
                           Intervention
                                 │
                                 v
                       explanation trace / outcome
```

**[PRODUCT_RECOMMENDATION] Каноническими должны быть:**

1. append-only события и evidence/artifact links;
2. immutable versioned protocol definitions;
3. immutable versioned policy/rule definitions;
4. детерминированно выводимые состояния/проекции;
5. отдельная learner knowledge model.

**[PRODUCT_RECOMMENDATION] Не делать canonical:**

- snapshot конкретной библиотеки statecharts;
- property graph;
- RDF store;
- workflow-engine state;
- Rete working memory;
- Obsidian markdown.

**[INFERRED] Причина:** система должна одновременно поддерживать аудируемую историю, временные условия, uncertainty, версии правил и протоколов, доказательные переходы по реальным IDs и возможность в будущем заменить representation. Один граф плохо выражает семантику «отсутствие наблюдения ≠ наблюдение отсутствия», конфликтующие interventions, окна времени и deterministic replay без добавления отдельного rule/event слоя. После добавления этих слоёв граф перестаёт быть упрощающей канонической моделью.

**[TECHNICAL_EVIDENCE] SQLite уже предоставляет JSON-функции, window functions, expression/partial indexes и WAL; это достаточно сильный фундамент для локального event log + temporal predicates. На 2026-07-24 актуальный SQLite — 3.53.4.**

**[TECHNICAL_EVIDENCE] Statecharts имеют стандартное формальное основание через W3C SCXML; XState 5.x — активная TypeScript/JavaScript реализация. Однако библиотечный runtime не следует делать канонической формой хранения.**

**[PRODUCT_RECOMMENDATION] Что не следует строить сейчас:**

- отдельную graph database;
- RDF/OWL reasoner как основной policy engine;
- полный BPMN/DMN stack;
- отдельный CEP cluster;
- универсальный Rete engine;
- собственную temporal graph database;
- единый «суперграф», объединяющий protocol, policy, events и learner knowledge.

---

# 2. Решение по трём основным моделям

## 2.1 Protocol model

**[PRODUCT_RECOMMENDATION] Представление:** typed directed statechart-like graph, принадлежащий проекту.

Минимальная семантика:

```text
ProtocolDefinition
  ├─ nodes[]
  ├─ transitions[]
  ├─ initialNode
  └─ version

ProtocolTransition
  ├─ from
  ├─ to
  ├─ trigger?
  ├─ guard: ConditionAST
  ├─ requiredEvidence[]
  └─ effect descriptors
```

**[INFERRED] Почему не хранить просто XState JSON:** XState полезен как execution adapter и validator, но канонический формат должен пережить смену библиотеки. Собственный metamodel можно компилировать в XState, SCXML-подобную визуализацию или простой reducer.

**[PRODUCT_RECOMMENDATION] XState использовать опционально для:**

- интерпретации вложенных/параллельных состояний, если они реально понадобятся;
- developer visualization;
- модельных тестов;
- проверки determinism переходов.

Если протоколы остаются преимущественно линейными/ветвящимися, собственный reducer будет проще.

## 2.2 Policy/antipattern model

**[PRODUCT_RECOMMENDATION] Представление:** versioned rules + typed ConditionAST + отдельный conflict-resolution layer.

Пример:

```ts
type Condition =
  | { op: "all"; args: Condition[] }
  | { op: "any"; args: Condition[] }
  | { op: "not"; arg: Condition }
  | { op: "compare"; left: ValueExpr; cmp: Cmp; right: ValueExpr }
  | { op: "event_count"; eventType: string; window: Duration; cmp: Cmp; value: number }
  | { op: "exists_event"; eventType: string; since?: TimeAnchor }
  | { op: "not_observed"; observationType: string; window: Duration }
  | { op: "confidence"; observation: string; cmp: Cmp; value: number }
  | { op: "parameter"; name: string }
  | { op: "fact"; name: string };
```

Rule engine library не обязателен. Сначала condition evaluator может быть обычным TypeScript visitor, который вызывает параметризованные SQL queries и читает derived facts.

## 2.3 Learner knowledge model

**[PRODUCT_RECOMMENDATION] Хранить отдельно.** На первом этапе достаточно relational adjacency model:

```text
learner_knowledge_node
learner_knowledge_edge
learner_knowledge_evidence
```

**[INFERRED] Граф здесь естественен как проекция**, потому что вопросы действительно связаны с отношениями между концептами/структурами. Но это не делает graph DB необходимой: SQLite edge table хорошо поддерживает небольшие и средние графы, а Obsidian может быть projection.

**[PRODUCT_RECOMMENDATION] RDF export** следует добавить только если появляется реальная потребность в внешней semantic-web interoperability, SPARQL federation или совместном использовании онтологий.

---

# 3. Decision matrix

Шкала 1–5, где 5 — лучше. Итог приведён к 0–100.

Веса заданы **до** вычисления результата и отражают требования ТЗ:

| Критерий | Вес |
|---|---:|
| Соответствие задачам | 10 |
| Temporal conditions | 10 |
| Композиция протоколов | 7 |
| Conflict resolution | 8 |
| Explainability | 7 |
| Audit/provenance/versioning | 9 |
| Static validation/testability | 8 |
| Uncertain observations | 7 |
| Human authoring | 5 |
| SQLite compatibility | 8 |
| TypeScript compatibility | 5 |
| Local-first | 5 |
| Простота реализации/эксплуатации | 6 |
| Replaceability | 5 |
| **Итого** | **100** |

Результат:

| Вариант | Балл /100 | Решение |
|---|---:|---|
| **Recommended hybrid** | **96.6** | выбрать |
| **SQLite + typed ConditionAST** | **90.4** | ядро |
| Event sourcing + reducers | 84.6 | ядро |
| Statecharts / XState | 78.2 | protocol adapter |
| DMN / decision tables | 70.4 | полезный authoring projection для части rules |
| BPMN | 68.6 | не нужен сейчас |
| Production rules / Rete | 67.6 | возможный future optimization |
| Datalog | 65.6 | возможный analysis/validation backend |
| Petri nets | 63.0 | формально интересно, UX/TS хуже |
| Behavior trees | 63.0 | не совпадает с доменом |
| RDF/OWL + SPARQL | 62.8 | projection/interoperability |
| Temporal graph | 59.0 | преждевременно |
| CEP | 56.6 | только при event-rate pressure |
| Property graph | 56.4 | projection, не canonical |
| Hypergraph | 47.2 | нет достаточной выгоды |

**[INFERRED] Матрица не утверждает, что hybrid универсально лучше.** Она говорит, что при текущих весах именно этого проекта hybrid лучше согласует auditability, temporal rules, uncertainty, TypeScript/SQLite и низкую операционную сложность.

---

# 4. Разбор альтернатив

## 4.1 Property graph

**[TECHNICAL_EVIDENCE]** Property graph хорошо поддерживает traversal и node/relationship-centric queries. Neo4j — зрелый graph DB, но архитектурно это отдельный DBMS/server; актуальная документация 2026 года описывает standalone server/cluster deployment.

**Плюсы:** связи, визуализация, path queries.

**Минусы для проекта:**

- temporal semantics всё равно нужно проектировать отдельно;
- absence/unknown/confidence не возникают автоматически;
- конфликт rules не решается графом;
- добавляется второй canonical store либо необходимость перенести туда events;
- ухудшается local-first operational simplicity;
- versioned rules и deterministic replay остаются отдельной задачей.

**Решение:** не использовать как canonical DB.

## 4.2 RDF/OWL + SPARQL

**[TECHNICAL_EVIDENCE]** RDF 1.2 формализует graph/dataset model; SPARQL задаёт graph queries. OWL следует open-world assumption, поэтому отсутствие факта не означает false. SHACL добавляет закрытые validation constraints.

Это концептуально полезно для проблемы неполной наблюдаемости.

Но:

- OWL — язык знания/вывода, не workflow/rule scheduler;
- policy conflict, cooldown, budgets и temporal windows требуют дополнительной семантики;
- human authoring сложнее;
- отдельный RDF stack увеличивает сложность.

**Решение:** не canonical; возможен export/projection. Если появится semantic interoperability, JavaScript экосистема есть: RDF/JS и Comunica работают в Node/browser.

## 4.3 Hypergraph

Позволяет естественно моделировать n-ary relations, например «detection связан с rule + evidence set + target + session».

Но то же можно явно представить relational association tables. Экосистема TypeScript/local-first заметно слабее, а преимущества недостаточны.

**Решение:** отклонить.

## 4.4 SQLite + typed AST

Лучшее базовое соответствие:

- проверяемые foreign keys;
- явные версии;
- event/evidence IDs;
- temporal SQL;
- детерминированная evaluator semantics;
- простая миграция;
- высокий контроль над uncertainty;
- низкий lock-in.

Недостаток: часть developer tooling нужно написать самим. Это приемлемо, если metamodel небольшой и строго ограничен.

**Решение:** ядро.

## 4.5 Statecharts

**[TECHNICAL_EVIDENCE]** SCXML стандартизует state-machine/statechart execution concepts. XState 5.32.5 — стабильная актуальная 5.x версия на дату исследования; пакет MIT, TypeScript-oriented, документация требует TS 5+.

Сильны для protocol flow, guards, parallel/hierarchical states.

Слабы как единый policy model:

- rule conflict sets не являются основной абстракцией;
- длинная event history/temporal aggregation не естественна;
- open-world/uncertain evidence надо добавлять вручную.

**Решение:** protocol layer/adapter, не вся система.

## 4.6 Petri nets

Формально сильны для concurrency, reachability, deadlocks и resource-like semantics. Но authoring, TypeScript ecosystem и объяснение продуктовых policy rules хуже.

**Решение:** не runtime; идеи reachability/liveness использовать в validation.

## 4.7 BPMN

**[TECHNICAL_EVIDENCE]** BPMN 2.0.2 — зрелый OMG standard для business processes. Node implementation `bpmn-engine` существует; текущий package metadata показывает 25.0.1, MIT, Node >=18 и type declarations.

Но protocol обучения — не business process orchestration с human/service tasks, compensation, messages и enterprise process semantics. BPMN привнесёт больше языка, чем нужно.

**Решение:** не использовать.

## 4.8 Behavior trees

Приоритетные selectors и decorators удобны для выбора действий, поэтому конфликт resolution кажется привлекательным.

Но trees плохо отражают versioned protocol instance, temporal evidence и cross-cutting rules без blackboard/state layer. В результате основная сложность перемещается из tree в blackboard.

**Решение:** отклонить.

## 4.9 DMN / decision tables

**[TECHNICAL_EVIDENCE]** DMN предназначен для decision modeling; decision tables имеют hit policies для поведения при нескольких совпавших строках.

Сильны для плоских business rules и human review.

Слабее для:

- temporal windows;
- event provenance/evidence linkage;
- cooldown;
- uncertainty;
- stateful contamination lifecycle;
- cross-rule suppression.

**Решение:** можно сделать projection/editor для подмножества правил, но не canonical rule language.

## 4.10 Production rule engine / Rete

**[TECHNICAL_EVIDENCE]** Зрелые движки класса Drools используют working memory, agenda, salience/activation mechanisms; это прямо решает conflict sets. Но основная зрелая экосистема Java/KIE, а не local TypeScript.

JS `json-rules-engine` существует; текущий package metadata показывает 7.3.2, Node >=18, type declarations и ISC license. Но его generic JSON rules не покрывают автоматически provenance, event history, cooldown, contamination и deterministic migration.

**Решение:** не добавлять сейчас. Возможен replacement backend для policy matcher, если 5k rules действительно становятся bottleneck.

## 4.11 Datalog

**[TECHNICAL_EVIDENCE]** Soufflé — typed Datalog implementation с static type checking и provenance proof trees. Текущий latest release — 2.5 (2025-03-24), UPL; это native tool, ориентированный на анализ, не Node-first runtime.

Очень хорош для:

- derived facts;
- reachability;
- rule dependency analysis;
- provenance explanation;
- статических consistency checks.

Слабее для product authoring, timers, imperative intervention side effects и simple TS integration.

**Решение:** перспективный offline validator/compiler backend, не v1 runtime.

## 4.12 Event sourcing + deterministic reducers

Сильное соответствие:

- полная audit trail;
- replay;
- версионирование projections;
- temporal predicates;
- «что было известно на момент решения»;
- migration without history loss.

Недостаток: event schema governance и projection rebuild discipline.

**Решение:** ядро, но не «event sourcing framework» — достаточно собственного append-only event table и reducer contracts.

## 4.13 CEP

CEP отлично подходит для паттернов «A, потом B в течение N» и high-rate streams.

Но здесь приложение local-first, события ограниченного пользовательского масштаба, а большинство правил легко вычисляются SQL-window queries/materialized counters.

**Решение:** только если profiling докажет необходимость.

## 4.14 Temporal graph

Полезен, если главный workload — сложные graph traversal + validity intervals. В текущем ТЗ temporal часть относится прежде всего к событиям и policies, а не к истории topology.

**Решение:** отклонить.

---

# 5. Предлагаемый metamodel

```ts
type ID = string;
type ISOTime = string;

interface Provenance {
  id: ID;
  kind:
    | "SOURCE_DIRECT"
    | "INFERRED"
    | "LOCAL_PROTOCOL"
    | "PRODUCT_DECISION"
    | "EXPERIMENTAL_DEFAULT"
    | "USER_PREFERENCE"
    | "UNVALIDATED_DISABLED";
  sourceRef?: string;
  rationale?: string;
  createdAt: ISOTime;
}

interface ProtocolDefinition {
  id: ID;
  version: number;
  name: string;
  initialNodeId: ID;
  status: "draft" | "active" | "retired";
  provenanceId: ID;
}

interface ProtocolNode {
  id: ID;
  protocolId: ID;
  protocolVersion: number;
  kind: string;
  owner: "learner" | "ai" | "system";
  metadata: Record<string, unknown>;
}

interface ProtocolTransition {
  id: ID;
  protocolId: ID;
  protocolVersion: number;
  fromNodeId: ID;
  toNodeId: ID;
  trigger?: string;
  guard?: ConditionAST;
  requiredEvidenceKinds?: string[];
  priority: number;
}

type ConditionAST =
  | { op: "const"; value: boolean }
  | { op: "all"; args: ConditionAST[] }
  | { op: "any"; args: ConditionAST[] }
  | { op: "not"; arg: ConditionAST }
  | { op: "compare"; left: ValueExpr; cmp: "eq"|"ne"|"gt"|"gte"|"lt"|"lte"; right: ValueExpr }
  | { op: "event_count"; eventType: string; targetId?: ID; windowMs: number; cmp: string; value: number }
  | { op: "event_exists"; eventType: string; targetId?: ID; since?: TimeExpr }
  | { op: "observation"; observationType: string; minConfidence?: number }
  | { op: "parameter"; parameterId: ID };

type ValueExpr =
  | { kind: "literal"; value: unknown }
  | { kind: "fact"; key: string }
  | { kind: "parameter"; id: ID }
  | { kind: "deadline_delta_ms" }
  | { kind: "event_count"; eventType: string; windowMs: number };

interface AntipatternDefinition {
  id: ID;
  version: number;
  name: string;
  scope: Scope;
  condition: ConditionAST;
  exclusions: ConditionAST[];
  priority: number;
  severity: number;
  cooldownMs?: number;
  interventionTemplateId: ID;
  suppressesRuleIds: ID[];
  provenanceId: ID;
  status: "active" | "experimental" | "disabled";
}

interface Observation {
  id: ID;
  type: string;
  targetId?: ID;
  value: unknown;
  confidence: number;            // 0..1
  evidenceKind: "direct" | "self_report" | "inferred";
  observedAt: ISOTime;
  sourceEventId?: ID;
}

interface Detection {
  id: ID;
  ruleId: ID;
  ruleVersion: number;
  evaluatedAt: ISOTime;
  result: "matched" | "not_matched" | "uncertain";
  confidence: number;
  evidenceIds: ID[];
  explanationTrace: TraceNode;
}

interface Intervention {
  id: ID;
  detectionId: ID;
  kind: "process_only" | "content_cue" | "structure_reveal";
  targetId?: ID;
  selectedAt: ISOTime;
  budgetCost: number;
  status: "proposed" | "shown" | "dismissed" | "completed";
}

interface PolicyParameter {
  id: ID;
  name: string;
  value: unknown;
  provenanceId: ID;
  applicability: Scope;
  validFrom: ISOTime;
  validTo?: ISOTime;
}

interface ProtocolInstance {
  id: ID;
  protocolId: ID;
  protocolVersion: number;       // pin, never implicit latest
  currentNodeId: ID;
  targetId: ID;
  startedAt: ISOTime;
  status: "active" | "completed" | "abandoned";
}

interface TraceNode {
  op: string;
  result: boolean | "uncertain";
  detail?: string;
  children?: TraceNode[];
}
```

**[PRODUCT_RECOMMENDATION] ConditionAST должен быть намеренно меньше общего языка программирования.** Нельзя разрешать arbitrary JavaScript expressions в rule definitions: это ломает static validation, explainability и migration.

---

# 6. Storage model (SQLite)

Ниже схема ядра, а не полный production DDL.

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE provenance (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  source_ref TEXT,
  rationale TEXT,
  created_at_ms INTEGER NOT NULL
) STRICT;

CREATE TABLE protocol_definition (
  protocol_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  name TEXT NOT NULL,
  initial_node_id TEXT NOT NULL,
  status TEXT NOT NULL,
  provenance_id TEXT NOT NULL REFERENCES provenance(id),
  definition_hash TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (protocol_id, version)
) STRICT;

CREATE TABLE protocol_node (
  protocol_id TEXT NOT NULL,
  protocol_version INTEGER NOT NULL,
  node_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  owner TEXT NOT NULL,
  metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json)),
  PRIMARY KEY (protocol_id, protocol_version, node_id),
  FOREIGN KEY (protocol_id, protocol_version)
    REFERENCES protocol_definition(protocol_id, version)
) STRICT;

CREATE TABLE protocol_transition (
  protocol_id TEXT NOT NULL,
  protocol_version INTEGER NOT NULL,
  transition_id TEXT NOT NULL,
  from_node_id TEXT NOT NULL,
  to_node_id TEXT NOT NULL,
  trigger TEXT,
  guard_json TEXT CHECK(guard_json IS NULL OR json_valid(guard_json)),
  priority INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (protocol_id, protocol_version, transition_id),
  FOREIGN KEY (protocol_id, protocol_version, from_node_id)
    REFERENCES protocol_node(protocol_id, protocol_version, node_id),
  FOREIGN KEY (protocol_id, protocol_version, to_node_id)
    REFERENCES protocol_node(protocol_id, protocol_version, node_id)
) STRICT;

CREATE TABLE policy_definition (
  policy_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  name TEXT NOT NULL,
  scope_json TEXT NOT NULL CHECK(json_valid(scope_json)),
  condition_json TEXT NOT NULL CHECK(json_valid(condition_json)),
  exclusions_json TEXT NOT NULL CHECK(json_valid(exclusions_json)),
  priority INTEGER NOT NULL,
  severity INTEGER NOT NULL,
  cooldown_ms INTEGER,
  intervention_template_id TEXT NOT NULL,
  provenance_id TEXT NOT NULL REFERENCES provenance(id),
  status TEXT NOT NULL,
  definition_hash TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (policy_id, version)
) STRICT;

CREATE TABLE policy_suppression (
  policy_id TEXT NOT NULL,
  policy_version INTEGER NOT NULL,
  suppresses_policy_id TEXT NOT NULL,
  PRIMARY KEY (policy_id, policy_version, suppresses_policy_id),
  FOREIGN KEY (policy_id, policy_version)
    REFERENCES policy_definition(policy_id, version)
) STRICT;

CREATE TABLE protocol_instance (
  instance_id TEXT PRIMARY KEY,
  protocol_id TEXT NOT NULL,
  protocol_version INTEGER NOT NULL,
  current_node_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  started_at_ms INTEGER NOT NULL,
  completed_at_ms INTEGER,
  status TEXT NOT NULL,
  FOREIGN KEY (protocol_id, protocol_version, current_node_id)
    REFERENCES protocol_node(protocol_id, protocol_version, node_id)
) STRICT;

CREATE TABLE event (
  event_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  learner_id TEXT NOT NULL,
  target_id TEXT,
  protocol_instance_id TEXT REFERENCES protocol_instance(instance_id),
  type TEXT NOT NULL,
  occurred_at_ms INTEGER NOT NULL,
  recorded_at_ms INTEGER NOT NULL,
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  schema_version INTEGER NOT NULL,
  causation_event_id TEXT REFERENCES event(event_id),
  correlation_id TEXT
) STRICT;

CREATE INDEX event_by_learner_time
  ON event(learner_id, occurred_at_ms DESC);

CREATE INDEX event_by_target_type_time
  ON event(target_id, type, occurred_at_ms DESC)
  WHERE target_id IS NOT NULL;

CREATE INDEX event_by_instance_time
  ON event(protocol_instance_id, occurred_at_ms DESC)
  WHERE protocol_instance_id IS NOT NULL;

CREATE TABLE observation (
  observation_id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL,
  target_id TEXT,
  type TEXT NOT NULL,
  value_json TEXT NOT NULL CHECK(json_valid(value_json)),
  confidence REAL NOT NULL CHECK(confidence >= 0.0 AND confidence <= 1.0),
  evidence_kind TEXT NOT NULL,
  observed_at_ms INTEGER NOT NULL,
  source_event_id TEXT REFERENCES event(event_id)
) STRICT;

CREATE INDEX observation_by_target_type_time
  ON observation(target_id, type, observed_at_ms DESC);

CREATE TABLE artifact (
  artifact_id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL,
  target_id TEXT,
  kind TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  content_ref TEXT,
  content_hash TEXT
) STRICT;

CREATE TABLE evidence_link (
  evidence_link_id TEXT PRIMARY KEY,
  event_id TEXT REFERENCES event(event_id),
  observation_id TEXT REFERENCES observation(observation_id),
  artifact_id TEXT REFERENCES artifact(artifact_id),
  role TEXT NOT NULL,
  CHECK (
    (event_id IS NOT NULL) +
    (observation_id IS NOT NULL) +
    (artifact_id IS NOT NULL) = 1
  )
) STRICT;

CREATE TABLE detection (
  detection_id TEXT PRIMARY KEY,
  policy_id TEXT NOT NULL,
  policy_version INTEGER NOT NULL,
  learner_id TEXT NOT NULL,
  target_id TEXT,
  evaluated_at_ms INTEGER NOT NULL,
  result TEXT NOT NULL,
  confidence REAL NOT NULL,
  trace_json TEXT NOT NULL CHECK(json_valid(trace_json)),
  FOREIGN KEY (policy_id, policy_version)
    REFERENCES policy_definition(policy_id, version)
) STRICT;

CREATE TABLE detection_evidence (
  detection_id TEXT NOT NULL REFERENCES detection(detection_id),
  evidence_link_id TEXT NOT NULL REFERENCES evidence_link(evidence_link_id),
  PRIMARY KEY (detection_id, evidence_link_id)
) STRICT;

CREATE TABLE intervention (
  intervention_id TEXT PRIMARY KEY,
  detection_id TEXT NOT NULL REFERENCES detection(detection_id),
  kind TEXT NOT NULL,
  target_id TEXT,
  selected_at_ms INTEGER NOT NULL,
  budget_cost INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL
) STRICT;

CREATE INDEX intervention_by_target_time
  ON intervention(target_id, selected_at_ms DESC)
  WHERE target_id IS NOT NULL;

CREATE TABLE policy_parameter (
  parameter_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  name TEXT NOT NULL,
  value_json TEXT NOT NULL CHECK(json_valid(value_json)),
  scope_json TEXT NOT NULL CHECK(json_valid(scope_json)),
  provenance_id TEXT NOT NULL REFERENCES provenance(id),
  valid_from_ms INTEGER NOT NULL,
  valid_to_ms INTEGER,
  PRIMARY KEY (parameter_id, version)
) STRICT;

CREATE TABLE target_contamination (
  learner_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  dimension TEXT NOT NULL,
  state TEXT NOT NULL,  -- clean|open|provisional|verified
  opened_by_event_id TEXT REFERENCES event(event_id),
  updated_by_event_id TEXT REFERENCES event(event_id),
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (learner_id, target_id, dimension)
) STRICT;

CREATE TABLE learner_knowledge_node (
  learner_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  label TEXT,
  state_json TEXT NOT NULL CHECK(json_valid(state_json)),
  PRIMARY KEY (learner_id, node_id)
) STRICT;

CREATE TABLE learner_knowledge_edge (
  learner_id TEXT NOT NULL,
  edge_id TEXT NOT NULL,
  from_node_id TEXT NOT NULL,
  to_node_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
  provenance_id TEXT REFERENCES provenance(id),
  PRIMARY KEY (learner_id, edge_id),
  FOREIGN KEY (learner_id, from_node_id)
    REFERENCES learner_knowledge_node(learner_id, node_id),
  FOREIGN KEY (learner_id, to_node_id)
    REFERENCES learner_knowledge_node(learner_id, node_id)
) STRICT;
```

## Почему events остаются append-only

**[PRODUCT_RECOMMENDATION]** Исправления событий делать compensating/superseding events, а не UPDATE истории. Это позволяет воспроизвести, почему policy decision был принят в конкретный момент.

Derived tables (например `target_contamination`) можно пересчитать reducer-ом. Их разрешено обновлять, потому что они не являются историей.

---

# 7. Temporal conditions

## 7.1 Пример: 3 попытки за 14 дней

```sql
SELECT count(*)
FROM event
WHERE learner_id = ?
  AND target_id = ?
  AND type = 'attempt'
  AND occurred_at_ms >= ?; -- now - 14 days
```

## 7.2 «После structure_reveal не было varied retrieval»

```sql
WITH last_reveal AS (
  SELECT max(occurred_at_ms) AS t
  FROM event
  WHERE learner_id = ?
    AND target_id = ?
    AND type = 'structure_reveal'
)
SELECT NOT EXISTS (
  SELECT 1
  FROM event, last_reveal
  WHERE learner_id = ?
    AND target_id = ?
    AND type = 'varied_independent_retrieval'
    AND occurred_at_ms > last_reveal.t
);
```

Но этот predicate означает **не найдено записанного события**, а не «learner точно не делал это мысленно».

Поэтому ConditionAST должен различать:

```text
not_recorded(event_type, window)
not_observed(observation_type, window)
explicit_negative_observation(type)
```

а policy definition должен решать, какой уровень evidence достаточен.

## 7.3 Scheduler

**[PRODUCT_RECOMMENDATION] Scheduler нужен только когда действие должно возникнуть без нового события**, например review window истёк в 18:00 и приложение должно показать reminder при следующем wake cycle.

Не нужен scheduler для каждого temporal predicate. Большинство условий вычисляется «на входящем событии / открытии приложения / policy tick».

---

# 8. Uncertain observations

Сделать uncertainty first-class:

```text
Observation:
  observed value
  confidence
  evidence_kind
  source_event
  observed_at

Detection:
  matched | not_matched | uncertain
  confidence
  evidence set
  trace
```

**[PRODUCT_RECOMMENDATION] Трёхзначный result важнее единственного boolean.**

Пример сценария B:

```text
нет записанной learner operation
    ↓
condition "passive cognition" НЕ становится true
    ↓
condition получает UNKNOWN/UNCERTAIN
    ↓
policy может выбрать process-only self-report prompt
    ИЛИ ничего не делать, если intervention budget исчерпан
```

Это предотвращает превращение telemetry absence в педагогический факт.

---

# 9. Conflict-resolution algorithm

Цель — не «fire all matching rules», а выбрать минимально достаточное действие.

## 9.1 Candidate

Каждая matched detection становится candidate:

```ts
interface Candidate {
  ruleId: string;
  interventionKind: string;
  targetId?: string;
  priority: number;
  severity: number;
  specificity: number;
  evidenceStrength: number;
  cooldownSatisfied: boolean;
  budgetCost: number;
  suppresses: string[];
  semanticEffects: string[];
}
```

## 9.2 Алгоритм

```text
1. Evaluate hard invariants.
   Если proposed action нарушает learner-owned cognition / contamination invariant:
   discard.

2. Собрать matched + sufficiently confident candidates.

3. Применить exclusions.

4. Удалить candidates в cooldown.

5. Применить explicit suppression graph.
   suppression graph обязан быть acyclic.

6. Сгруппировать эквивалентные interventions.

7. Удалить interventions, которые уже покрываются более мягким действием
   с тем же semantic effect.

8. Проверить intervention budget.

9. Stable-sort:
   hard safety constraint
   > priority
   > severity
   > specificity
   > evidence strength
   > lower budget cost
   > stable rule_id tie-break.

10. Before commit выполнить oscillation guard:
    если выбранное действие в недавней истории чередовалось с обратным
    действием для того же target без нового evidence,
    suppress и записать reason.

11. Commit ровно один primary intervention.
    Secondary non-disruptive bookkeeping разрешён, но не несколько
    competing learner prompts.
```

## 9.3 Сценарий D

```text
high_load
missed_review
exam_in_2_days
missing_prerequisite
no_procedural_attempt
```

Предположим:

```text
high_load          -> propose break
missed_review      -> propose retrieval
exam_in_2_days     -> increase urgency
missing_prereq     -> propose prerequisite check
no_proc_attempt    -> propose independent attempt
```

Resolver может выбрать:

```text
process_only: "сделать короткую самостоятельную попытку prerequisite"
```

если это:

- не нарушает high-load hard threshold;
- покрывает `missing_prerequisite`;
- создаёт диагностическое evidence;
- дешевле по intervention budget, чем отдельные три prompts.

Если high_load выше hard threshold — приоритет получает break.

Ключ: `exam_in_2_days` лучше моделировать не как отдельное действие, а как **priority modifier**, иначе оно искусственно конкурирует с интервенциями.

---

# 10. Scenario A–E

## A. Procedural consumption

Rule:

```json
{
  "all": [
    {"event_count": {"eventType": "procedural_source_unit", "since": "last_independent_attempt", "gte": "$threshold"}},
    {"event_count": {"eventType": "independent_attempt", "since": "protocol_start", "eq": 0}},
    {"not": {"fact": "safety_briefing"}}
  ]
}
```

Action: `process_only`.

Threshold хранится в `PolicyParameter`, а не hard-code.

## B. Неполная наблюдаемость

`absence(event)` возвращает observed absence только когда источник способен наблюдать событие с достаточной полнотой. Иначе `uncertain`.

Self-report создаёт новую Observation с provenance.

## C. AI contamination

Reducer:

```text
structure_reveal
  -> contamination=open

immediate_repetition
  -> state remains open

varied_independent_reconstruction
  -> provisional

delayed_retrieval with valid evidence
  -> verified
```

Переходы должны ссылаться на реальные attempt/evidence IDs.

## D. Конфликт interventions

Использовать resolver выше, cooldown и oscillation guard.

## E. Смешанная цель

Не один «универсальный protocol», а orchestration of subtargets:

```text
GoalInstance
  ├─ conceptual target -> conceptual-dialogue
  ├─ procedural target -> procedural-performance
  ├─ proof target      -> proof-derivation
  └─ factual target    -> factual-recall
```

Dependencies задаются отдельным DAG:

```text
proof-derivation requires conceptual target >= required state
procedural performance may be independent
factual recall may run as spaced background review
```

Каждый subtarget имеет свой ProtocolInstance и pinned version.

---

# 11. Versioning

## 11.1 Definitions immutable

Никогда:

```sql
UPDATE policy_definition SET condition_json = ...
WHERE policy_id = 'x' AND version = 3;
```

Вместо этого создать version 4.

## 11.2 Active protocol instance pins version

`ProtocolInstance(protocol_id, protocol_version)` не следует автоматически переводить на latest.

## 11.3 Migration event

```json
{
  "type": "protocol_instance_migrated",
  "from": {"protocolId": "p", "version": 3, "node": "study"},
  "to":   {"protocolId": "p", "version": 4, "node": "compare"},
  "mappingRuleId": "migration:p:3->4:v1",
  "evidence": [...]
}
```

Миграция разрешена только если validator доказывает/проверяет mapping текущего состояния.

Если mapping отсутствует — экземпляр дорабатывает старую версию.

---

# 12. Validation strategy

## 12.1 Structural

Автоматически:

- schema validation ConditionAST;
- все references существуют;
- FK checks;
- enum/domain checks;
- version pin validity;
- provenance required;
- duplicate IDs/hashes.

## 12.2 Protocol graph

- reachability from initial node;
- nodes без входа/выхода;
- strongly connected components;
- cycle без observable progress condition;
- competing transitions с одинаковым trigger/guard priority;
- transition to learner-owned state без evidence predicate.

## 12.3 Rules

Static simplifier:

```text
all(true, X) -> X
any(false, X) -> X
not(not(X)) -> X
x > 5 AND x < 3 -> contradiction
x >= 0 OR x < 0 -> tautology (для total numeric domain)
```

Далее property-based generated states и bounded history generation:

- rule never matches;
- rule always matches;
- exclusion делает rule unreachable;
- два rules взаимно suppress друг друга;
- suppression cycle;
- cooldown=0/negative;
- invalid confidence threshold;
- parameter has no provenance;
- rule refers to missing event/observation type.

## 12.4 Temporal test harness

Вместо wall clock:

```ts
interface Clock {
  nowMs(): number;
}
```

Все evaluator tests получают deterministic fake clock.

## 12.5 Replay test

Для каждого migration:

```text
same event log
+ same definitions
+ same parameters
=> same detections/interventions/explanation hashes
```

Это один из главных invariants.

---

# 13. Explanation trace

Каждый evaluation должен сохранять компактный trace:

```json
{
  "rule": "procedural_consumption@4",
  "result": true,
  "children": [
    {
      "condition": "procedural_source_units_since_attempt >= threshold",
      "actual": 4,
      "threshold": 3,
      "parameter": "proc_consumption_threshold@2",
      "result": true
    },
    {
      "condition": "independent_attempts == 0",
      "actual": 0,
      "eventQueryWindow": "since protocol start",
      "result": true
    },
    {
      "condition": "NOT safety_briefing",
      "actual": false,
      "result": true
    }
  ],
  "conflictResolution": {
    "candidates": ["proc_attempt", "missed_review"],
    "selected": "proc_attempt",
    "reason": "higher priority; lower budget cost",
    "suppressed": ["missed_review"]
  }
}
```

Это объяснение должно строиться **самим deterministic evaluator**, не LLM. LLM может превратить trace в естественный язык, но не придумывать причину.

---

# 14. Три архитектурных варианта

## A — минимальный

```text
SQLite
+ append-only event table
+ TypeScript reducers
+ own ProtocolDefinition
+ ConditionAST evaluator
+ simple conflict resolver
+ Obsidian projection
```

Стоимость: низкая.

Риски: часть tooling своя; при сложных nested protocols собственный reducer может разрастись.

Переход к B: добавить statechart adapter без изменения canonical definitions/events.

## B — рекомендуемый hybrid

```text
SQLite canonical
+ event log
+ typed protocol metamodel
+ XState 5 adapter for protocol execution/visualization where useful
+ typed ConditionAST
+ SQL temporal predicates
+ deterministic policy evaluator
+ explanation trace
+ separate learner graph tables
+ Obsidian projection
```

Стоимость: средняя.

Главный риск: нужно жёстко не дать XState snapshots или JSON expressions стать скрытой canonical моделью.

## C — масштабируемый

```text
everything from B
+ compiled predicate registry
+ materialized policy facts
+ dependency index rule -> facts/event types
+ incremental re-evaluation
+ optional Datalog/Rete/CEP backend behind PolicyEvaluator interface
+ separate analytical projection if event history becomes expensive
```

Стоимость: высокая.

Переход к C только по profiling.

---

# 15. Scale assessment

## Малый
5 protocols / 50 rules / 10k events / 1 user.

**[PRODUCT_RECOMMENDATION]** A или B. Никакой graph DB/Rete/CEP.

## Средний
20 protocols / 500 rules / 1M events / несколько profiles.

**[INFERRED]** SQLite остаётся разумным при правильных compound/partial indexes и selective rule evaluation. Не пересчитывать все 500 rules на каждое событие: хранить dependency index `event_type -> candidate rules`.

## Расширенный
100 protocols / 5000 rules / 10M events.

**[INFERRED]** Не считать заранее, что SQLite не справится. Сначала:

- event indexes;
- precomputed rolling facts;
- policy dependency graph;
- incremental evaluator;
- archive/compaction derived data;
- EXPLAIN QUERY PLAN profiling.

Если bottleneck — policy matching, заменить **PolicyEvaluator backend**, а не storage/whole architecture.

---

# 16. Минимальный prototype

```ts
async function ingest(inputEvent: NewEvent): Promise<DecisionResult> {
  return db.transaction(async () => {
    const event = insertImmutableEvent(inputEvent);

    const impacted = dependencyIndex.rulesFor(event.type);

    const derived = reducers.apply(event);

    const detections: Detection[] = [];

    for (const ruleRef of impacted) {
      const rule = loadPinnedRule(ruleRef);
      if (!scopeMatches(rule.scope, derived.context)) continue;

      const evaluation = evaluateCondition(rule.condition, {
        db,
        clock,
        learnerId: event.learnerId,
        targetId: event.targetId,
        facts: derived.facts
      });

      if (evaluation.result !== "not_matched") {
        detections.push(
          persistDetection(rule, evaluation)
        );
      }
    }

    const candidates = detections
      .filter(isActionable)
      .map(toInterventionCandidate)
      .filter(applyExclusions)
      .filter(cooldownSatisfied);

    const resolution = resolveConflicts(candidates, {
      budget: currentBudget(event.learnerId),
      recentInterventions: loadRecentInterventions(event.targetId)
    });

    const intervention = resolution.selected
      ? persistIntervention(resolution.selected)
      : null;

    return {
      eventId: event.id,
      detections,
      intervention,
      explanation: resolution.trace
    };
  });
}
```

## Prototype rule 1

Procedural consumption.

## Prototype rule 2

Missed review with deadline priority modifier.

## Temporal rule

`attempt_count(target, last 14d) >= 3`.

## Uncertain observation

No recorded operation returns uncertain unless observation coverage is strong.

## Conflict

Independent attempt vs review; choose one by priority/budget.

## Explanation

Trace produced directly by condition visitor and resolver.

---

# 17. Migration plan

## Phase 0 — freeze semantics

1. Зафиксировать существующие state transitions, XML antipattern IDs и current SQLite schema.
2. Дать всем существующим concepts stable IDs.
3. Создать golden test sessions.

## Phase 1 — event normalization

1. Добавить canonical `event` table, не удаляя старые tables.
2. Начать dual-write: старые tables + event.
3. Backfill исторические записи в events с `schema_version`.
4. Сверять derived state с legacy state.

## Phase 2 — typed policy definitions

1. Импортировать XML registry в immutable `policy_definition`.
2. Не преобразовывать free text автоматически в executable semantics.
3. Каждый импортированный threshold пометить provenance.
4. Непереводимые правила — `UNVALIDATED_DISABLED`.

## Phase 3 — ConditionAST evaluator

1. Реализовать ограниченный набор operators.
2. Golden tests против legacy behavior.
3. Добавить explanation trace.
4. Включать правила постепенно.

## Phase 4 — protocol metamodel

1. Представить current hard state machine через ProtocolDefinition.
2. Сначала исполнять собственным simple reducer.
3. Добавить XState adapter только если нужен для сложных statecharts.

## Phase 5 — conflict resolver

1. Сначала priority + cooldown.
2. Потом suppression.
3. Потом budget.
4. Потом oscillation checks.

## Phase 6 — learner knowledge split

Перенести learner nodes/edges в отдельную модель; не использовать их как protocol execution state.

## Phase 7 — remove legacy

Удалять legacy XML/hardcoded state only after replay equivalence and migration tests pass.

---

# 18. Импорт XML antipattern registry

Предлагаемое правило:

```text
XML element
  -> parse
  -> map stable identity
  -> normalize scope
  -> convert supported predicates to ConditionAST
  -> attach provenance
  -> validate
  -> compare with golden examples
  -> activate only after pass
```

Не выполнять:

```text
XML free text -> LLM -> executable condition -> auto-enable
```

LLM может предложить migration draft, но final AST должен проходить deterministic validator и human review.

---

# 19. Текущая зрелость технологий

Состояние на 2026-08-15 по официальным/первичным источникам:

| Технология | Состояние | Лицензия/compatibility | Вывод |
|---|---|---|---|
| SQLite | 3.53.4, release 2026-07-24 | public-domain core; embedded | основной store |
| XState | stable 5.32.5, 2026-07-14; 6.x alpha существует | MIT; TS 5+ | использовать 5.x, не alpha |
| Node `node:sqlite` | Node 26 docs: Stability 1.2 release candidate | Node built-in | не причина срочно менять текущий driver |
| `json-rules-engine` | package metadata 7.3.2 | ISC; Node >=18; typings | possible reference/backend, не core |
| `bpmn-engine` | package metadata 25.0.1 | MIT; Node >=18; typings | зрел, но чрезмерен |
| Comunica | 5.3.0, 2026-07-10 | MIT; Node/browser | хорош для RDF projection/query |
| Soufflé | 2.5, 2025-03-24 | UPL; native | хорош для offline Datalog analysis |
| Neo4j | docs current 2026.07.1 | Community GPLv3; DBMS/server | не нужен canonical |

**[UNKNOWN]** Для части менее зрелых Petri-net/hypergraph/behavior-tree TypeScript libraries нет достаточной причины выбирать конкретную реализацию до появления требования, которое делает этот формализм выигрышным.

---

# 20. Falsification criteria

Рекомендацию B следует отвергнуть или существенно изменить, если pilot показывает хотя бы одно из следующего.

## 20.1 Policy evaluator не масштабируется

**[PRODUCT_RECOMMENDATION / EXPERIMENTAL_DEFAULT]**

После dependency indexing и rolling facts:

- p95 policy evaluation > 100 ms на целевой машине при 500 rules;
- p95 > 250 ms при 5000 rules;
- CPU/energy становится заметной UX-проблемой.

Тогда тестировать compiled Datalog/Rete backend.

## 20.2 Temporal SQL становится доминирующей стоимостью

Если даже после indexes/materialized counters большинство latency уходит на history scans, вводить rolling fact tables или CEP-like incremental state.

Не переходить сразу на temporal graph.

## 20.3 Protocol semantics требует сложной concurrency

Если реальные протоколы массово требуют nested parallel regions, interruptible states, joins, history states и сложные event races, собственный simple reducer следует заменить на полноценный statechart runtime или иной workflow formalism.

Canonical definitions всё равно должны оставаться versioned и library-independent.

## 20.4 Learner graph workload становится graph-centric

Если появляются регулярные multi-hop queries на очень большом learner graph, которые сложно/медленно выражаются recursive SQL, разрешить отдельный graph projection/store.

Он не обязан становиться canonical source.

## 20.5 Rule authoring становится bottleneck

Если human authors не способны безопасно редактировать JSON/YAML AST даже через UI, построить decision-table projection/editor или перейти к DMN subset.

## 20.6 Replay determinism не удаётся сохранить

Если adapters/side effects делают replay неустойчивым, архитектура нарушает ключевое требование. Нужно упростить evaluator/runtime, а не маскировать расхождения.

---

# 21. Ответы на 17 вопросов исследования

1. **Нужен ли graph DB?** Нет, не сейчас.
2. **Граф canonical или projection?** Projection.
3. **Что canonical?** Events + immutable definitions + evidence; derived states rebuildable.
4. **Protocol flow?** Own typed statechart-like graph; XState adapter при необходимости.
5. **Antipattern detection?** ConditionAST; decision-table projection только для простых rules.
6. **Temporal rules?** Event log + SQL windows/aggregates + rolling facts; scheduler только для wall-clock wakeups.
7. **Negative evidence?** Explicit observation semantics + confidence + three-valued detection.
8. **Rule explosion?** Scope inheritance, parameters, reusable predicates, dependency indexing, exclusions, modifiers.
9. **Conflicts?** Deterministic resolver: invariants → exclusions → cooldown → suppression → priority/specificity/evidence → budget → stable tiebreak.
10. **Explanation?** Persisted evaluator trace, LLM only verbalizes it.
11. **Versioning during session?** Pin definition versions.
12. **Protocol migration?** Explicit migration event + node mapping; no implicit latest.
13. **Pre-production validation?** Schema + graph analysis + rule simplification + generated history/property tests + replay.
14. **Unreachable/cycles/contradictions?** Graph reachability/SCC + bounded condition analysis + suppression DAG check.
15. **XML import?** Deterministic converter; unsupported = disabled, never guessed active.
16. **Learner knowledge same model?** Separate model, same SQLite database is fine.
17. **Replaceability?** Ports/interfaces around ProtocolExecutor, PolicyEvaluator, EventStore, KnowledgeProjection; canonical formats owned by project.

---

# 22. Final recommendation

**[PRODUCT_RECOMMENDATION]**

Строить не graph platform, а **deterministic study-policy kernel**:

```text
SQLite
  ├─ immutable event/evidence history
  ├─ versioned protocol definitions
  ├─ versioned policy/ConditionAST
  ├─ observations with uncertainty
  ├─ detections/interventions/outcomes
  └─ learner graph tables

TypeScript
  ├─ reducer
  ├─ protocol executor
  ├─ condition evaluator
  ├─ conflict resolver
  ├─ validator
  └─ explanation trace

Optional adapters
  ├─ XState
  ├─ Obsidian
  ├─ RDF/SPARQL
  └─ future Datalog/Rete/CEP
```

Это минимально сложная архитектура, потому что она не вводит инфраструктуру, которой пока не требует workload, но сохраняет все точки расширения, необходимые для доказуемых переходов, временных правил, uncertainty, provenance и замены отдельных execution engines.

---

# Приложение A. Основные технические источники

Использовались первичные/официальные источники:

- SQLite Documentation: JSON functions, window functions, partial/expression indexes, WAL, query planning, foreign keys, release history.
- W3C SCXML Recommendation.
- XState / Stately official documentation and GitHub release/package metadata.
- W3C RDF 1.2, SPARQL 1.1, OWL 2 Primer, SHACL, PROV-O.
- OMG BPMN 2.0.2 and DMN specification pages.
- Apache KIE/Drools official documentation for agenda/conflict behavior.
- Soufflé official documentation/GitHub release metadata and provenance/type-system docs.
- Neo4j official documentation/repository metadata.
- Comunica official repository/releases/docs.
- `bpmn-engine` official repository/package metadata.
- `json-rules-engine` official repository/package metadata.

