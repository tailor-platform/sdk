import { describe, expectTypeOf, test } from "vitest";
import type { TypeLevelError } from "#/types/helpers";
import type {
  DateDefaultOf,
  DateFieldValueFor,
  DateTimeFieldValueFor,
  TimeFieldValueFor,
} from "./field.types";
import type { Temporal } from "temporal-spec";

type Conflict = TypeLevelError<string>;

describe("DateDefaultOf", () => {
  test("an empty registry falls back to the SDK's built-in default", () => {
    // oxlint-disable-next-line typescript/no-empty-object-type -- the registry starts empty
    expectTypeOf<DateDefaultOf<{}, undefined>>().toEqualTypeOf<undefined>();
    // oxlint-disable-next-line typescript/no-empty-object-type -- the registry starts empty
    expectTypeOf<DateDefaultOf<{}, "temporal">>().toEqualTypeOf<"temporal">();
  });

  test("one configured app sets the default", () => {
    expectTypeOf<DateDefaultOf<{ app: "temporal" }, undefined>>().toEqualTypeOf<"temporal">();
  });

  test("an app without a setting follows the built-in default", () => {
    expectTypeOf<DateDefaultOf<{ app: undefined }, undefined>>().toEqualTypeOf<undefined>();
    expectTypeOf<DateDefaultOf<{ app: undefined }, "temporal">>().toEqualTypeOf<"temporal">();
  });

  test("apps whose effective defaults differ produce a type-level error", () => {
    expectTypeOf<DateDefaultOf<{ a: "temporal"; b: undefined }, undefined>>().toExtend<Conflict>();
  });

  test("an unset app and a temporal app agree once the built-in default is temporal", () => {
    expectTypeOf<
      DateDefaultOf<{ a: "temporal"; b: undefined }, "temporal">
    >().toEqualTypeOf<"temporal">();
  });

  test("apps with the same setting do not conflict", () => {
    expectTypeOf<
      DateDefaultOf<{ a: "temporal"; b: "temporal" }, undefined>
    >().toEqualTypeOf<"temporal">();
  });
});

describe("date field values under a default", () => {
  test("a field without `as` takes the default representation", () => {
    expectTypeOf<DateFieldValueFor<undefined, "temporal">>().toEqualTypeOf<Temporal.PlainDate>();
    expectTypeOf<DateTimeFieldValueFor<undefined, "temporal">>().toEqualTypeOf<Temporal.Instant>();
    expectTypeOf<TimeFieldValueFor<undefined, "temporal">>().toEqualTypeOf<Temporal.PlainTime>();
  });

  test("without a default the legacy types are unchanged", () => {
    expectTypeOf<DateFieldValueFor<undefined, undefined>>().toEqualTypeOf<string>();
    expectTypeOf<DateTimeFieldValueFor<undefined, undefined>>().toEqualTypeOf<string | Date>();
    expectTypeOf<TimeFieldValueFor<undefined, undefined>>().toEqualTypeOf<string>();
  });

  test("an explicit `as` wins over the default", () => {
    expectTypeOf<DateFieldValueFor<"string", "temporal">>().toEqualTypeOf<string>();
    expectTypeOf<DateTimeFieldValueFor<"string", "temporal">>().toEqualTypeOf<string>();
    expectTypeOf<DateFieldValueFor<"date", "temporal">>().toEqualTypeOf<Date>();
  });

  test("a conflicting default poisons the value type", () => {
    expectTypeOf<DateFieldValueFor<undefined, Conflict>>().toEqualTypeOf<Conflict>();
    expectTypeOf<DateFieldValueFor<"date", Conflict>>().toEqualTypeOf<Date>();
  });
});
