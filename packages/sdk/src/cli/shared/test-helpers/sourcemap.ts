import { originalPositionFor, type TraceMap } from "@jridgewell/trace-mapping";
import { assertDefined } from "#/utils/assert";

/**
 * Resolve a generated character offset to its original source position.
 * @param map - Bundle sourcemap
 * @param code - Generated bundle
 * @param offset - Character offset in the bundle
 * @returns Original source position
 */
export function originalPositionAt(map: TraceMap, code: string, offset: number) {
  const lines = code.slice(0, offset).split("\n");
  return originalPositionFor(map, {
    line: lines.length,
    column: assertDefined(lines.at(-1), "generated line missing").length,
  });
}
