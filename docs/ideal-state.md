# AI Study Engine — Ideal State

- **Статус:** целевая спецификация, не описание текущей готовности
- **Горизонт:** первая доказательно пригодная локальная система и добровольная ограниченная beta
- **Дата:** 2026-08-27

## 1. North Star

AI Study Engine помогает человеку сформировать устойчивую, переносимую способность и показывает,
какие именно наблюдения подтверждают или опровергают этот результат. Система не подменяет обучение
красивым диалогом, правильным ответом сразу после объяснения или внутренней уверенностью модели.

Ideal State достигнут, когда пользователь может выбрать конкретную capability, пройти короткий
адаптивный цикл, самостоятельно продемонстрировать её в чистой попытке, перенести в новые условия,
вернуться к ней после реальной задержки и получить проверяемый отчёт без смешения помощи, симуляций,
субъективных впечатлений и learner evidence.

Краткая формула:

> Минимально необходимая помощь → самостоятельное действие → точный gap → новая чистая попытка →
> materially distinct transfer и/или delayed retrieval → честное решение с явной неопределённостью.

## 2. Непереговорные инварианты

1. **Только ученик создаёт learner evidence.** AI, tutor, fixture, shared artifact и оператор не могут
   технически записать собственный текст как ответ ученика.
2. **Помощь не маскируется под знание.** Содержательная помощь во время попытки автоматически делает
   её contaminated. После помощи нужна новая попытка с новым identity и без answer leakage.
3. **Mastery выводится, а не передаётся параметром.** Caller не задаёт `passed`, `independent`,
   `mastered`, `delayed` или `verified`; kernel выводит их из проверяемых событий.
4. **Immediate performance не равна learning.** Немедленный успех диагностически полезен, но не
   заменяет чистый transfer или реальную delayed retrieval.
5. **Tutoring и assessment разделены.** Tutor не видит будущие задания, answer keys, scorer guidance
   или ожидаемое направление результата.
6. **Scoring blind by construction.** Scorer не получает policy, intervention history, participant
   identity, прежние оценки или гипотезу эксперимента.
7. **Human, synthetic и legacy данные не смешиваются.** Provenance является обязательным
   schema-level полем и проверяется как в JSON snapshot, так и в индексированном storage boundary.
8. **Неизвестное остаётся неизвестным.** Missing data, corrupt history, scorer disagreement и
   неоткрытый delayed checkpoint не превращаются в ноль или удобный положительный результат.
9. **Каждое решение воспроизводимо.** Состояние, next action, completion и отчёт восстанавливаются из
   версионированного append-only журнала и immutable snapshots.
10. **Local-first и consent-first.** Нет фоновой отправки, обязательного аккаунта, telemetry или
    research export без явного preview и подтверждения.

## 3. Идеальный пользовательский цикл

1. Пользователь формулирует узкую capability и observable success criteria.
2. Система подтверждает цель через trusted human ingress и создаёт неизменяемый goal contract.
3. Короткий clean pretest выявляет readiness и конкретные gaps.
4. Если capability уже показана, система не заставляет повторять объяснение, а повышает challenge или
   переходит к transfer.
5. Если есть gap, tutor даёт только минимальную orientation/remediation, связанную с этим gap.
6. Ученик делает новую самостоятельную попытку; scorer проверяет literal grounding и rubric vector.
7. Система предлагает materially distinct transfer. Если protocol требует retention, transfer не
   подменяет delayed retrieval.
8. Через реальное заданное время открывается delayed checkpoint без coaching context.
9. Пользователь видит не один «процент mastery», а evidence vector: что подтверждено, чем, при каких
   условиях, что contaminated, что отсутствует и что нужно проверить дальше.
10. Любой export сначала показывается в preview; raw learner data остаются локальными по умолчанию.

Запрос помощи всегда допустим и не считается ошибкой пользователя. Система просто фиксирует exposure,
закрывает текущую попытку как contaminated и создаёт безопасный путь к новой clean reattempt.

