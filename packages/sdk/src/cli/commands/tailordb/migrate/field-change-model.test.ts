import { check, examples, spec, verify } from "@toiroakr/chisel/full";
import { describe, expect, test } from "vitest";
import { evaluateFieldChange, fieldChange, fieldChangeRules } from "./field-change-model";
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
  test("chisel reads every branch and every way of the rules, and settles each", async () => {
    const report = await check(
      spec(fieldChange.name, {
        implementation: fieldChangeRules,
        examples: examples(fieldChange, {}),
      }),
    );
    expect(report.modelIssues).toEqual([]);
    expect(report.measures.arms.status).toBe("complete");
    expect(report.measures.rules.status).toBe("complete");
    expect(report.measures.comparisons.status).toBe("complete");
    const rules = report.measures.rules.status === "complete" ? report.measures.rules.rules : [];
    expect(rules.filter((rule) => rule.status === "undecided")).toEqual([]);
  }, 120_000);

  test("every verdict and every guarantee is proved for every input", () => {
    expect(verify(fieldChangeRules).status).toBe("verified");
  }, 60_000);

  // The guarantees are the rules' `ensures`, held on every answer: a relaxation that left the
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
