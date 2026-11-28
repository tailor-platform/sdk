import { expect, test } from "vitest";
import { t } from "../../configure/types/type";
import { serializeDateFields } from "../../runtime/date";
import { Decimal } from "../../runtime/decimal";
import { parseDecimalFields } from "../../runtime/field-parse";
import { parsedDecimalAtImport } from "./fixtures/parsed-at-import";

interface ValueOfResult<V> {
  issues?: unknown;
  value?: V;
}

function valueOf<V>(result: ValueOfResult<V>): V {
  if (result.issues) throw new Error(`Unexpected issues: ${JSON.stringify(result.issues)}`);
  return result.value as V;
}

test("t.decimal() without `as` parses to Decimal under defaultDecimalRepresentation: decimal", () => {
  const result = t.decimal().parse({ value: "1.5", data: {}, invoker: null });
  expect(Decimal.isDecimal(valueOf(result))).toBe(true);
});

test("the default is in place before the test file's imports evaluate", () => {
  expect(Decimal.isDecimal(valueOf(parsedDecimalAtImport))).toBe(true);
});

test("parseDecimalFields on a field without `as` follows the default, array elements included", () => {
  const payload = t.object({ price: t.decimal(), tiers: t.decimal({ array: true }) });
  const result = valueOf(
    parseDecimalFields(payload, {
      value: { price: "1.5", tiers: ["2.25", "3"] },
      data: {},
      invoker: null,
    }),
  );
  expect(Decimal.isDecimal(result.price)).toBe(true);
  expect(result.tiers.every((tier) => Decimal.isDecimal(tier))).toBe(true);
});

test('an explicit `as: "string"` still yields a string', () => {
  const result = t.decimal({ as: "string" }).parse({ value: "1.5", data: {}, invoker: null });
  expect(valueOf(result)).toBe("1.5");
});

test("serializeDateFields formats a Decimal value of a field without `as` back to a string", () => {
  const output = t.object({ price: t.decimal() });
  expect(serializeDateFields(output, { price: new Decimal("1.5") })).toEqual({ price: "1.5" });
});
