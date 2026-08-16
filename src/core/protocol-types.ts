import type { HelpLevel, OperationKind } from "./provenance-operations.js";

export interface ProtocolNode {
  readonly nodeId: string;
  readonly operation: OperationKind;
  readonly executor: "learner" | "ai" | "shared";
  readonly expectedArtifact: string;
  readonly maxHelpLevel: HelpLevel;
  readonly requiredEvidence: readonly string[];
}

export interface ProtocolTransition {
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly condition: string;
}

export interface ProtocolDefinition {
  readonly protocolId: string;
  readonly version: string;
  readonly name: string;
  readonly nodes: readonly ProtocolNode[];
  readonly transitions: readonly ProtocolTransition[];
  readonly entryNodeId: string;
}