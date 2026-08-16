/**
 * Registry compiler: XML -> ConditionAST -> SQLite-ready policy seeds.
 *
 * Pipeline (per ai-study-engine.md §18):
 *   XML -> parse -> validate structure -> map stable identity ->
 *   convert predicates to ConditionAST -> attach provenance -> validate -> review.
 *
 * HUMAN-REVIEW GATE (rule #3)
 * ---------------------------
 * This module NEVER auto-activates. Two modes:
 *   - "strict" (default): any metric not fully resolvable by the runtime today
 *     (i.e. not mode "ready" in the vocabulary) aborts the whole compile with a
 *     RegistryCompileError. CI uses this to block silent activation.
 *   - "review": metrics classified "reviewable_*" compile to valid ASTs tagged
 *     status:"experimental" (never "active"); metrics classified "blocked"
 *     cannot be expressed and are skipped with a note. The output is a draft
 *     that still requires human review + instrumentation before any activation.
 *
 * The compiler fails CLOSED: an unmapped or unsupported metric is a hard error,
 * never a silently-`uncertain` policy.
 */

import type { Comparison, ConditionAST, SinceAnchor, ValueExpression } from "./condition.js";
import { isSinceAnchor } from "./condition.js";
import type {
  CoreInterventionTemplateSeed,
  CoreParameterSeed,
  CorePolicySeed,
} from "./core-policies.js";
import { attr, childByName, childrenByName, parseXml, type XmlNode } from "./registry-xml.js";
import {
  BEHAVIOR_PRIORITY,
  INTERVENTION_KIND_REDUCTION,
  METRIC_VOCABULARY,
  SEVERITY_RANK,
  type MetricMapping,
} from "./registry-vocabulary.js";

export type CompileMode = "strict" | "review";

export interface CompileNote {
  behaviorId?: string;
  metric?: string;
  status: "blocked" | "reviewable" | "compiled" | "structural";
  reason: string;
  requires?: string[];
}

export class RegistryCompileError extends Error {
  constructor(
    message: string,
    public readonly notes: CompileNote[] = [],
  ) {
    super(message);
    this.name = "RegistryCompileError";
  }
}

export interface CompiledRegistry {
  bundle: { bundleId: string; bundleVersion: number; name: string };
  policies: CorePolicySeed[];
  interventions: CoreInterventionTemplateSeed[];
  parameters: CoreParameterSeed[];
  notes: CompileNote[];
  summary: { behaviors: number; compiled: number; blocked: number; reviewable: number };
}

const SUPPORTED_OPERATORS: ReadonlySet<string> = new Set(["all", "any", "not", "eq", "ne", "gt", "gte", "lt", "lte"]);

function coerceLiteral(value: string): string | number | boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

/** Structural validation independent of the metric vocabulary. */
export function validateStructure(doc: XmlNode): string[] {
  const errors: string[] = [];
  if (doc.tag !== "learning_registry") {
    errors.push(`Root element must be <learning_registry>, got <${doc.tag}>`);
    return errors;
  }
  const behaviors = childrenByName(doc, "behavior_patterns").flatMap((b) => childrenByName(b, "behavior"));
  if (behaviors.length === 0) errors.push("No <behavior> elements found under <behavior_patterns>");

  for (const b of behaviors) {
    const id = attr(b, "id");
    if (!id) {
      errors.push("A <behavior> is missing required id attribute");
      continue;
    }
    const detection = childByName(b, "detection");
    const condition = detection ? childByName(detection, "condition") : undefined;
    if (!condition) {
      errors.push(`Behavior ${id} has no <detection><condition>`);
      continue;
    }
    validateConditionShape(condition, id, errors);
  }
  return errors;
}

function validateConditionShape(node: XmlNode, behaviorId: string, errors: string[]): void {
  const op = attr(node, "operator");
  if (!op || !SUPPORTED_OPERATORS.has(op)) {
    errors.push(`Behavior ${behaviorId}: unsupported operator "${op ?? ""}"`);
  }
  for (const child of node.children) {
    if (child.tag === "condition") {
      validateConditionShape(child, behaviorId, errors);
    } else if (child.tag === "metric") {
      const name = attr(child, "name");
      const operator = attr(child, "operator");
      if (!name) errors.push(`Behavior ${behaviorId}: <metric> missing name`);
      if (!operator || !SUPPORTED_OPERATORS.has(operator)) {
        errors.push(`Behavior ${behaviorId}: <metric${name ? ` name="${name}"` : ""}> unsupported operator "${operator ?? ""}"`);
      }
      if (attr(child, "value") === undefined && attr(child, "parameter_ref") === undefined) {
        errors.push(`Behavior ${behaviorId}: <metric${name ? ` name="${name}"` : ""}> needs value or parameter_ref`);
      }
    }
  }
}

