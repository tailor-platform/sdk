import { create } from "@bufbuild/protobuf";
import { TailorDBTypeSchema } from "@tailor-platform/tailor-proto/tailordb_resource_pb";
import { describe, expect, test } from "vitest";
import {
  areNormalizedEqual,
  normalizeProtoConfig,
  stableStringify,
  toComparableProtoJson,
} from "./compare";

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

  test("toComparableProtoJson equates an init shape with its materialized message", () => {
    const init = {
      name: "Invoice",
      schema: { fields: { code: { type: "string", required: true } } },
    };
    // Deserialized messages materialize implicit proto3 fields (e.g. bools
    // added to the proto later) with zero values that the init shape omits.
    // optionalOnCreate is deliberately named as the canary: it is a field the
    // SDK never sets, so it proves materialization happens.
    const materialized = create(TailorDBTypeSchema, init);
    expect(materialized.schema?.fields.code?.optionalOnCreate).toBe(false);

    expect(
      areNormalizedEqual(
        toComparableProtoJson(TailorDBTypeSchema, init),
        toComparableProtoJson(TailorDBTypeSchema, materialized),
      ),
    ).toBe(true);
  });
});