## 4. Целевая архитектура

| Компонент | Ответственность | Не имеет права |
|---|---|---|
| Trusted human ingress | Принимать подтверждение цели и настоящий learner artifact | Быть AI-callable или принимать caller-authorship как доказательство |
| Harness kernel | Replay, evidence validity, gaps, completion, invariants | Вызывать модель, изменять журнал или принимать готовый mastery flag |
| Policy runtime | Выбирать следующий педагогический ход и объём помощи | Создавать learner evidence, закрывать gap или видеть hidden assessment |
| Domain adapter | Создавать domain rubric, transfer constraints и безопасные scaffolds | Выдавать reference answer до commit ученика |
| StudyPack custodian | Хранить coaching surface и закрытые assessment snapshots раздельно | Раскрывать будущие forms или менять начатый pack/rubric |
| Scoring boundary | Оценивать artifact по immutable task/rubric/guidance | Видеть policy, intervention trace, expected result или identity |
| Evaluation Layer | Планировать trial, checkpoints, provenance и reports | Менять Harness mastery/completion или смешивать populations |
| Persistence | Append-only events, integrity hashes, versioned migrations | Молча исправлять, переобозначать или удалять неудобную историю |
| Export boundary | Preview, consent, redaction, manifest | Делать background upload или включать не просмотренные данные |

Kernel остаётся детерминированным и чистым. Модель может предлагать объяснение, вопрос, hypothesis
scaffold или semantic score, но окончательное изменение evidence state проходит только через typed,
проверяемые boundaries.

## 5. Ideal evidence model

### Attempt lifecycle

Каждая попытка имеет стабильный `attemptId`, task/form snapshot, временные границы и provenance.
Содержательная помощь относится только к активной попытке. Повтор после помощи — отдельная попытка,
а не переписанный status прежней.

### Evidence classes

- **Baseline:** показывает исходное состояние, но никогда не доказывает mastery.
- **Clean retrieval:** самостоятельное воспроизведение без видимого ответа и substantive help.
- **Transfer:** новая задача, отличающаяся не только словами, числами или поверхностным контекстом.
- **Delayed retrieval:** чистая попытка после реально истёкшего retention interval.
- **Contaminated artifact:** сохраняется для диагностики, но не используется как clean outcome.
- **AI/shared artifact:** может быть материалом или trace, но не learner evidence.

### Completion

Completion возможен только при подтверждённой цели, полной rubric, оценённом baseline, отсутствии open
gaps, clean passing retrieval для каждого обязательного criterion и требуемом protocol transfer или
delayed evidence. Corrupt, legacy, early-delayed и contaminated записи fail closed.

## 6. Исполняемые policy variants

В Ideal State policy variant — не label в отчёте, а версионированная исполняемая спецификация:

- readiness rules;
- разрешённые intents и phases;
- intervention budget;
- правило выбора конкретного gap;
- максимальный уровень помощи до clean reattempt;
- условия skip, escalation, pause и stop;
- disclosure policy;
- deterministic fallback при недоступной модели;
- список observable protocol violations.

Policy фиксируется до trial, не меняется после старта и получает одинаковую assessment boundary с
другими variants. Comparison присоединяет policy identity только после blind scoring. Tutor text и
style не должны позволять scorer надёжно угадать condition; residual blinding проверяется отдельно.

## 7. Ideal StudyPack

Каждый реальный StudyPack проходит содержательную и техническую валидацию и содержит:

- узкую capability и domain scope;
- source metadata и hashes;
- matched-topic sets с equivalence rationale;
- immutable rubric criteria и anchors;
- разные pretest, immediate, transfer и delayed forms;
- reference/scoring guidance, закрытые от tutor;
- доказательство materially distinct forms;
- scorer requirements и disagreement policy;
- retention delay и time budget;
- version, author/reviewer и change history;
- classification: human-ready, calibration-only или synthetic-only.

