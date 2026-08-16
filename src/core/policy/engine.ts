import type { ConditionAST, ConditionTrace, EvaluationContext, ValueExpression } from "./condition.js";
import { evaluateCondition } from "./condition.js";
import { resolveConflict, type InterventionCandidate } from "./conflict-resolver.js";
import type { StudyStore } from "../../db/store.js";

export interface PolicyEvaluationInput {
  sessionId: string;
  targetId?: string;
  eventType?: string;
  triggeringEventId?: string;
  facts?: Record<string, string | number | boolean | null | undefined>;
}

export interface PolicyEvaluationResult {
  activationId: string;
  bundle: { bundleId: string; bundleVersion: number };
  detections: Array<{ detectionId: string; policyId: string; result: string; confidence: number }>;
  selectedIntervention: { interventionId: string; templateId: string; templateVersion: number } | undefined;
  conflictTrace: readonly { ruleId: string; disposition: string; reason: string }[];
}

function conditionDepth(node: ConditionAST): number {
  switch (node.op) {
    case "const":
      return 1;
    case "all":
    case "any":
      return 1 + Math.max(0, ...node.args.map(conditionDepth));
    case "not":
      return 1 + conditionDepth(node.arg);
    case "compare":
      return 1;
  }
}

function conditionComplexity(node: ConditionAST): number {
  let complexity = 0;
  const stack: ConditionAST[] = [node];
  while (stack.length) {
    const current = stack.pop()!;
    if (current.op === "compare") complexity += 1;
    if (current.op === "all" || current.op === "any") stack.push(...current.args);
    if (current.op === "not") stack.push(current.arg);
  }
  return complexity;
}

/**
 * Derive registry-specific facts from the existing provenance model so that
 * imported policies (e.g. bp_answer_theft) are evaluable without caller changes.
 * These are reviewable_fact metrics mapped onto contamination_records state:
 *   - ai_contaminated_artifact_saved  <-> status === 'contaminated'
 *   - independent_reconstruction_done <-> closureMethod === 'independent_reconstruction'
 * Scoped per target; returns {} when no targetId is supplied.
 */
function deriveRegistryFacts(
  store: StudyStore,
  targetId?: string,
): EvaluationContext["facts"] {
  if (!targetId) return {};
  const status = store.getContaminationStatus(targetId);
  return {
    ai_contaminated_artifact_saved: status?.status === "contaminated",
    independent_reconstruction_count: status?.closureMethod === "independent_reconstruction" ? 1 : 0,
  };
}

function traceConfidence(trace: ConditionTrace): number {
  if (trace.result === "uncertain") return 0.6;
  const children = trace.children ?? [];
  if (children.length === 0) return 1;
  return Math.min(...children.map(traceConfidence));
}

function collectParametersFromValue(value: ValueExpression, ids: Set<string>): void {
  if (value.kind === "parameter") ids.add(value.id);
}

function collectParameters(node: ConditionAST, ids = new Set<string>()): Set<string> {
  switch (node.op) {
    case "all":
    case "any":
      node.args.forEach((arg) => collectParameters(arg, ids));
      break;
    case "not":
      collectParameters(node.arg, ids);
      break;
    case "compare":
      collectParametersFromValue(node.left, ids);
      collectParametersFromValue(node.right, ids);
      break;
    case "const":
      break;
  }
  return ids;
}

