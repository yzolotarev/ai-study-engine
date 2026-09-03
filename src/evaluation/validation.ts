import type {
  EvaluationProtocol,
  PolicyVariant,
  StudyPack,
  StudyPackMatchedSet,
  StudyPackMicrotopic,
  StudyPackForm,
  RubricCriterion,
} from "./types.js";

export interface ValidationIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export interface ValidationResult<T> {
  readonly ok: boolean;
  readonly value?: T;
  readonly issues: readonly ValidationIssue[];
}

function issue(path: string, code: string, message: string): ValidationIssue {
  return { path, code, message };
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function nonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function arrayOfStrings(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function validateCriteria(criteria: readonly RubricCriterion[], path: string, issues: ValidationIssue[]): boolean {
  if (!Array.isArray(criteria) || criteria.length === 0) {
    issues.push(issue(path, "EMPTY_CRITERIA", "rubric criteria must be a non-empty array"));
    return false;
  }
  const ids = new Set<string>();
  let ok = true;
  for (const [index, criterion] of criteria.entries()) {
    const criterionPath = `${path}[${index}]`;
    if (!nonEmpty(criterion?.id) || !nonEmpty(criterion?.description)) {
      issues.push(issue(criterionPath, "INVALID_CRITERION", "criterion id and description must be non-empty strings"));
      ok = false;
      continue;
    }
    if (ids.has(criterion.id)) {
      issues.push(issue(criterionPath, "DUPLICATE_CRITERION", `duplicate criterion id ${criterion.id}`));
      ok = false;
    }
    ids.add(criterion.id);
  }
  return ok;
}

function validateForm(form: StudyPackForm, path: string, issues: ValidationIssue[]): boolean {
  if (!nonEmpty(form?.formId) || !nonEmpty(form?.title) || !nonEmpty(form?.prompt)) {
    issues.push(issue(path, "INVALID_FORM", "formId, title, and prompt must be non-empty strings"));
    return false;
  }
  if (!['text', 'voice', 'map', 'canvas'].includes(form.artifactType)) {
    issues.push(issue(path, "INVALID_FORM_TYPE", `artifactType ${String(form.artifactType)} is not allowed`));
    return false;
  }
  return true;
}

function validateMicrotopic(microtopic: StudyPackMicrotopic, path: string, issues: ValidationIssue[]): boolean {
  if (!nonEmpty(microtopic?.microtopicId) || !nonEmpty(microtopic?.title) || !nonEmpty(microtopic?.goalContract)) {
    issues.push(issue(path, "INVALID_MICROTOPIC", "microtopicId, title, and goalContract must be non-empty strings"));
    return false;
  }
  return validateCriteria(microtopic.rubric, `${path}.rubric`, issues);
}

function validateMatchedSet(set: StudyPackMatchedSet, path: string, microtopicIds: Set<string>, issues: ValidationIssue[]): boolean {
  if (!nonEmpty(set?.matchedSetId) || !nonEmpty(set?.description)) {
    issues.push(issue(path, "INVALID_MATCHED_SET", "matchedSetId and description must be non-empty strings"));
    return false;
  }
  if (!arrayOfStrings(set.microtopicIds) || set.microtopicIds.length < 2) {
    issues.push(issue(path, "INVALID_MATCHED_SET", "matched sets must reference at least two microtopic ids"));
    return false;
  }
  if (new Set(set.microtopicIds).size !== set.microtopicIds.length) {
    issues.push(issue(path, "DUPLICATE_MATCHED_TOPIC", `matched set ${set.matchedSetId} repeats a microtopic id`));
    return false;
  }
  for (const microtopicId of set.microtopicIds) {
    if (!microtopicIds.has(microtopicId)) {
      issues.push(issue(path, "UNKNOWN_MICROTOPIC", `matched set ${set.matchedSetId} references unknown microtopic ${microtopicId}`));
      return false;
    }
  }
  if (!Array.isArray(set.equivalenceMetadata?.sourceHashes) || set.equivalenceMetadata.sourceHashes.some((hash) => !nonEmpty(hash))) {
    issues.push(issue(path, "INVALID_EQUIVALENCE", "equivalenceMetadata.sourceHashes must be non-empty strings"));
    return false;
  }
  if (!nonEmpty(set.equivalenceMetadata?.rationale) || !Array.isArray(set.equivalenceMetadata?.matchingDimensions) || set.equivalenceMetadata.matchingDimensions.some((item) => !nonEmpty(item))) {
    issues.push(issue(path, "INVALID_EQUIVALENCE", "equivalence rationale and matching dimensions must be non-empty"));
    return false;
  }
  return true;
}

function validatePolicyVariant(variant: PolicyVariant, path: string, issues: ValidationIssue[]): boolean {
  if (!nonEmpty(variant?.policyId) || !nonNegativeInt(variant?.policyVersion) || !nonEmpty(variant?.description)) {
    issues.push(issue(path, "INVALID_POLICY_VARIANT", "policyId, policyVersion, and description are required"));
    return false;
  }
  if (!variant.createdAt || !variant.updatedAt) {
    issues.push(issue(path, "INVALID_POLICY_VARIANT", "policy variant timestamps are required"));
    return false;
  }
  if (!Array.isArray(variant.allowedPhases) || variant.allowedPhases.some((phase) => !["pretest", "immediate", "transfer", "delayed"].includes(phase))) {
    issues.push(issue(path, "INVALID_POLICY_VARIANT", "allowedPhases must be evaluation checkpoint phases"));
    return false;
  }
  if (!Array.isArray(variant.allowedIntents) || variant.allowedIntents.some((item) => !nonEmpty(item))) {
    issues.push(issue(path, "INVALID_POLICY_VARIANT", "allowedIntents must be non-empty strings"));
    return false;
  }
  if (!Array.isArray(variant.featureFlags) || variant.featureFlags.some((item) => !nonEmpty(item))) {
    issues.push(issue(path, "INVALID_POLICY_VARIANT", "featureFlags must be non-empty strings"));
    return false;
  }
  if (!variant.runtimeSpec || variant.runtimeSpec.schemaVersion !== 1
      || variant.runtimeSpec.readyRule !== "all-required-criteria-met"
      || variant.runtimeSpec.gapSelection !== "first-unmet-or-unknown"
      || (variant.runtimeSpec.supportMode !== "minimal-gap-cue" && variant.runtimeSpec.supportMode !== "structured-orientation")
      || (variant.runtimeSpec.gapIntent !== "minimal_remediation" && variant.runtimeSpec.gapIntent !== "orientation")
      || !Number.isInteger(variant.runtimeSpec.interventionBudget?.maxDurationMs)
      || variant.runtimeSpec.interventionBudget.maxDurationMs <= 0
      || (variant.runtimeSpec.interventionBudget.maxHelpLevel !== "process_prompt" && variant.runtimeSpec.interventionBudget.maxHelpLevel !== "minimal_hint")
      || variant.runtimeSpec.requiredSequence?.transferAfterCleanPretest !== true
      || variant.runtimeSpec.requiredSequence?.delayedAfterTransfer !== true
      || variant.runtimeSpec.disclosurePolicy !== "assessment-isolated"
      || variant.runtimeSpec.fallback !== "stop") {
    issues.push(issue(path, "INVALID_POLICY_RUNTIME", "policy variant must declare a supported executable runtimeSpec"));
  }
  return true;
}

export function validateEvaluationProtocol(input: unknown): ValidationResult<EvaluationProtocol> {
  const issues: ValidationIssue[] = [];
  const value = input as EvaluationProtocol;
  if (!nonEmpty(value?.protocolId) || !nonNegativeInt(value?.version) || !nonEmpty(value?.title) || !nonEmpty(value?.domain)) {
    issues.push(issue("protocol", "INVALID_PROTOCOL", "protocolId, version, title, and domain are required"));
    return { ok: false, issues };
  }
  if (!nonEmpty(value.hypothesis) || !nonEmpty(value.primaryOutcome)) {
    issues.push(issue("protocol", "INVALID_PROTOCOL", "hypothesis and primaryOutcome are required"));
  }
  if (!arrayOfStrings(value.secondaryOutcomes) || value.secondaryOutcomes.some((item) => !nonEmpty(item))) {
    issues.push(issue("protocol.secondaryOutcomes", "INVALID_PROTOCOL", "secondaryOutcomes must be non-empty strings"));
  }
  if (!nonNegativeInt(value.retentionDelayDays) || !nonNegativeInt(value.sessionTimeBudgetMinutes)) {
    issues.push(issue("protocol", "INVALID_PROTOCOL", "retentionDelayDays and sessionTimeBudgetMinutes must be positive integers"));
  }
  if (!Array.isArray(value.allowedArtifactTypes) || value.allowedArtifactTypes.some((item) => !["text", "voice", "map", "canvas"].includes(item))) {
    issues.push(issue("protocol.allowedArtifactTypes", "INVALID_PROTOCOL", "allowedArtifactTypes must be text, voice, map, or canvas"));
  }
  if (value.topicAssignmentRules?.method !== "seeded-rotation" || value.topicAssignmentRules?.counterbalance !== "paired-rotation" || value.topicAssignmentRules?.lockStartedTrials !== true) {
    issues.push(issue("protocol.topicAssignmentRules", "INVALID_PROTOCOL", "topic assignment rules must use seeded-rotation + paired-rotation and lock started trials"));
  }
  if (value.scorerRequirements?.requireBlindScoring !== true || !nonEmpty(value.scorerRequirements?.rubricVersion)) {
    issues.push(issue("protocol.scorerRequirements", "INVALID_PROTOCOL", "scorer requirements must require blind scoring and a rubric version"));
  }
  const variants = Array.isArray(value.policyVariants) ? value.policyVariants : [];
  if (variants.length === 0) {
    issues.push(issue("protocol.policyVariants", "INVALID_PROTOCOL", "at least one policy variant is required"));
  }
  const ids = new Set<string>();
  for (const [index, variant] of variants.entries()) {
    if (!validatePolicyVariant(variant, `protocol.policyVariants[${index}]`, issues)) continue;
    const key = `${variant.policyId}@${variant.policyVersion}`;
    if (ids.has(key)) {
      issues.push(issue(`protocol.policyVariants[${index}]`, "DUPLICATE_POLICY_VARIANT", `duplicate policy variant ${key}`));
    }
    ids.add(key);
  }
  if (!value.createdAt || !value.updatedAt) {
    issues.push(issue("protocol", "INVALID_PROTOCOL", "timestamps are required"));
  }
  if (!nonEmpty(value.metadata?.createdBy) || value.metadata?.schemaVersion !== 1) {
    issues.push(issue("protocol.metadata", "INVALID_PROTOCOL", "protocol metadata schemaVersion 1 and createdBy are required"));
  }
  return issues.length === 0 ? { ok: true, value, issues } : { ok: false, issues };
}

export function validateStudyPack(input: unknown): ValidationResult<StudyPack> {
  const issues: ValidationIssue[] = [];
  const value = input as StudyPack;
  if (!nonEmpty(value?.packId) || !nonNegativeInt(value?.version) || !nonEmpty(value?.domain)) {
    issues.push(issue("pack", "INVALID_PACK", "packId, version, and domain are required"));
    return { ok: false, issues };
  }
  if (!Array.isArray(value.sourceReferences) || value.sourceReferences.some((item) => !nonEmpty(item))) {
    issues.push(issue("pack.sourceReferences", "INVALID_PACK", "sourceReferences must be non-empty strings"));
  }
  if (!validateCriteria(value.rubric, "pack.rubric", issues)) {
    // issue already recorded
  }
  const microtopics = Array.isArray(value.microtopics) ? value.microtopics : [];
  if (microtopics.length === 0) {
    issues.push(issue("pack.microtopics", "INVALID_PACK", "at least one microtopic is required"));
  }
  const microtopicIds = new Set<string>();
  for (const [index, microtopic] of microtopics.entries()) {
    if (!validateMicrotopic(microtopic, `pack.microtopics[${index}]`, issues)) continue;
    if (microtopicIds.has(microtopic.microtopicId)) {
      issues.push(issue(`pack.microtopics[${index}]`, "DUPLICATE_MICROTOPIC", `duplicate microtopic ${microtopic.microtopicId}`));
    }
    microtopicIds.add(microtopic.microtopicId);
  }
  const sets = Array.isArray(value.matchedSets) ? value.matchedSets : [];
  if (sets.length === 0) {
    issues.push(issue("pack.matchedSets", "INVALID_PACK", "at least one matched set is required"));
  }
  const matchedSetIds = new Set<string>();
  for (const [index, set] of sets.entries()) {
    if (!validateMatchedSet(set, `pack.matchedSets[${index}]`, microtopicIds, issues)) continue;
    if (matchedSetIds.has(set.matchedSetId)) {
      issues.push(issue(`pack.matchedSets[${index}]`, "DUPLICATE_MATCHED_SET", `duplicate matched set ${set.matchedSetId}`));
    }
    matchedSetIds.add(set.matchedSetId);
  }
  if (!validateForm(value.pretestForm, "pack.pretestForm", issues)) {
    // issue already recorded
  }
  if (!validateForm(value.immediateForm, "pack.immediateForm", issues)) {
    // issue already recorded
  }
  if (!validateForm(value.transferForm, "pack.transferForm", issues)) {
    // issue already recorded
  }
  if (!validateForm(value.delayedForm, "pack.delayedForm", issues)) {
    // issue already recorded
  }
  const forms = [value.pretestForm, value.immediateForm, value.transferForm, value.delayedForm];
  const formIds = forms.map((form) => form?.formId).filter((formId): formId is string => typeof formId === "string");
  if (new Set(formIds).size !== formIds.length) issues.push(issue("pack.forms", "DUPLICATE_FORM_ID", "assessment form IDs must be unique"));
  const prompts = forms.map((form) => form?.prompt).filter((prompt): prompt is string => typeof prompt === "string");
  if (new Set(prompts).size !== prompts.length) issues.push(issue("pack.forms", "NON_DISTINCT_FORMS", "assessment prompts must be materially distinct"));
  const rubricIds = new Set((Array.isArray(value.rubric) ? value.rubric : []).map((criterion) => criterion.id));
  for (const [index, microtopic] of microtopics.entries()) {
    if (Array.isArray(microtopic?.rubric) && new Set((microtopic.rubric as readonly RubricCriterion[]).map((criterion: RubricCriterion) => criterion.id)).size !== rubricIds.size
      || Array.isArray(microtopic?.rubric) && (microtopic.rubric as readonly RubricCriterion[]).some((criterion: RubricCriterion) => !rubricIds.has(criterion.id))) {
      issues.push(issue(`pack.microtopics[${index}].rubric`, "RUBRIC_MISMATCH", "microtopic rubric IDs must match the pack rubric"));
    }
  }
  if (!nonEmpty(value.scoringMaterials?.scoringGuidance) || !nonEmpty(value.scoringMaterials?.disagreementPolicy)) {
    issues.push(issue("pack.scoringMaterials", "INVALID_SCORING_MATERIALS", "scoring guidance and disagreement policy are required"));
  }
  if (!value.createdAt || !value.updatedAt || !value.metadata?.createdBy
      || !["human-ready", "calibration-only", "synthetic-only"].includes(value.metadata?.classification)
      || !nonEmpty(value.metadata?.author) || !nonEmpty(value.metadata?.reviewer)
      || !Array.isArray(value.metadata?.changeHistory) || value.metadata.changeHistory.some((entry) => !nonEmpty(entry))
      || value.metadata?.schemaVersion !== 1) {
    issues.push(issue("pack", "INVALID_PACK", "timestamps and schema metadata are required"));
  }
  if (!value.equivalenceMetadata || !nonEmpty(value.equivalenceMetadata.rationale) || !Array.isArray(value.equivalenceMetadata.sourceHashes) || value.equivalenceMetadata.sourceHashes.some((item) => !nonEmpty(item))) {
    issues.push(issue("pack.equivalenceMetadata", "INVALID_PACK", "equivalenceMetadata requires a rationale and source hashes"));
  }
  return issues.length === 0 ? { ok: true, value, issues } : { ok: false, issues };
}