Ни filename, ни `notes`, ни договорённость в prompt не являются isolation boundary. Hidden forms
доступны только custodian-компоненту и раскрываются ровно в момент разрешённого checkpoint.

## 8. Evaluation и научная честность

### Human trials

Основной дизайн — добровольный N-of-1 matched-topic protocol с pre-registered variants, outcomes,
exclusions и retention interval. Отчёт хранит rubric vectors, uncertainty, missing markers, costs,
contamination и critical incidents. Он не вычисляет псевдоточную универсальную mastery probability.

Минимальный primary outcome — blind-scored clean transfer с учётом baseline. Delayed retrieval —
отдельное более сильное свидетельство. Subjective clarity/usefulness остаются отдельными UX signals.

### Synthetic checks

Synthetic trials проверяют state transitions, leakage, ingress, contamination, delayed gating,
reproducibility и reporting. Они используют отдельную БД/namespace и обязательный provenance.
Их результат называется только software/behavioral check. Fresh-context reconstruction модели не
называется человеческим retention.

### Interpretation

Один pilot проверяет usability и integrity. Несколько matched trials одного человека дают только
локальный ориентир. Внешний efficacy claim требует заранее определённого анализа, нескольких людей,
domain review, scorer calibration и независимой проверки.

## 9. Privacy и security

Ideal State остаётся полезным полностью офлайн:

- локальная SQLite SSOT;
- отсутствие обязательного аккаунта;
- никакой telemetry, email или background upload;
- raw voice не хранится по умолчанию;
- шифрование локальной базы и backups доступно как opt-in;
- user-controlled retention и проверяемое удаление;
- secret/PII scan перед export;
- exact manifest, preview hash и consent record;
- research export соответствует именно просмотренному immutable preview;
- threat model и incident procedure документированы.

Pseudonymized никогда не называется anonymous. Локальный операторский доступ и malware на устройстве
остаются отдельными рисками и явно описываются пользователю.

## 10. UX Ideal State

- Один естественный learner workflow вместо ручной сборки JSON-команд.
- Tutor показывает цель, текущую фазу, доступный тип помощи и причину следующего шага.
- Hidden prompts и scorer guidance никогда не появляются в learner/tutor surface.
- Таймер session budget не включает retention delay.
- Delayed queue показывает due time, но не открывает prompt раньше срока.
- Пользователь может остановиться, возобновить, увидеть provenance и оспорить scoring.
- Accessibility: text-first baseline, keyboard-only flow, screen-reader labels и явные modality limits.
- Ошибка или crash не теряет learner artifact и не превращает retry в новую «успешную» запись.

## 11. Reliability и engineering quality

Перед ограниченной beta система должна иметь:

- versioned schemas и обратимые, fail-closed migrations;
- payload/integrity hashes и corruption tests;
- idempotent commands и stable IDs;
- transaction-safe SQLite writes и явную concurrent-writer policy;
- deterministic replay fingerprints;
- property/fuzz tests для invalid event order и malformed input;
- golden tests для mastery semantics;
- leakage canaries и residual-blinding probes;
- crash/restart, backup/restore и migration smoke tests;
- synthetic fixtures, физически отделённые от human datasets;
- полный `check`, CLI smoke и `git diff --check` без скрытых failures.

Ни один автоматический тест не объявляется доказательством learning. Он доказывает только конкретный
software invariant, указанный в названии и assertion.

## 12. Definition of Done по maturity gates

| Gate | Состояние | Проверяемый выход |
|---|---|---|
| G0 — Kernel integrity | Mastery semantics, provenance и replay fail closed | Полный deterministic/golden/adversarial suite |
| G1 — Executable policies | Два variants реально управляют разными intervention flows | Typed traces показывают разные действия при одинаковом state |
| G2 — Synthetic integrity | Несколько fixtures/seeds проходят leakage и boundary matrix | Отдельный synthetic report без human claims |
| G3 — Personal calibration | Один ручной 10-минутный pilot удобен и полностью журналируется | Clean pretest/transfer и due delayed workflow без measurement failures |
| G4 — Personal N-of-1 | 6–12 matched-topic trials с реальными delayed outcomes | Blind vector report с uncertainty и всеми exclusions |
| G5 — Limited voluntary beta | Domain packs, privacy review и operator protocol готовы | Informed consent, opt-in export, scorer audit и incident plan |
| G6 — Efficacy research | Дизайн и sample позволяют внешний вывод | Pre-registration, independent analysis и воспроизводимый dataset |

