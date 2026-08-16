import type { ProtocolDefinition } from "../core/protocol-types.js";

export const CONCEPTUAL_DIALOGUE_V1: ProtocolDefinition = {
  protocolId: "conceptual-dialogue",
  version: "1",
  name: "Conceptual Dialogue Protocol v1",
  entryNodeId: "learner_preview",
  nodes: [
    {
      nodeId: "learner_preview",
      operation: "preview_material",
      executor: "learner",
      expectedArtifact: "rough_overview",
      maxHelpLevel: "process_only",
      requiredEvidence: ["preview_artifact"],
    },
    {
      nodeId: "learner_questions",
      operation: "formulate_inquiry_questions",
      executor: "learner",
      expectedArtifact: "inquiry_questions",
      maxHelpLevel: "process_only",
      requiredEvidence: ["questions_artifact"],
    },
    {
      nodeId: "learner_grouping",
      operation: "group_elements",
      executor: "learner",
      expectedArtifact: "rough_grouping",
      maxHelpLevel: "process_only",
      requiredEvidence: ["grouping_artifact"],
    },
    {
      nodeId: "learner_relations",
      operation: "propose_relation",
      executor: "learner",
      expectedArtifact: "proposed_relations",
      maxHelpLevel: "content_cue",
      requiredEvidence: ["relations_artifact"],
    },
    {
      nodeId: "reconstruction",
      operation: "reconstruct_structure",
      executor: "learner",
      expectedArtifact: "independent_reconstruction",
      maxHelpLevel: "none",
      requiredEvidence: ["reconstruction_artifact"],
    },
    {
      nodeId: "application",
      operation: "apply_or_transfer",
      executor: "learner",
      expectedArtifact: "application_or_transfer",
      maxHelpLevel: "none",
      requiredEvidence: ["application_artifact"],
    },
    {
      nodeId: "delayed_retrieval",
      operation: "explain_simply",
      executor: "learner",
      expectedArtifact: "delayed_explanation",
      maxHelpLevel: "none",
      requiredEvidence: ["delayed_retrieval_artifact"],
    },
  ],
  transitions: [
    {
      fromNodeId: "learner_preview",
      toNodeId: "learner_questions",
      condition: "preview_artifact_exists",
    },
    {
      fromNodeId: "learner_questions",
      toNodeId: "learner_grouping",
      condition: "inquiry_questions_exist",
    },
    {
      fromNodeId: "learner_grouping",
      toNodeId: "learner_relations",
      condition: "grouping_artifact_exists",
    },
    {
      fromNodeId: "learner_relations",
      toNodeId: "reconstruction",
      condition: "relations_artifact_exists",
    },
    {
      fromNodeId: "reconstruction",
      toNodeId: "application",
      condition: "reconstruction_artifact_exists",
    },
    {
      fromNodeId: "application",
      toNodeId: "delayed_retrieval",
      condition: "application_artifact_exists",
    },
  ],
};