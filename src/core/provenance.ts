export const PROVENANCE_KINDS = [
  "SUNG_DIRECT",
  "SUNG_INFERRED",
  "LOCAL_PROTOCOL",
  "PRODUCT_DECISION",
  "EXPERIMENTAL",
  "USER_PREFERENCE",
] as const;

export type ProvenanceKind = (typeof PROVENANCE_KINDS)[number];

export interface Provenance {
  kind: ProvenanceKind;
  sourceIds: string[];
  note?: string;
  policyVersion?: string;
}

export function assertProvenance(value: Provenance): void {
  if (!PROVENANCE_KINDS.includes(value.kind)) {
    throw new Error(`Unknown provenance kind: ${String(value.kind)}`);
  }
  if (value.kind === "SUNG_DIRECT" && value.sourceIds.length === 0) {
    throw new Error("SUNG_DIRECT provenance requires at least one primary source");
  }
}