Переход к следующему gate запрещён, если предыдущий имеет leakage, provenance violation, unblinded
scoring, corrupt migration, false completion или скрытый failed test.

## 13. Текущий разрыв до Ideal State

### Уже существует

- отдельный Harness v2 с deterministic replay и evidence-constrained completion;
- trusted learner ingress и запрет AI создавать learner evidence;
- contamination, gap lifecycle, clean retrieval, transfer и retention boundaries;
- local SQLite persistence с integrity checks;
- Evaluation Layer sidecar, blind scorer input и assessment isolation;
- schema-backed separation `human` / `synthetic` / `legacy-unclassified`;
- capability-bound human and synthetic artifact ingress, indexed/JSON integrity checks;
- delayed prompt gating, immutable started snapshots, stale-preview rejection and byte-level manifests;
- stable checkpoint/attempt identities with distinct clean retries after substantive help;
- executable deterministic policy runtime with fail-closed typed traces;
- complete deterministic synthetic matrix and local runner (2 policies × 4 readiness × 4 seeds × 2 help modes);
- отдельный synthetic behavioral report и hard exclusion из human exports;
- calibration StudyPack и operator runbook;
- local backup/integrity commands, opt-in encrypted backup, explicit deletion tombstones, and full
  software test contour.

### Главные gaps

1. Policy runtime теперь исполняет typed state transitions, но не является полноценным tutor UI и
   не подключён к внешней модели; benchmark остаётся software/behavioral check.
2. Synthetic runner исполняет 64 isolated cells воспроизводимо, но это остаётся software/behavioral
   проверкой одной fixture и не заменяет несколько независимых domain fixtures или analysis plan.
3. Нет завершённого ручного human pilot и настоящего 48-часового delayed artifact.
4. Нет серии реальных matched-topic StudyPacks и независимой domain review.
5. Semantic scorers не откалиброваны на реальных artifacts; нет измеренного inter-rater agreement.
6. Trusted human ingress остаётся operator/CLI boundary, а не полноценным end-user UI или аппаратной
   attestation; кодовая capability не доказывает, кто физически ввёл текст.
7. Backup/integrity, opt-in encrypted backup и user-controlled deletion готовы для локального
   оператора; concurrency contract и incident recovery ещё требуют beta-grade операционной политики.
8. Residual blinding по идентификаторам и prompt style требует отдельного probe/domain review.
9. Evaluation sidecar использует строгие immutable/idempotent записи, integrity columns и
   hash-chained local audit events; полноценный multi-writer append-only service и replay UI остаются
   отдельной задачей.
10. Нет оснований для внешнего learning efficacy claim.

## 14. Осознанные non-goals

До появления данных и реальной необходимости не добавляются:

- POMDP, reinforcement learning или learned policy;
- автоматическая универсальная mastery probability;
- knowledge graph всей дисциплины;
- скрытая personalization по telemetry;
- публичный leaderboard или dashboard;
- accounts, background upload и automatic research consent;
- автоматическое превращение AI simulation в human evidence;
- efficacy claims по одному человеку, fixture или immediate score.

## 15. Итоговое определение

Ideal AI Study Engine — это локальная, воспроизводимая и адаптивная учебная система, которая помогает
ровно настолько, насколько нужно, но доверяет только самостоятельному действию ученика; отделяет
обучение от немедленной производительности, assessment от tutoring, human evidence от simulation и
факты от неопределённости; а каждый вывод делает проверяемым, ограниченным и отзывным.
