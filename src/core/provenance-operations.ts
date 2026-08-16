export const OPERATION_KINDS = [
  "formulate_goal",
  "choose_target_task",
  "define_success_criteria",
  "preview_material",
  "identify_key_terms",
  "activate_prior_knowledge",
  "request_layman_explanation",
  "formulate_inquiry_questions",
  "hypothesize_structure",
  "build_rough_map",
  "select_scope",
  "group_elements",
  "chunk_elements",
  "propose_relation",
  "justify_relation",
  "prioritize",
  "choose_order",
  "explain_simply",
  "reconstruct_structure",
  "apply_or_transfer",
  "compare_models",
  "sustain_dialogue",
  "self_report_confusion",
  "self_report_passivity",
  "request_help",
  "dispute_assessment",
] as const;

export type OperationKind = (typeof OPERATION_KINDS)[number];

export const HELP_LEVELS = [
  "none",
  "process_only",
  "familiarity",
  "content_cue",
  "partial_step",
  "structure_reveal",
  "direct_answer",
  "full_solution",
] as const;

export type HelpLevel = (typeof HELP_LEVELS)[number];

export const CONTAMINATION_STATUSES = [
  "clean",
  "familiarity_only",
  "assisted",
  "contaminated",
  "provisional_owned",
  "verified_owned",
  "disputed",
  "unknown",
] as const;

export type ContaminationStatus = (typeof CONTAMINATION_STATUSES)[number];

export const OPERATION_AUTHORS = ["learner", "ai", "source", "shared"] as const;

export type OperationAuthor = (typeof OPERATION_AUTHORS)[number];

export const CONTAMINATION_SCOPES = [
  "target",
  "relation",
  "group",
  "priority",
  "explanation",
  "question",
] as const;

export type ContaminationScope = (typeof CONTAMINATION_SCOPES)[number];

export const CONFIDENCE_LEVELS = ["high", "medium", "low", "uncertain"] as const;

export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

export interface OperationProvenance {
  readonly target: string;
  readonly operation: OperationKind;
  readonly author: OperationAuthor;
  readonly helpLevel: HelpLevel;
  readonly answerVisible: boolean;
  readonly cueVaried: boolean;
  readonly attemptIndependent: boolean;
  readonly contaminationScope: ContaminationScope;
  readonly evidenceId?: string;
  readonly confidence: ConfidenceLevel;
  readonly status: ContaminationStatus;
  readonly occurredAt: string;
}

export interface ContaminationRecord {
  readonly recordId: string;
  readonly target: string;
  readonly scope: ContaminationScope;
  readonly status: ContaminationStatus;
  readonly contaminatingHelpLevel: HelpLevel;
  readonly contaminatingArtifactId?: string;
  readonly openedAt: string;
  readonly closedAt?: string;
  readonly closureMethod?:
    | "independent_reconstruction"
    | "varied_application"
    | "delayed_retrieval"
    | "disputed"
    | "reopened";
}

export function isHelpLevelContaminating(level: HelpLevel): boolean {
  return (
    level === "structure_reveal" ||
    level === "direct_answer" ||
    level === "full_solution"
  );
}

export function helpLevelAllowsMastery(level: HelpLevel): boolean {
  return level === "none" || level === "process_only";
}