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
    const literalQuotes = item.quotes.filter((quote) => quote.length > 0 && artifact?.content.includes(quote));
    if (item.met && literalQuotes.length === 0) {
      reasons.push(`criterion ${item.criterionId} has no literal supporting quote`);
    }
    if (item.quotes.some((quote) => !artifact?.content.includes(quote))) {
      reasons.push(`criterion ${item.criterionId} cites text absent from artifact`);
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

export function elapsedDays(fromIso: string, toIso: string): number {
  return (Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000;
}
