import { describe, expect, test } from "vitest";
import { areNormalizedEqual, normalizeProtoConfig, stableStringify } from "./compare";

describe("compare policy", () => {
  // Generic compare preserves type distinctions.
  // Proto-specific representation gaps such as bigint vs number should be normalized
  // by each resource before reaching this helper.
  test("preserves bigint as distinct from number", () => {
    expect(stableStringify(1n)).toBe('"1"');
    expect(stableStringify(1)).toBe("1");
    expect(areNormalizedEqual({ seconds: 1n }, { seconds: 1 })).toBe(false);
  });

  test("normalizeProtoConfig keeps bigint-backed values as strings after round-trip", () => {
    expect(normalizeProtoConfig({ seconds: 1n })).toEqual({ seconds: "1" });
    expect(normalizeProtoConfig({ seconds: 1 })).toEqual({ seconds: 1 });
  });
});
