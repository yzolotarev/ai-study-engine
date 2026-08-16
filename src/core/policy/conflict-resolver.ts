export interface InterventionCandidate {
  ruleId: string;
  detectionId: string;
  interventionTemplateId: string;
  interventionTemplateVersion: number;
  interventionKind: "process_only" | "content_cue" | "structure_reveal";
  priority: number;
  severity: number;
  specificity: number;
  evidenceStrength: number;
  budgetCost: number;
  hardSafetyRank: number;
  cooldownSatisfied: boolean;
  invariantSatisfied: boolean;
  oscillationBlocked: boolean;
  suppressesRuleIds: readonly string[];
  semanticEffects: readonly string[];
}

export interface ConflictTraceEntry {
  ruleId: string;
  disposition: "eligible" | "discarded" | "suppressed" | "merged" | "selected";
  reason: string;
}

export interface ConflictResolution {
  selected?: InterventionCandidate;
  trace: ConflictTraceEntry[];
}

function compareCandidates(a: InterventionCandidate, b: InterventionCandidate): number {
  return (
    b.hardSafetyRank - a.hardSafetyRank ||
    b.priority - a.priority ||
    b.severity - a.severity ||
    b.specificity - a.specificity ||
    b.evidenceStrength - a.evidenceStrength ||
    a.budgetCost - b.budgetCost ||
    a.ruleId.localeCompare(b.ruleId)
  );
}

function sameEffect(a: InterventionCandidate, b: InterventionCandidate): boolean {
  return a.semanticEffects.some((effect) => b.semanticEffects.includes(effect));
}

export function resolveConflict(
  candidates: readonly InterventionCandidate[],
  options: { interventionBudget: number },
): ConflictResolution {
  const trace: ConflictTraceEntry[] = [];
  const eligible: InterventionCandidate[] = [];

  for (const candidate of candidates) {
    if (!candidate.invariantSatisfied) {
      trace.push({ ruleId: candidate.ruleId, disposition: "discarded", reason: "hard invariant failed" });
    } else if (!candidate.cooldownSatisfied) {
      trace.push({ ruleId: candidate.ruleId, disposition: "discarded", reason: "cooldown active" });
    } else if (candidate.oscillationBlocked) {
      trace.push({ ruleId: candidate.ruleId, disposition: "discarded", reason: "oscillation guard" });
    } else if (candidate.budgetCost > options.interventionBudget) {
      trace.push({ ruleId: candidate.ruleId, disposition: "discarded", reason: "intervention budget exceeded" });
    } else {
      eligible.push(candidate);
      trace.push({ ruleId: candidate.ruleId, disposition: "eligible", reason: "passed invariant, cooldown, and budget" });
    }
  }

  const ranked = eligible.sort(compareCandidates);
  const surviving: InterventionCandidate[] = [];
  for (const candidate of ranked) {
    const suppressor = surviving.find((kept) => kept.suppressesRuleIds.includes(candidate.ruleId));
    if (suppressor) {
      trace.push({
        ruleId: candidate.ruleId,
        disposition: "suppressed",
        reason: `suppressed by higher-ranked ${suppressor.ruleId}`,
      });
      continue;
    }
    const equivalent = surviving.find((kept) => sameEffect(kept, candidate));
    if (equivalent) {
      trace.push({
        ruleId: candidate.ruleId,
        disposition: "merged",
        reason: `same semantic effect as higher-ranked ${equivalent.ruleId}`,
      });
      continue;
    }
    surviving.push(candidate);
  }

  const selected = surviving[0];
  if (selected) {
    trace.push({ ruleId: selected.ruleId, disposition: "selected", reason: "highest deterministic rank" });
    return { selected, trace };
  }
  return { trace };
}
