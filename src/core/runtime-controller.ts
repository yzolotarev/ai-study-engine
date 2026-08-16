import type { StudyStore } from "../db/store.js";
import { CONCEPTUAL_DIALOGUE_V1 } from "../protocols/conceptual-dialogue.js";
import { nextMove } from "./protocol-executor.js";

export type RuntimeActionType =
  | "capture_canvas"
  | "confirm_canvas"
  | "protocol_move"
  | "review"
  | "remediate"
  | "complete_session";

export interface RuntimeAction {
  kind: RuntimeActionType;
  state: string;
  action: string;
  learnerArtifact: string;
  aiBoundary: string;
  evidenceNeeded: string[];
  rationale: string;
}

export interface SelectNextInput {
  sessionId: string;
  protocolId?: string;
  protocolVersion?: string;
}

const OPERATION_STATE: Record<string, { state: string; artifact: string }> = {
  preview_material: { state: "PRIME_L1", artifact: "rough_overview" },
  formulate_inquiry_questions: { state: "AIM", artifact: "inquiry_questions" },
  group_elements: { state: "AIM", artifact: "rough_grouping" },
  propose_relation: { state: "SKIN", artifact: "proposed_relations" },
  reconstruct_structure: { state: "RETRIEVE", artifact: "independent_reconstruction" },
  apply_or_transfer: { state: "INTERLEAVE", artifact: "application_or_transfer" },
  explain_simply: { state: "DELAY", artifact: "delayed_explanation" },
};

/**
 * The runtime controller is the SINGLE source of truth for the next action.
 * It never trusts caller-supplied completion: evidence is read from SQLite
 * (store.getValidProtocolEvidence), and the next move is computed by the
 * protocol executor over that persisted evidence.
 */
export function selectNextAction(store: StudyStore, input: SelectNextInput): RuntimeAction | null {
  const session = store.getSession(input.sessionId);
  if (!session) return null;

  const canvas = store.getLatestCanvasArtifact(input.sessionId);
  if (!canvas) {
    return {
      kind: "capture_canvas",
      state: session.currentState,
      action: "Capture the tldraw board via Capture Core + Gemma transcription.",
      learnerArtifact: "A produced capture run (non-canonical).",
      aiBoundary: "Transcription is non-canonical, non-learner-owned; AI cannot interpret for the learner.",
      evidenceNeeded: [],
      rationale: "Capture must precede interpretation.",
    };
  }

  const completed = store.getValidProtocolEvidence(input.sessionId);
  const move = nextMove(CONCEPTUAL_DIALOGUE_V1, completed);
  if (move) {
    const mapping = OPERATION_STATE[move.operation] ?? {
      state: session.currentState,
      artifact: move.expectedArtifact,
    };
    const node = CONCEPTUAL_DIALOGUE_V1.nodes.find((n) => n.nodeId === move.nodeId);
    return {
      kind: "protocol_move",
      state: mapping.state,
      action: move.instruction,
      learnerArtifact: mapping.artifact,
      aiBoundary: "AI transcribes the canvas and scaffolds; it does not own the structure or close gaps.",
      evidenceNeeded: node ? [...node.requiredEvidence] : [],
      rationale: "Next required protocol node derived from DB-persisted evidence.",
    };
  }

  const targets = store.getTargetEvidenceStates(input.sessionId);
  const open = targets.filter((t) => t.readiness !== "stable" || t.ownershipStatus !== "verified_owned");
  if (open.length > 0) {
    return {
      kind: "remediate",
      state: "REMEDIATE",
      action: "Reattempt the target(s) that are not yet stable/verified.",
      learnerArtifact: "An independent reattempt.",
      aiBoundary: "Use the minimum sufficient help; record any contamination.",
      evidenceNeeded: [],
      rationale: `${open.length} target(s) not yet stable/verified.`,
    };
  }

  const due = store.getDueReviewItems(input.sessionId, new Date().toISOString());
  if (due.length > 0) {
    return {
      kind: "review",
      state: "DELAY",
      action: "Run the scheduled spaced review.",
      learnerArtifact: "A delayed retrieval attempt.",
      aiBoundary: "Review only; do not re-teach.",
      evidenceNeeded: [],
      rationale: "Review window is open.",
    };
  }

  return {
    kind: "complete_session",
    state: "COMPLETE",
    action: "Session target met; keep remaining uncertainty auditable.",
    learnerArtifact: "Demonstrated outcome plus explicit open gaps.",
    aiBoundary: "AI must not erase uncertainty or claim unsupported acceleration.",
    evidenceNeeded: [],
    rationale: "All targets stable/verified and no due reviews.",
  };
}
