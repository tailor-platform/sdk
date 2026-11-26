import { check, examples, spec, verify } from "@toiroakr/chisel/full";
import { describe, expect, test } from "vitest";
import { evaluateFieldChange, FIELD_CHANGE_CONCERNS } from "./field-change-model";
import type { SnapshotFieldConfig } from "./snapshot-types";

function* fields(): Generator<SnapshotFieldConfig> {
  for (const type of ["string", "enum"])
    for (const required of [false, true])
      for (const unique of [false, true])
        for (const foreignKey of [undefined, "A", "A.code", "B"])
          for (const values of [["x"], ["x", "y"]]) {
            const [foreignKeyType, foreignKeyField] = foreignKey?.split(".") ?? [];
            yield {
              type,
              required,
              unique,
              ...(foreignKeyType && { foreignKey: true, foreignKeyType }),
              ...(foreignKeyField && { foreignKeyField }),
              ...(type === "enum" && { allowedValues: values.map((value) => ({ value })) }),
            };
          }
}

describe("field change rules", () => {
  test("every concern's branches and comparisons are read by chisel", async () => {
    for (const implementation of FIELD_CHANGE_CONCERNS) {
      const report = await check(
        spec(implementation.behavior.name, {
          implementation,
          examples: examples(implementation.behavior, {}),
        }),
      );
      expect(report.modelIssues).toEqual([]);
      expect(report.measures.arms.status).toBe("complete");
      expect(report.measures.rules.status).toBe("complete");
      expect(report.measures.comparisons.status).toBe("complete");
    }
  }, 120_000);

  test("the verdicts without a guarantee of their own are proved for every input", () => {
    const proved = FIELD_CHANGE_CONCERNS.filter(
      (implementation) => verify(implementation).status === "verified",
    ).map((implementation) => implementation.behavior.name);
    expect(proved).toEqual([
      "a field changes its type",
      "a field changes between one value and an array",
      "a decimal field changes its scale",
    ]);
  }, 60_000);

  // The guarantees are each concern's `ensures`, held on every answer: a relaxation that left the
  // Pre-phase stricter than the stored rows would throw here.
  test("the Pre-phase keeps every stored row for every pair of these fields", () => {
    const all = [...fields()];
    for (const before of [undefined, ...all])
      for (const after of all)
        for (const nestedMember of [false, true])
          expect(() =>
            evaluateFieldChange({
              before,
              after,
              nestedMember,
              typeRenameTargets: new Map([["A", "B"]]),
            }),
          ).not.toThrow();
  }, 60_000);
});
