import type { ContaminationStatus, HelpLevel } from "./provenance-operations.js";
import type { ProtocolMove } from "./protocol-executor.js";

export interface EnforcementResult {
  readonly move: ProtocolMove;
  readonly contaminationBlocked: boolean;
  readonly enforcedHelpLevel: HelpLevel;
}

export function enforceProvenance(
  move: ProtocolMove,
  contaminationStatus: ContaminationStatus | undefined,
): EnforcementResult {
  if (contaminationStatus === "contaminated") {
    return {
      move: {
        nodeId: move.nodeId,
        operation: move.operation,
        executor: move.executor,
        expectedArtifact: move.expectedArtifact,
        maxHelpLevel: "none",
        instruction:
          "Этот target был загрязнён через structure_reveal. Закрой подсказку. Реконструируй тему с нуля, своими словами, без подсказок.",
      },
      contaminationBlocked: true,
      enforcedHelpLevel: "none",
    };
  }

  return {
    move,
    contaminationBlocked: false,
    enforcedHelpLevel: move.maxHelpLevel,
  };
}