function compileMetric(node: XmlNode, behaviorId: string, mode: CompileMode): ConditionAST {
  const name = attr(node, "name")!;
  const xmlSince = attr(node, "since");
  const mapping: MetricMapping | undefined = METRIC_VOCABULARY[name];
  if (!mapping) {
    throw new RegistryCompileError(
      `Unknown metric "${name}" in ${behaviorId} — no vocabulary entry (human review required).`,
      [{ behaviorId, metric: name, status: "blocked", reason: "No vocabulary entry", requires: ["Add metric to METRIC_VOCABULARY with explicit mapping."] }],
    );
  }
  if (mapping.mode === "blocked") {
    throw new RegistryCompileError(
      `Metric "${name}" in ${behaviorId} requires runtime semantics not yet implemented.`,
      [{ behaviorId, metric: name, status: "blocked", reason: mapping.requires.join("; "), requires: mapping.requires }],
    );
  }
  // review mode still rejects anything not ready; strict rejects reviewable too.
  if (mode === "strict" && mapping.mode !== "ready") {
    throw new RegistryCompileError(
      `Metric "${name}" in ${behaviorId} is not fully resolvable by the runtime today (reviewable only).`,
      [{ behaviorId, metric: name, status: "reviewable", reason: mapping.requires.join("; "), requires: mapping.requires }],
    );
  }
  if (mapping.sinceAnchor && xmlSince && isSinceAnchor(xmlSince) && xmlSince !== mapping.sinceAnchor) {
    throw new RegistryCompileError(
      `Metric "${name}" anchor mismatch in ${behaviorId}: vocabulary says "${mapping.sinceAnchor}", XML says "${xmlSince}".`,
      [{ behaviorId, metric: name, status: "blocked", reason: "anchor mismatch", requires: ["Reconcile registry XML since= with vocabulary sinceAnchor."] }],
    );
  }

  let left: ValueExpression;
  if (mapping.mode === "ready" && mapping.expr) {
    left = mapping.expr;
  } else if (mapping.mode === "reviewable_fact" && mapping.factKey) {
    left = { kind: "fact", key: mapping.factKey };
  } else {
    left = {
      kind: "event_count",
      eventType: mapping.eventType!,
      ...(mapping.windowMs !== undefined ? { windowMs: mapping.windowMs } : {}),
      ...(mapping.sinceAnchor !== undefined ? { sinceAnchor: mapping.sinceAnchor } : {}),
    };
  }

  const paramRef = attr(node, "parameter_ref");
  const right: ValueExpression =
    paramRef !== undefined
      ? { kind: "parameter", id: paramRef }
      : { kind: "literal", value: coerceLiteral(attr(node, "value") ?? "") };

  const cmp = attr(node, "operator") as Comparison;
  return { op: "compare", left, cmp, right };
}

function compileCondition(node: XmlNode, behaviorId: string, mode: CompileMode): ConditionAST {
  if (node.tag === "condition") {
    const op = attr(node, "operator")!;
    if (op === "not") {
      const kids = childrenByName(node, "condition").concat(childrenByName(node, "metric"));
      if (kids.length !== 1) {
        throw new RegistryCompileError(`Behavior ${behaviorId}: operator="not" requires exactly one child`);
      }
      return { op: "not", arg: compileCondition(kids[0]!, behaviorId, mode) };
    }
    const kids = childrenByName(node, "condition").concat(childrenByName(node, "metric"));
    if (op === "all" || op === "any") {
      return { op, args: kids.map((k) => compileCondition(k, behaviorId, mode)) };
    }
    throw new RegistryCompileError(`Behavior ${behaviorId}: unsupported logical operator "${op}"`);
  }
  if (node.tag === "metric") return compileMetric(node, behaviorId, mode);
  throw new RegistryCompileError(`Behavior ${behaviorId}: unexpected node <${node.tag}>`);
}

function compileScope(behavior: XmlNode): Record<string, unknown> {
  const scope = childByName(behavior, "scope");
  if (!scope) return {};
  const out: Record<string, unknown> = {};
  const csv = (s?: string): string[] | undefined => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : undefined);
  const phases = csv(childByName(scope, "phases")?.text);
  if (phases) out.phases = phases;
  const subtypes = csv(childByName(scope, "sensory_subtypes")?.text);
  if (subtypes) out.sensory_subtypes = subtypes;
  const help = csv(childByName(scope, "help_levels")?.text);
  if (help) out.help_levels = help;
  const tw = childByName(scope, "time_window")?.text;
  if (tw) out.time_window = tw;
  return out;
}

function evidenceSourceIds(behavior: XmlNode): string[] {
  const refs = childByName(behavior, "evidence_refs");
  if (!refs) return [];
  return childrenByName(refs, "evidence_ref")
    .map((r) => r.text?.trim())
    .filter((x): x is string => !!x);
}

