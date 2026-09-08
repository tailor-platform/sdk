import { describe, expect, expectTypeOf, test, vi } from "vitest";
import { createResolver } from "#/configure/services/resolver/resolver";
import { t } from "#/configure/types/type";
import { ResolverSchema } from "#/parser/service/resolver/schema";
import { serializeDateFields } from "./date";
import { parseInputFields } from "./field-parse";
import type { DateFieldOptions } from "#/configure/types/field.types";
import type { output } from "#/types/helpers";

const parse = (field: ReturnType<typeof t.object>, value: unknown) =>
  field.parse({ value, data: value, invoker: null });

describe("Date representation", () => {
  test("infers Date only when opted in, preserving arrays and optional fields", () => {
    const plain = t.date();
    const explicit = t.date({ as: "string" });
    const date = t.date({ as: "date" });
    const optional = t.date({ as: "date", optional: true });
    const array = t.date({ as: "date", array: true, optional: true });
    expectTypeOf<output<typeof plain>>().toEqualTypeOf<string>();
    expectTypeOf<output<typeof explicit>>().toEqualTypeOf<string>();
    expectTypeOf<output<typeof date>>().toEqualTypeOf<Date>();
    expectTypeOf<output<typeof optional>>().toEqualTypeOf<Date | null>();
    expectTypeOf<output<typeof array>>().toEqualTypeOf<Date[] | null>();
    const dynamic = (options: DateFieldOptions) => t.date(options);
    expectTypeOf<output<ReturnType<typeof dynamic>>>().toEqualTypeOf<string | Date>();
    expect(plain.metadata).not.toHaveProperty("as");
    expect(date.metadata.as).toBe("date");
  });

  test("converts nested input before field and parent validation without mutating it", () => {
    const validateDate = vi.fn(({ value }: { value: Date }) => {
      expect(value).toBeInstanceOf(Date);
    });
    const date = t.date({ as: "date" }).description("Day").validate(validateDate);
    const schema = t
      .object({
        rows: t
          .object(
            {
              date,
              dates: t.date({ as: "date", array: true }),
              absent: t.date({ as: "date", optional: true }),
              plain: t.date(),
            },
            { array: true },
          )
          .validate(({ value }) => {
            expectTypeOf(value[0]!.date).toEqualTypeOf<Date>();
            expect(value[0]?.date).toBeInstanceOf(Date);
          }),
      })
      .description("Rows");
    const input = {
      rows: [
        {
          date: "2024-02-29",
          dates: ["0000-01-01", "0099-12-31"],
          absent: null,
          plain: "2026-09-07",
        },
      ],
    };
    const expected = {
      rows: [
        {
          date: new Date("2024-02-29"),
          dates: [new Date("0000-01-01"), new Date("0099-12-31")],
          absent: null,
          plain: "2026-09-07",
        },
      ],
    };
    expect(parse(schema, input)).toEqual({ value: expected });
    expect(
      parseInputFields({ fields: schema.fields, value: input, data: input, invoker: null }),
    ).toEqual({ value: expected });
    expect(validateDate).toHaveBeenCalledWith({ value: new Date("2024-02-29") });
    expect(input.rows[0]?.date).toBe("2024-02-29");
    expect(serializeDateFields(schema, expected)).toEqual(input);
    expect(expected.rows[0]?.date).toBeInstanceOf(Date);
  });

  test.each([
    "2023-02-29",
    "2026-02-30",
    "2026-13-01",
    "2026-00-01",
    "2026-01-00",
    "2026-04-31",
    "invalid",
    "2026-09-07T00:00:00Z",
  ])("rejects invalid date input %s with a nested path", (value) => {
    const schema = t.object({
      rows: t.object({ date: t.date({ as: "date" }) }, { array: true }),
    });
    expect(parse(schema, { rows: [{ date: value }] })).toMatchObject({
      issues: [{ path: ["rows", "[0]", "date"] }],
    });
  });

  test("preserves the existing string format validation", () => {
    const field = t.date();
    expect(field.parse({ value: "2026-02-30", data: {}, invoker: null })).toEqual({
      value: "2026-02-30",
    });
  });

  test("collects invalid calendar dates before running custom validators", () => {
    const validate = vi.fn();
    const schema = t
      .object({ dates: t.date({ as: "date", array: true }).validate(validate) })
      .validate(validate);
    expect(parse(schema, { dates: ["2023-02-29", "2026-04-31"] })).toMatchObject({
      issues: [{ path: ["dates", "[0]"] }, { path: ["dates", "[1]"] }],
    });
    expect(validate).not.toHaveBeenCalled();
  });

  test.each([null, undefined])("preserves optional input and output %s", (value) => {
    const field = t.date({ as: "date", optional: true });
    expect(field.parse({ value, data: {}, invoker: null })).toEqual({ value: null });
    expect(serializeDateFields(field, value)).toBe(value);
  });

  test("formats the UTC calendar date and pads four-digit years", () => {
    const field = t.date({ as: "date", array: true });
    expect(
      serializeDateFields(field, [
        new Date("2026-09-07T00:00:00+09:00"),
        new Date("0099-01-02"),
        new Date("0000-02-29"),
        new Date("9999-12-31"),
      ]),
    ).toEqual(["2026-09-06", "0099-01-02", "0000-02-29", "9999-12-31"]);
  });

  test.each([
    [new Date(NaN), "an invalid Date"],
    [new Date("+010000-01-01"), "year 10000"],
    [new Date("-000001-01-01"), "year -1"],
  ])("rejects unrepresentable Date output %s", (value, received) => {
    const schema = t.object({ dates: t.date({ as: "date", array: true }) });
    expect(() => serializeDateFields(schema, { dates: [value] })).toThrow(
      `Invalid date at dates[0]: Expected a Date with a 4-digit year (0000-9999), but received ${received}`,
    );
  });

  test("rejects strings returned for a Date representation", () => {
    expect(() => serializeDateFields(t.date({ as: "date" }), "2026-09-07")).toThrow(
      'Expected a Date instance at the top-level value, but received a string ("2026-09-07")',
    );
  });

  test.each([
    [42, "a number (42)"],
    [true, "a boolean (true)"],
    [{}, "an object"],
    [[1, "a"], "an array of number/string"],
    [[], "an empty array"],
  ])("describes non-Date output %s in the type mismatch message", (value, described) => {
    expect(() => serializeDateFields(t.date({ as: "date" }), value)).toThrow(
      `Expected a Date instance at the top-level value, but received ${described}`,
    );
  });

  test("keeps resolver body types and parsed metadata aligned", () => {
    const resolver = createResolver({
      name: "dateExample",
      operation: "query",
      input: { date: t.date({ as: "date" }) },
      body: ({ input }) => {
        expectTypeOf(input.date).toEqualTypeOf<Date>();
        return { date: input.date };
      },
      output: { date: t.date({ as: "date" }) },
    });
    expect(ResolverSchema.parse(resolver).input?.date?.metadata.as).toBe("date");
    expect(ResolverSchema.parse(resolver).output.fields.date?.metadata.as).toBe("date");
  });
});
