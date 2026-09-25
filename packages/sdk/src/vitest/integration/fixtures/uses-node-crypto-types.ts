import type { BinaryLike } from "node:crypto";

/**
 * Type-only import from node:crypto (should NOT be blocked because it is erased at compile time).
 * @param data - Input data
 * @returns A trivial digest derived from the input length
 */
export function fakeHash(data: BinaryLike): number {
  if (typeof data === "string") return data.length;
  if (data instanceof ArrayBuffer) return data.byteLength;
  return (data as { byteLength: number }).byteLength;
}
