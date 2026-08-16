import type { HelpLevel, OperationKind } from "./provenance-operations.js";
import type { ProtocolDefinition, ProtocolNode } from "./protocol-types.js";

export interface ProtocolMove {
  readonly nodeId: string;
  readonly operation: OperationKind;
  readonly executor: "learner" | "ai" | "shared";
  readonly expectedArtifact: string;
  readonly maxHelpLevel: HelpLevel;
  readonly instruction: string;
}

const OPERATION_INSTRUCTIONS: Record<string, string> = {
  preview_material:
    "Просмотри структуру материала. Выдели крупные части и запиши, что кажется непонятным. Не изучай подробно.",
  formulate_inquiry_questions:
    "Сформулируй 2–4 вопроса, которые помогут понять устройство темы. Не ищи ответы пока.",
  group_elements:
    "Самостоятельно объедини ключевые термины в смысловые группы. Назови каждую группу и объясни принцип группировки.",
  propose_relation:
    "Предложи связи между группами. Объясни, почему каждая связь существует.",
  reconstruct_structure:
    "Закрой источник и карту. Объясни тему с нуля, своими словами, без подсказок.",
  apply_or_transfer:
    "Примени идею в новом контексте или приведи собственный пример.",
  explain_simply:
    "Объясни концепт простыми словами, как будто объясняешь новичку.",
};

export function getCurrentNodeId(
  protocol: ProtocolDefinition,
  completedArtifacts: readonly string[],
): string | undefined {
  const completedSet = new Set(completedArtifacts);
  const transitionMap = new Map<string, string>();
  for (const t of protocol.transitions) {
    if (!transitionMap.has(t.fromNodeId)) {
      transitionMap.set(t.fromNodeId, t.toNodeId);
    }
  }

  const visited = new Set<string>();
  let currentNodeId: string | undefined = protocol.entryNodeId;

  while (currentNodeId && !visited.has(currentNodeId)) {
    visited.add(currentNodeId);
    const node = protocol.nodes.find((n) => n.nodeId === currentNodeId);
    if (!node) return undefined;

    const isComplete = node.requiredEvidence.every((ev) => completedSet.has(ev));
    if (!isComplete) {
      return currentNodeId;
    }

    currentNodeId = transitionMap.get(currentNodeId);
  }

  return undefined;
}

export function isProtocolComplete(
  protocol: ProtocolDefinition,
  completedArtifacts: readonly string[],
): boolean {
  return getCurrentNodeId(protocol, completedArtifacts) === undefined;
}

export function nextMove(
  protocol: ProtocolDefinition,
  completedArtifacts: readonly string[],
): ProtocolMove | undefined {
  const nodeId = getCurrentNodeId(protocol, completedArtifacts);
  if (!nodeId) return undefined;

  const node = protocol.nodes.find((n) => n.nodeId === nodeId);
  if (!node) return undefined;

  const instruction =
    OPERATION_INSTRUCTIONS[node.operation] ??
    `Выполни операцию: ${node.operation}`;

  return {
    nodeId: node.nodeId,
    operation: node.operation,
    executor: node.executor,
    expectedArtifact: node.expectedArtifact,
    maxHelpLevel: node.maxHelpLevel,
    instruction,
  };
}