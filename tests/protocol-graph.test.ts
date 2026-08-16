import assert from "node:assert/strict";
import test from "node:test";
import { CONCEPTUAL_DIALOGUE_V1 } from "../src/protocols/conceptual-dialogue.js";
import type { ProtocolDefinition } from "../src/core/protocol-types.js";

function validateProtocol(protocol: ProtocolDefinition): void {
  const nodeIds = new Set(protocol.nodes.map((n) => n.nodeId));

  assert.ok(nodeIds.has(protocol.entryNodeId), `entry node ${protocol.entryNodeId} must exist`);

  for (const transition of protocol.transitions) {
    assert.ok(
      nodeIds.has(transition.fromNodeId),
      `transition from unknown node ${transition.fromNodeId}`,
    );
    assert.ok(
      nodeIds.has(transition.toNodeId),
      `transition to unknown node ${transition.toNodeId}`,
    );
  }

  const reachable = new Set<string>();
  const queue = [protocol.entryNodeId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (reachable.has(current)) continue;
    reachable.add(current);
    for (const t of protocol.transitions) {
      if (t.fromNodeId === current && !reachable.has(t.toNodeId)) {
        queue.push(t.toNodeId);
      }
    }
  }

  for (const node of protocol.nodes) {
    assert.ok(
      reachable.has(node.nodeId),
      `node ${node.nodeId} is not reachable from entry`,
    );
  }
}

test("conceptual-dialogue v1 graph is valid", () => {
  assert.equal(CONCEPTUAL_DIALOGUE_V1.protocolId, "conceptual-dialogue");
  assert.equal(CONCEPTUAL_DIALOGUE_V1.version, "1");
  assert.equal(CONCEPTUAL_DIALOGUE_V1.nodes.length, 7);
  assert.equal(CONCEPTUAL_DIALOGUE_V1.transitions.length, 6);
  validateProtocol(CONCEPTUAL_DIALOGUE_V1);
});

test("conceptual-dialogue v1 entry node is learner_preview", () => {
  assert.equal(CONCEPTUAL_DIALOGUE_V1.entryNodeId, "learner_preview");
  const entryNode = CONCEPTUAL_DIALOGUE_V1.nodes.find(
    (n) => n.nodeId === "learner_preview",
  );
  assert.ok(entryNode);
  assert.equal(entryNode?.operation, "preview_material");
  assert.equal(entryNode?.executor, "learner");
  assert.equal(entryNode?.maxHelpLevel, "process_only");
});

test("conceptual-dialogue v1 reconstruction node forbids help", () => {
  const reconstructionNode = CONCEPTUAL_DIALOGUE_V1.nodes.find(
    (n) => n.nodeId === "reconstruction",
  );
  assert.ok(reconstructionNode);
  assert.equal(reconstructionNode?.operation, "reconstruct_structure");
  assert.equal(reconstructionNode?.maxHelpLevel, "none");
});

test("conceptual-dialogue v1 all nodes are learner-executed", () => {
  for (const node of CONCEPTUAL_DIALOGUE_V1.nodes) {
    assert.equal(node.executor, "learner", `node ${node.nodeId} must be learner-executed`);
  }
});