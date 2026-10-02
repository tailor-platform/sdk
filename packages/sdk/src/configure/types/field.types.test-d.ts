import { describe, expectTypeOf, test } from "vitest";
import type { DateFieldValueFor, DateTimeFieldValueFor, TimeFieldValueFor } from "./field.types";
import type { Temporal } from "temporal-spec";

describe("date field values with a default representation", () => {
  test("an omitted as uses the default representation", () => {
    expectTypeOf<DateFieldValueFor<unknown, "temporal">>().toEqualTypeOf<Temporal.PlainDate>();
    expectTypeOf<DateTimeFieldValueFor<unknown, "temporal">>().toEqualTypeOf<Temporal.Instant>();
    expectTypeOf<TimeFieldValueFor<unknown, "temporal">>().toEqualTypeOf<Temporal.PlainTime>();
    expectTypeOf<DateTimeFieldValueFor<undefined, "date">>().toEqualTypeOf<Date>();
  });

  test("an explicit as takes precedence over the default representation", () => {
    expectTypeOf<DateFieldValueFor<"string", "temporal">>().toEqualTypeOf<string>();
    expectTypeOf<DateTimeFieldValueFor<"string", "temporal">>().toEqualTypeOf<string>();
    expectTypeOf<TimeFieldValueFor<"date", "temporal">>().toEqualTypeOf<Date>();
  });

  test("without a default representation an omitted as keeps the string-based types", () => {
    expectTypeOf<DateFieldValueFor<unknown, undefined>>().toEqualTypeOf<string>();
    expectTypeOf<DateTimeFieldValueFor<unknown, undefined>>().toEqualTypeOf<string | Date>();
    expectTypeOf<TimeFieldValueFor<unknown, undefined>>().toEqualTypeOf<string>();
  });

  test("a string default narrows datetime output to string", () => {
    expectTypeOf<DateTimeFieldValueFor<unknown, "string">>().toEqualTypeOf<string>();
  });

  test("a union of representations yields the union of their value types", () => {
    expectTypeOf<DateFieldValueFor<"date" | "temporal", undefined>>().toEqualTypeOf<
      Date | Temporal.PlainDate
    >();
  });
});
