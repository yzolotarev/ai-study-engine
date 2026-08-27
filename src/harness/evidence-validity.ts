import type { CriterionAssessmentInput, ProjectedAttempt, RubricCriterion } from "./types.js";

export interface AssessmentValidation {
  readonly valid: boolean;
  readonly reasons: readonly string[];
  readonly criteria: Readonly<Record<string, { readonly met: boolean; readonly quotes: readonly string[] }>>;
}

/** An assessment is evidence only when every rubric criterion is addressed and
 * every positive claim points to a non-empty literal fragment of the learner artifact. */
export function validateAssessment(
  artifact: ProjectedAttempt["artifact"],
  rubric: readonly RubricCriterion[],
  assessments: readonly CriterionAssessmentInput[],
): AssessmentValidation {
  const reasons: string[] = [];
  const criteria: Record<string, { met: boolean; quotes: readonly string[] }> = {};
  if (!artifact) reasons.push("attempt has no submitted artifact");
  else if (artifact.author !== "learner") reasons.push(`${artifact.author} artifact is not learner evidence`);

  const expected = new Map(rubric.map((criterion) => [criterion.id, criterion]));
  for (const item of assessments) {
    if (!expected.has(item.criterionId)) {
      reasons.push(`unknown criterion ${item.criterionId}`);
      continue;
    }
    if (criteria[item.criterionId]) {
      reasons.push(`duplicate criterion ${item.criterionId}`);
      continue;
    }
    const literalQuotes = item.quotes.filter((quote) => hasMeaningfulText(quote) && artifact?.content.includes(quote));
    if (item.met && literalQuotes.length === 0) {
      reasons.push(`criterion ${item.criterionId} has no meaningful literal supporting quote`);
    }
    if (item.quotes.some((quote) => !hasMeaningfulText(quote) || !artifact?.content.includes(quote))) {
      reasons.push(`criterion ${item.criterionId} cites empty, punctuation-only, or absent text`);
    }
    criteria[item.criterionId] = { met: item.met, quotes: literalQuotes };
  }
  for (const criterion of rubric) {
    if (!criteria[criterion.id]) reasons.push(`criterion ${criterion.id} was not assessed`);
  }
  return { valid: reasons.length === 0, reasons, criteria };
}

export function isIndependentEvidence(attempt: ProjectedAttempt): boolean {
  return attempt.kind !== "baseline"
    && !attempt.contaminated
    && attempt.artifact?.author === "learner"
    && attempt.assessment?.allMet === true;
}

export const MAX_NOVELTY_JACCARD = 0.72;
export const MAX_NOVELTY_CONTAINMENT = 0.85;

export interface TextNovelty {
  readonly distinct: boolean;
  readonly normalizedLeft: string;
  readonly normalizedRight: string;
  readonly tokenJaccard: number;
  readonly tokenContainment: number;
}

export function normalizeForNovelty(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function hasMeaningfulText(value: string): boolean {
  return /[\p{L}\p{N}]/u.test(value.normalize("NFKC"));
}

export function compareTextNovelty(left: string, right: string): TextNovelty {
  const normalizedLeft = normalizeForNovelty(left);
  const normalizedRight = normalizeForNovelty(right);
  const leftTokens = new Set(normalizedLeft.split(" ").filter(Boolean));
  const rightTokens = new Set(normalizedRight.split(" ").filter(Boolean));
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  const shorter = Math.min(leftTokens.size, rightTokens.size);
  const tokenJaccard = union === 0 ? 1 : intersection / union;
  const tokenContainment = shorter === 0 ? 1 : intersection / shorter;
  const distinct = normalizedLeft.length > 0
    && normalizedRight.length > 0
    && normalizedLeft !== normalizedRight
    && tokenJaccard < MAX_NOVELTY_JACCARD
    && tokenContainment < MAX_NOVELTY_CONTAINMENT;
  return { distinct, normalizedLeft, normalizedRight, tokenJaccard, tokenContainment };
}

export function isNovelTransfer(transfer: ProjectedAttempt, retrieval: ProjectedAttempt): boolean {
  const retrievalFinishedAt = retrieval.assessment?.assessedAt;
  return transfer.kind === "transfer"
    && isIndependentEvidence(transfer)
    && retrievalFinishedAt !== undefined
    && Date.parse(transfer.startedAt) > Date.parse(retrievalFinishedAt)
    && compareTextNovelty(transfer.prompt, retrieval.prompt).distinct
    && compareTextNovelty(transfer.artifact?.content ?? "", retrieval.artifact?.content ?? "").distinct;
}

export function elapsedDays(fromIso: string, toIso: string): number {
  return (Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000;
}