export function evaluatePolicies(store: StudyStore, input: PolicyEvaluationInput): PolicyEvaluationResult {
  const session = store.getSession(input.sessionId);
  if (!session) throw new Error(`Unknown study session: ${input.sessionId}`);
  const activation = store.getPolicyActivation(input.sessionId);
  if (!activation) throw new Error(`No policy activation for session ${input.sessionId}`);

  const policyRefs = store.listBundlePolicies(activation.bundleId, activation.bundleVersion);
  const detections: PolicyEvaluationResult["detections"] = [];
  const candidates: InterventionCandidate[] = [];
  const parameters: Record<string, unknown> = {};

  for (const ref of policyRefs) {
    const definition = store.policyDefinition(ref.policyId, ref.policyVersion);
    if (!definition || definition.status === "disabled" || definition.status === "retired") continue;

    const parameterIds = collectParameters(definition.conditionJson as unknown as ConditionAST);
    for (const parameterId of parameterIds) {
      if (parameters[parameterId] === undefined) {
        const value = store.policyParameterValue(parameterId);
        if (value !== undefined) {
          parameters[parameterId] = value;
        }
      }
    }

    const minutesSinceSensory = (() => {
      const ts = store.findAnchorTimestamp(session.userId, session.id, "last_sensory_input");
      return ts === null ? null : (Date.now() - ts) / 60000;
    })();

    const context: EvaluationContext = {
      facts: {
        ...deriveRegistryFacts(store, input.targetId),
        minutes_since_last_sensory: minutesSinceSensory,
        ...(input.facts ?? {}),
      },
      parameters: parameters as EvaluationContext["parameters"],
      eventCount: ({ eventType, windowMs, targetId, sinceAnchor }) => {
        if (sinceAnchor) {
          const anchorTs = store.findAnchorTimestamp(session.userId, session.id, sinceAnchor);
          if (anchorTs === null) return undefined;
          return store.countStudyEventsByTypeSince({ learnerId: session.userId, eventType, anchorTs, targetId: targetId ?? null });
        }
        const args: { learnerId: string; eventType: string; windowMs?: number; targetId?: string | null } = {
          learnerId: session.userId,
          eventType,
        };
        if (windowMs !== undefined) args.windowMs = windowMs;
        if (targetId !== undefined) args.targetId = targetId ?? null;
        return store.countStudyEventsByType(args);
      },
    };

    const evaluation = evaluateCondition(definition.conditionJson as unknown as ConditionAST, context);
    const confidence = traceConfidence(evaluation.trace);
    const targetId = input.targetId ?? null;
    const triggeringEventId = input.triggeringEventId ?? null;
    const detectionId = store.persistDetection({
      activationId: activation.activationId,
      policyId: ref.policyId,
      policyVersion: ref.policyVersion,
      learnerId: session.userId,
      targetId,
      evaluatedAt: new Date().toISOString(),
      result: evaluation.result,
      confidence,
      trace: evaluation.trace,
      triggeringEventId,
    });
    detections.push({ detectionId, policyId: ref.policyId, result: evaluation.result, confidence });

    if (evaluation.result !== "matched") continue;

    const cooldownSatisfied = !store.cooldownActive(input.sessionId, ref.policyId, definition.cooldownMs);
    const matchedDetectionId = detections.find((x) => x.policyId === ref.policyId)!.detectionId;
    candidates.push({
      ruleId: `${ref.policyId}@${ref.policyVersion}`,
      detectionId: matchedDetectionId,
      interventionTemplateId: definition.interventionTemplateId,
      interventionTemplateVersion: definition.interventionTemplateVersion,
      interventionKind: definition.interventionKind as InterventionCandidate["interventionKind"],
      priority: definition.priority,
      severity: definition.severity,
      specificity: conditionComplexity(definition.conditionJson as unknown as ConditionAST),
      evidenceStrength: confidence,
      budgetCost: 1,
      hardSafetyRank: 0,
      cooldownSatisfied,
      invariantSatisfied: true,
      oscillationBlocked: false,
      suppressesRuleIds: [],
      semanticEffects: [definition.interventionTemplateId],
    });
  }

  const resolution = resolveConflict(candidates, { interventionBudget: 1 });

  let selectedIntervention: PolicyEvaluationResult["selectedIntervention"];
  if (resolution.selected) {
    const interventionId = store.persistIntervention({
      detectionId: resolution.selected.detectionId,
      templateId: resolution.selected.interventionTemplateId,
      templateVersion: resolution.selected.interventionTemplateVersion,
      resolutionTrace: resolution.trace,
    });
    selectedIntervention = {
      interventionId,
      templateId: resolution.selected.interventionTemplateId,
      templateVersion: resolution.selected.interventionTemplateVersion,
    };
  }

  return {
    activationId: activation.activationId,
    bundle: { bundleId: activation.bundleId, bundleVersion: activation.bundleVersion },
    detections,
    selectedIntervention,
    conflictTrace: resolution.trace,
  };
}

/**
 * Sensory-input event hook. The engine is the *consumer* of external sensory
 * events (Objects/Summary/Expand). When a `sensory_input` event is recorded we
 * (re)evaluate the active bundle so policies keyed on `since last_sensory_input`
 * / `last_independent_attempt` fire. This is the wiring that makes
 * bp_passive_consumption_after_sensory executable; it does NOT add a new policy.
 */
export function evaluateAfterSensoryEvent(
  store: StudyStore,
  input: { sessionId: string; targetId?: string | undefined; eventId?: string | undefined },
): PolicyEvaluationResult {
  return evaluatePolicies(store, {
    sessionId: input.sessionId,
    ...(input.targetId !== undefined ? { targetId: input.targetId } : {}),
    eventType: "sensory_input",
    ...(input.eventId !== undefined ? { triggeringEventId: input.eventId } : {}),
  });
}