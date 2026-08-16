export type DetectionResult = "matched" | "not_matched" | "uncertain";
export type Comparison = "eq" | "ne" | "gt" | "gte" | "lt" | "lte";

/**
 * Fixed set of temporal anchors for `event_count`. Per task scope these are the
 * ONLY permitted anchors — no arbitrary strings, no SQL-like predicates.
 */
export type SinceAnchor =
  | "last_independent_attempt"
  | "last_sensory_input"
  | "last_contamination_event"
  | "phase_start";

export function isSinceAnchor(value: string): value is SinceAnchor {
  return (
    value === "last_independent_attempt" ||
    value === "last_sensory_input" ||
    value === "last_contamination_event" ||
    value === "phase_start"
  );
}

export type ValueExpression =
  | { kind: "literal"; value: string | number | boolean | null }
  | { kind: "fact"; key: string }
  | { kind: "parameter"; id: string }
  | { kind: "event_count"; eventType: string; windowMs?: number; targetId?: string; sinceAnchor?: SinceAnchor };

export type ConditionAST =
  | { op: "const"; value: boolean }
  | { op: "all"; args: ConditionAST[] }
  | { op: "any"; args: ConditionAST[] }
  | { op: "not"; arg: ConditionAST }
  | { op: "compare"; left: ValueExpression; cmp: Comparison; right: ValueExpression };

export interface ValueResolution {
  known: boolean;
  value?: string | number | boolean | null;
  detail: string;
}

export interface ConditionTrace {
  op: string;
  result: DetectionResult;
  detail?: string;
  actual?: unknown;
  expected?: unknown;
  children?: ConditionTrace[];
}

export interface EvaluationContext {
  facts: Readonly<Record<string, string | number | boolean | null | undefined>>;
  parameters: Readonly<Record<string, string | number | boolean | null | undefined>>;
  eventCount(query: { eventType: string; windowMs?: number; targetId?: string; sinceAnchor?: SinceAnchor }): number | undefined;
}

export interface ConditionEvaluation {
  result: DetectionResult;
  trace: ConditionTrace;
}

function resolveValue(expression: ValueExpression, context: EvaluationContext): ValueResolution {
  if (expression.kind === "literal") {
    return { known: true, value: expression.value, detail: "literal" };
  }
  if (expression.kind === "fact") {
    const value = context.facts[expression.key];
    return value === undefined
      ? { known: false, detail: `fact ${expression.key} is unknown` }
      : { known: true, value, detail: `fact ${expression.key}` };
  }
  if (expression.kind === "parameter") {
    const value = context.parameters[expression.id];
    return value === undefined
      ? { known: false, detail: `parameter ${expression.id} is missing` }
      : { known: true, value, detail: `parameter ${expression.id}` };
  }
  const query: { eventType: string; windowMs?: number; targetId?: string; sinceAnchor?: SinceAnchor } = {
    eventType: expression.eventType,
  };
  if (expression.windowMs !== undefined) query.windowMs = expression.windowMs;
  if (expression.targetId !== undefined) query.targetId = expression.targetId;
  if (expression.sinceAnchor !== undefined) query.sinceAnchor = expression.sinceAnchor;
  const value = context.eventCount(query);
  return value === undefined
    ? { known: false, detail: `event coverage for ${expression.eventType} is unknown` }
    : { known: true, value, detail: `count of ${expression.eventType}` };
}

function compareValues(left: ValueResolution, cmp: Comparison, right: ValueResolution): boolean | undefined {
  if (!left.known || !right.known) return undefined;
  const a = left.value;
  const b = right.value;
  if (cmp === "eq") return a === b;
  if (cmp === "ne") return a !== b;
  if (typeof a === "number" && typeof b === "number") {
    if (cmp === "gt") return a > b;
    if (cmp === "gte") return a >= b;
    if (cmp === "lt") return a < b;
    return a <= b;
  }
  if (typeof a === "string" && typeof b === "string") {
    if (cmp === "gt") return a > b;
    if (cmp === "gte") return a >= b;
    if (cmp === "lt") return a < b;
    return a <= b;
  }
  return undefined;
}

function invert(result: DetectionResult): DetectionResult {
  if (result === "matched") return "not_matched";
  if (result === "not_matched") return "matched";
  return "uncertain";
}

export function evaluateCondition(condition: ConditionAST, context: EvaluationContext): ConditionEvaluation {
  if (condition.op === "const") {
    const result = condition.value ? "matched" : "not_matched";
    return { result, trace: { op: "const", result, actual: condition.value } };
  }

  if (condition.op === "not") {
    const child = evaluateCondition(condition.arg, context);
    const result = invert(child.result);
    return { result, trace: { op: "not", result, children: [child.trace] } };
  }

  if (condition.op === "all" || condition.op === "any") {
    const children = condition.args.map((arg) => evaluateCondition(arg, context));
    let result: DetectionResult;
    if (condition.op === "all") {
      result = children.some((child) => child.result === "not_matched")
        ? "not_matched"
        : children.some((child) => child.result === "uncertain")
          ? "uncertain"
          : "matched";
    } else {
      result = children.some((child) => child.result === "matched")
        ? "matched"
        : children.some((child) => child.result === "uncertain")
          ? "uncertain"
          : "not_matched";
    }
    return { result, trace: { op: condition.op, result, children: children.map((child) => child.trace) } };
  }

  const left = resolveValue(condition.left, context);
  const right = resolveValue(condition.right, context);
  const compared = compareValues(left, condition.cmp, right);
  const result: DetectionResult = compared === undefined ? "uncertain" : compared ? "matched" : "not_matched";
  return {
    result,
    trace: {
      op: `compare:${condition.cmp}`,
      result,
      detail: `${left.detail}; ${right.detail}`,
      ...(left.known ? { actual: left.value } : {}),
      ...(right.known ? { expected: right.value } : {}),
    },
  };
}
