import { createHash } from "node:crypto";
import type { JsonValue } from "./types.js";

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function stableStringify(value: JsonValue): string {
  return JSON.stringify(value, (_key, current) => {
    if (current === undefined) return null;
    if (!current || typeof current !== "object" || Array.isArray(current)) return current;
    const source = current as Record<string, JsonValue>;
    return Object.keys(source)
      .sort()
      .reduce<Record<string, JsonValue>>((acc, key) => {
        acc[key] = source[key] as JsonValue;
        return acc;
      }, {});
  });
}

export function contentHash(value: string): string {
  return sha256Hex(value);
}
