import { Decimal } from "decimal.js";
import { describe, expect, expectTypeOf, test } from "vitest";
import { t } from "#/configure/types/type";
import { serializeDateFields } from "./date";
import { parseDateFields, parseDecimalFields, parseInputFields } from "./field-parse";
import type { DeepReadonly, output, SerializeDates } from "#/types/helpers";

describe("as: decimal", () => {
  test("infers Decimal only when the field selects it", () => {
    const fields = t.object({
      plain: t.decimal(),
      string: t.decimal({ as: "string" }),
      decimal: t.decimal({ as: "decimal" }),
      list: t.decimal({ as: "decimal", array: true, optional: true }),
    });
    expectTypeOf<output<typeof fields>>().toEqualTypeOf<{
      plain: string;
      string: string;
      decimal: Decimal;
      list?: Decimal[] | null;
    }>();
    expectTypeOf<DeepReadonly<output<typeof fields>>["decimal"]>().toEqualTypeOf<Decimal>();
    expectTypeOf<SerializeDates<output<typeof fields>>["decimal"]>().toEqualTypeOf<string>();
  });

  test("converts a decimal string to Decimal while parsing", () => {
    const result = parseInputFields({
      fields: { price: t.decimal({ as: "decimal" }) },
      value: { price: "12.340" },
      data: undefined,
      invoker: null,
    });
    expect(result).not.toHaveProperty("issues");
    const { price } = (result as { value: { price: Decimal } }).value;
    expect(Decimal.isDecimal(price)).toBe(true);
    expect(price.toFixed()).toBe("12.34");
  });

  test("keeps a plain decimal field as a string", () => {
    const result = parseInputFields({
      fields: { price: t.decimal() },
      value: { price: "12.340" },
      data: undefined,
      invoker: null,
    });
    expect(result).toEqual({ value: { price: "12.340" } });
  });

  test("still rejects text that is not a decimal", () => {
    const result = parseInputFields({
      fields: { price: t.decimal({ as: "decimal" }) },
      value: { price: "abc" },
      data: undefined,
      invoker: null,
    });
    expect(result).toEqual({
      issues: [{ message: "Expected a decimal string: received abc", path: ["price"] }],
    });
  });

  test("serializes Decimal to a plain notation string, never an exponent", () => {
    const field = t.object({ price: t.decimal({ as: "decimal" }) });
    expect(serializeDateFields(field, { price: new Decimal("1e-7") })).toEqual({
      price: "0.0000001",
    });
    expect(serializeDateFields(field, { price: new Decimal("1e+21") })).toEqual({
      price: "1000000000000000000000",
    });
  });

  test("rejects a value that is not a finite Decimal when serializing", () => {
    const field = t.object({ price: t.decimal({ as: "decimal" }) });
    expect(() => serializeDateFields(field, { price: "1.5" })).toThrow(
      /Expected a Decimal instance at price/,
    );
    expect(() => serializeDateFields(field, { price: new Decimal(NaN) })).toThrow(
      /finite Decimal at price/,
    );
  });

  test("rejects input and output beyond the range the Platform can store", () => {
    const field = t.object({ price: t.decimal({ as: "decimal" }) });
    expect(
      parseInputFields({
        fields: { price: t.decimal({ as: "decimal" }) },
        value: { price: "1e999999999" },
        data: undefined,
        invoker: null,
      }),
    ).toEqual({
      issues: [{ message: "Expected a valid decimal: received 1e999999999", path: ["price"] }],
    });
    expect(() => serializeDateFields(field, { price: new Decimal("1e999999999") })).toThrow(
      /Decimal at price.*out of range/,
    );
    expect(() => serializeDateFields(field, { price: new Decimal("1e-999999999") })).toThrow(
      /Decimal at price.*out of range/,
    );
    expect(serializeDateFields(field, { price: new Decimal("1e1000") })).toEqual({
      price: `1${"0".repeat(1000)}`,
    });
  });
});

describe("parseDecimalFields and parseDateFields", () => {
  const payload = t.object({
    price: t.decimal({ as: "decimal" }),
    due: t.date({ as: "date" }),
  });

  test("parseDecimalFields converts decimal fields", () => {
    const result = parseDecimalFields(payload, {
      value: { price: "1.5", due: "2026-01-02" },
      data: undefined,
      invoker: null,
    }) as { value: { price: Decimal; due: unknown } };
    expect(Decimal.isDecimal(result.value.price)).toBe(true);
  });

  test("parseDateFields points to parseDecimalFields instead of leaving a decimal as a string", () => {
    expect(() =>
      parseDateFields(payload, {
        value: { price: "1.5", due: "2026-01-02" },
        data: undefined,
        invoker: null,
      }),
    ).toThrow(/parseDecimalFields/);
  });
});