function compileBehavior(behavior: XmlNode, mode: CompileMode): CorePolicySeed {
  const id = attr(behavior, "id")!;
  const title = childByName(behavior, "title")?.text ?? id;
  const detection = childByName(behavior, "detection")!;
  const conditionNode = childByName(detection, "condition")!;
  const condition = compileCondition(conditionNode, id, mode);

  const severityRaw = childByName(behavior, "severity")?.text ?? "warning";
  const severity = SEVERITY_RANK[severityRaw] ?? 1;

  const interventionRefs = childByName(behavior, "intervention_refs");
  const interventionId = interventionRefs ? childByName(interventionRefs, "intervention_ref")?.text?.trim() : undefined;

  return {
    policyId: id,
    version: 1,
    name: title,
    scope: compileScope(behavior),
    condition,
    exclusions: [],
    priority: BEHAVIOR_PRIORITY[id] ?? 50,
    severity,
    cooldownMs: null,
    interventionTemplateId: interventionId ?? "it_procedural_attempt",
    interventionTemplateVersion: 1,
    provenance: {
      kind: "PRODUCT_DECISION",
      sourceIds: evidenceSourceIds(behavior),
      note: `registry import v1.1 (${id})`,
    },
    status: "experimental",
  };
}

function compileInterventions(registry: XmlNode): { seeds: CoreInterventionTemplateSeed[]; notes: CompileNote[] } {
  const notes: CompileNote[] = [];
  const seeds = childrenByName(registry, "interventions")
    .flatMap((g) => childrenByName(g, "intervention"))
    .map((node): CoreInterventionTemplateSeed => {
      const id = attr(node, "id")!;
      const type = attr(node, "type") ?? "process_only";
      const kind = INTERVENTION_KIND_REDUCTION[type] ?? "process_only";
      if (!(type in INTERVENTION_KIND_REDUCTION)) {
        notes.push({
          behaviorId: id,
          status: "reviewable",
          reason: `Intervention type "${type}" is not in the runtime kind enum; reduced to process_only.`,
        });
      }
      return {
        id,
        version: 1,
        name: childByName(node, "title")?.text ?? id,
        kind,
        content: { text: childByName(node, "message")?.text ?? "" },
        provenance: { kind: "PRODUCT_DECISION", sourceIds: [] },
        status: "experimental",
      };
    });
  return { seeds, notes };
}

function compileParameters(registry: XmlNode): CoreParameterSeed[] {
  return childrenByName(registry, "policy_parameters")
    .flatMap((g) => childrenByName(g, "parameter"))
    .map((node): CoreParameterSeed => {
      const id = attr(node, "id")!;
      const raw = attr(node, "default") ?? "0";
      const value = /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw;
      return {
        parameterId: id,
        version: 1,
        name: id,
        value,
        scope: {},
        provenance: {
          kind: "EXPERIMENTAL",
          sourceIds: [],
          note: "Experimental default from registry v1.1 — requires empirical tuning.",
        },
        status: "experimental",
      };
    });
}

export function compileRegistry(xml: string, opts: { mode?: CompileMode } = {}): CompiledRegistry {
  const mode: CompileMode = opts.mode ?? "strict";
  const doc = parseXml(xml);

  const structuralErrors = validateStructure(doc);
  if (structuralErrors.length) {
    throw new RegistryCompileError("Structural validation failed", structuralErrors.map((reason) => ({ status: "structural", reason })));
  }

  const behaviorNodes = childrenByName(doc, "behavior_patterns").flatMap((b) => childrenByName(b, "behavior"));

  const policies: CorePolicySeed[] = [];
  const notes: CompileNote[] = [];
  let blocked = 0;
  let reviewable = 0;

  for (const b of behaviorNodes) {
    const id = attr(b, "id")!;
    try {
      policies.push(compileBehavior(b, mode));
      notes.push({ behaviorId: id, status: "compiled", reason: "Compiled as experimental; requires human activation." });
      reviewable++;
    } catch (err) {
      if (err instanceof RegistryCompileError) {
        blocked++;
        notes.push(...err.notes);
      } else {
        throw err;
      }
    }
  }

  if (mode === "strict" && blocked > 0) {
    throw new RegistryCompileError(
      `Strict mode rejected ${blocked} behavior(s): metrics require instrumentation or a human-reviewed mapping before activation.`,
      notes,
    );
  }

  const { seeds: interventions, notes: interventionNotes } = compileInterventions(doc);
  const parameters = compileParameters(doc);
  notes.push(...interventionNotes);

  const version = attr(doc, "version") ?? "1.1";
  return {
    bundle: { bundleId: "registry-antipatterns", bundleVersion: 1, name: `Studying antipatterns registry v${version}` },
    policies,
    interventions,
    parameters,
    notes,
    summary: { behaviors: behaviorNodes.length, compiled: policies.length, blocked, reviewable },
  };
}
