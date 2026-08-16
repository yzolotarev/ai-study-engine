export interface ArtifactAssessment {
  readonly artifactId: string;
  readonly protocolNodeId: string;
  readonly score: number;
  readonly maxScore: number;
  readonly passed: boolean;
  readonly feedback: readonly string[];
  readonly evidenceTypes: readonly string[];
}

export interface AssessmentCriteria {
  readonly protocolNodeId: string;
  readonly requiredElements: readonly string[];
  readonly minScore: number;
  readonly maxScore: number;
}

const RUBRICS: Record<string, AssessmentCriteria> = {
  learner_preview: {
    protocolNodeId: "learner_preview",
    requiredElements: ["structure_overview", "key_areas", "uncertainty_zones"],
    minScore: 2,
    maxScore: 3,
  },
  learner_questions: {
    protocolNodeId: "learner_questions",
    requiredElements: ["inquiry_questions", "question_count"],
    minScore: 2,
    maxScore: 3,
  },
  learner_grouping: {
    protocolNodeId: "learner_grouping",
    requiredElements: ["groups", "group_names", "grouping_principle"],
    minScore: 2,
    maxScore: 3,
  },
  learner_relations: {
    protocolNodeId: "learner_relations",
    requiredElements: ["relations", "relation_justifications"],
    minScore: 2,
    maxScore: 3,
  },
  reconstruction: {
    protocolNodeId: "reconstruction",
    requiredElements: ["independent_explanation", "no_source_reference", "causal_links"],
    minScore: 2,
    maxScore: 3,
  },
  application: {
    protocolNodeId: "application",
    requiredElements: ["new_context", "own_example"],
    minScore: 2,
    maxScore: 2,
  },
  delayed_retrieval: {
    protocolNodeId: "delayed_retrieval",
    requiredElements: ["delayed_explanation", "varied_cue_response"],
    minScore: 2,
    maxScore: 2,
  },
};

export function assessArtifact(artifact: {
  artifactId: string;
  protocolNodeId: string;
  content: Record<string, unknown>;
}): ArtifactAssessment {
  const rubric = RUBRICS[artifact.protocolNodeId];
  if (!rubric) {
    return {
      artifactId: artifact.artifactId,
      protocolNodeId: artifact.protocolNodeId,
      score: 0,
      maxScore: 0,
      passed: false,
      feedback: [`No rubric defined for protocol node: ${artifact.protocolNodeId}`],
      evidenceTypes: [],
    };
  }

  const presentElements: string[] = [];
  const missingElements: string[] = [];

  for (const element of rubric.requiredElements) {
    const value = artifact.content[element];
    if (value !== undefined && value !== null && value !== "") {
      presentElements.push(element);
    } else {
      missingElements.push(element);
    }
  }

  const score = presentElements.length;
  const passed = score >= rubric.minScore;

  const feedback: string[] = [];
  if (missingElements.length > 0) {
    feedback.push(`Missing elements: ${missingElements.join(", ")}`);
  }
  if (passed) {
    feedback.push("Artifact meets minimum requirements for this protocol node.");
  } else {
    feedback.push(`Score ${score}/${rubric.maxScore} is below minimum ${rubric.minScore}.`);
  }

  return {
    artifactId: artifact.artifactId,
    protocolNodeId: artifact.protocolNodeId,
    score,
    maxScore: rubric.maxScore,
    passed,
    feedback,
    evidenceTypes: presentElements,
  };
}