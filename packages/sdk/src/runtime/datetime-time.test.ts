import { describe, expect, expectTypeOf, test, vi } from "vitest";
import { createResolver } from "#/configure/services/resolver/resolver";
import { t } from "#/configure/types/type";
import { ResolverSchema } from "#/parser/service/resolver/schema";
import { serializeDateFields } from "./date";
import { parseInputFields } from "./field-parse";
import type { DateTimeFieldOptions, TimeFieldOptions } from "#/configure/types/field.types";
import type { DeepReadonly, output, SerializeDates } from "#/types/helpers";

describe("Datetime and time representations", () => {
  test("preserves defaults and infers explicitly selected representations", () => {
    const defaults = t.object({ at: t.datetime(), time: t.time() });
    const strings = t.object({ at: t.datetime({ as: "string" }), time: t.time({ as: "string" }) });
    const dates = t.object({ at: t.datetime({ as: "date" }), time: t.time({ as: "date" }) });
    const temporal = t.object({
      at: t.datetime({ as: "temporal" }),
      time: t.time({ as: "temporal" }),
    });
    expectTypeOf<output<typeof defaults>>().toEqualTypeOf<{ at: string | Date; time: string }>();
    expectTypeOf<output<typeof strings>>().toEqualTypeOf<{ at: string; time: string }>();
    expectTypeOf<output<typeof dates>>().toEqualTypeOf<{ at: Date; time: Date }>();
    expectTypeOf<output<typeof temporal>>().toEqualTypeOf<{
      at: Temporal.Instant;
      time: Temporal.PlainTime;
    }>();
    expectTypeOf<DeepReadonly<output<typeof temporal>>>().toEqualTypeOf<{
      readonly at: Temporal.Instant;
      readonly time: Temporal.PlainTime;
    }>();
    expectTypeOf<SerializeDates<output<typeof temporal>>>().toEqualTypeOf<{
      at: string;
      time: string;
    }>();
    const arrays = t.object({
      at: t.datetime({ as: "temporal", array: true, optional: true }),
      time: t.time({ as: "date", array: true, optional: true }),
    });
    expectTypeOf<output<typeof arrays>>().toEqualTypeOf<{
      at?: Temporal.Instant[] | null;
      time?: Date[] | null;
    }>();
    const dynamicDatetime = (options: DateTimeFieldOptions) => t.datetime(options);
    const dynamicTime = (options: TimeFieldOptions) => t.time(options);
    expectTypeOf<output<ReturnType<typeof dynamicDatetime>>>().toEqualTypeOf<
      string | Date | Temporal.Instant
    >();
    expectTypeOf<output<ReturnType<typeof dynamicTime>>>().toEqualTypeOf<
      string | Date | Temporal.PlainTime
    >();
    expect(defaults.fields.at?.metadata).not.toHaveProperty("as");
    expect(defaults.fields.time?.metadata).not.toHaveProperty("as");
  });

  test.each(["date", "temporal"] as const)(
    "converts nested %s values before validation and serializes without mutating input",
    (as) => {
      const checkDatetime = vi.fn(({ value }: { value: Date | Temporal.Instant }) => {
        expect(value).toBeInstanceOf(as === "date" ? Date : Temporal.Instant);
      });
      const checkTime = vi.fn(({ value }: { value: Date | Temporal.PlainTime }) => {
        expect(value).toBeInstanceOf(as === "date" ? Date : Temporal.PlainTime);
      });
      const checkParent = vi.fn();
      const schema = t
        .object({
          rows: t.object(
            {
              at: t.datetime({ as }).description("Timestamp").validate(checkDatetime),
              times: t
                .time({ as, array: true })
                .validate(({ value }) => value.forEach((time) => checkTime({ value: time }))),
              absentAt: t.datetime({ as, optional: true }),
              absentTime: t.time({ as, optional: true }),
            },
            { array: true },
          ),
        })
        .validate(checkParent);
      const input = {
        rows: [
          {
            at: "2024-02-29T23:45:12.123+09:00",
            times: ["00:00", "23:59"],
            absentAt: null,
            absentTime: null,
          },
        ],
      };
      const result = parseInputFields({
        fields: schema.fields,
        value: input,
        data: input,
        invoker: null,
      });
      expect(result.issues).toBeUndefined();
      const parsed = schema.parse({ value: input, data: input, invoker: null });
      if (parsed.issues) throw new Error(JSON.stringify(parsed.issues));
      expect(parsed.value.rows[0]?.at).toEqual(
        as === "date"
          ? new Date("2024-02-29T14:45:12.123Z")
          : Temporal.Instant.from("2024-02-29T14:45:12.123Z"),
      );
      expect(parsed.value.rows[0]?.times[1]).toEqual(
        as === "date" ? new Date("1970-01-01T23:59:00Z") : Temporal.PlainTime.from("23:59"),
      );
      expect(checkDatetime).toHaveBeenCalledWith({ value: parsed.value.rows[0]?.at });
      expect(checkTime).toHaveBeenCalledWith({ value: parsed.value.rows[0]?.times[1] });
      expect(checkParent).toHaveBeenCalledWith({ value: parsed.value });
      expect(serializeDateFields(schema, parsed.value)).toEqual({
        rows: [{ ...input.rows[0], at: "2024-02-29T14:45:12.123Z" }],
      });
      expect(input.rows[0]?.at).toBe("2024-02-29T23:45:12.123+09:00");
      expect(parsed.value.rows[0]?.at).toBeInstanceOf(as === "date" ? Date : Temporal.Instant);
      const resolver = createResolver({
        name: "roundTrip",
        operation: "query",
        input: schema.fields,
        body: () => parsed.value,
        output: schema,
      });
      expect(ResolverSchema.parse(resolver).output.fields.rows?.fields.at?.metadata.as).toBe(as);
    },
  );

  test.each(["date", "temporal"] as const)(
    "rejects malformed %s inputs before running validators",
    (as) => {
      const validate = vi.fn();
      const schema = t
        .object({
          rows: t.object(
            {
              at: t.datetime({ as, array: true }).validate(validate),
              time: t.time({ as }).validate(validate),
            },
            { array: true },
          ),
        })
        .validate(validate);
      for (const at of [
        "2023-02-29T00:00:00Z",
        "2026-04-31T00:00:00Z",
        "2026-01-01T00:00:00",
        "2026-01-01T24:00:00Z",
        "2026-01-01T00:00:60Z",
        "+010000-01-01T00:00:00Z",
        "invalid",
      ]) {
        const result = schema.parse({
          value: { rows: [{ at: [at], time: "12:30" }] },
          data: {},
          invoker: null,
        });
        expect(result.issues).toEqual(
          expect.arrayContaining([expect.objectContaining({ path: ["rows", "[0]", "at", "[0]"] })]),
        );
      }
      for (const time of ["24:00", "12:60", "12:30:01", "1:30", "12:30Z", "invalid"]) {
        expect(
          schema.parse({
            value: { rows: [{ at: ["2026-01-01T00:00:00Z"], time }] },
            data: {},
            invoker: null,
          }).issues,
        ).toEqual(
          expect.arrayContaining([expect.objectContaining({ path: ["rows", "[0]", "time"] })]),
        );
      }
      expect(validate).not.toHaveBeenCalled();
    },
  );

  test.each(["date", "temporal"] as const)(
    "preserves optional %s values and rejects strings returned as objects",
    (as) => {
      for (const field of [t.datetime({ as, optional: true }), t.time({ as, optional: true })]) {
        for (const value of [null, undefined]) {
          expect(field.parse({ value, data: {}, invoker: null })).toEqual({ value: null });
          expect(serializeDateFields(field, value)).toBe(value);
        }
        expect(() => serializeDateFields(field, "12:30")).toThrow(
          "instance at the top-level value",
        );
      }
    },
  );

  test("formats UTC datetimes with representable years", () => {
    for (const value of ["0000-01-01T00:00:00Z", "0099-12-31T23:59:59Z", "9999-12-31T23:59:59Z"]) {
      expect(serializeDateFields(t.datetime({ as: "date" }), new Date(value))).toBe(
        value.replace("Z", ".000Z"),
      );
      expect(
        serializeDateFields(t.datetime({ as: "temporal" }), Temporal.Instant.from(value)),
      ).toBe(value);
    }
    for (const value of ["-000001-12-31T23:59:59Z", "+010000-01-01T00:00:00Z"]) {
      expect(() => serializeDateFields(t.datetime({ as: "date" }), new Date(value))).toThrow(
        "4-digit",
      );
      expect(() =>
        serializeDateFields(t.datetime({ as: "temporal" }), Temporal.Instant.from(value)),
      ).toThrow("4-digit");
    }
    expect(() => serializeDateFields(t.datetime({ as: "date" }), new Date(NaN))).toThrow(
      "invalid Date",
    );
  });

  test("preserves Instant nanoseconds locally and Date millisecond precision", () => {
    const value = "2026-09-16T01:02:03.123456789+09:00";
    const temporal = t.datetime({ as: "temporal" });
    const date = t.datetime({ as: "date" });
    const instant = temporal.parse({ value, data: {}, invoker: null });
    const legacy = date.parse({ value, data: {}, invoker: null });
    if (instant.issues || legacy.issues) throw new Error("Expected valid datetime");
    expect(serializeDateFields(temporal, instant.value)).toBe("2026-09-15T16:02:03.123456789Z");
    expect(serializeDateFields(date, legacy.value)).toBe("2026-09-15T16:02:03.123Z");
  });

  test("formats time using UTC and truncates seconds and fractions without rounding", () => {
    expect(
      serializeDateFields(t.time({ as: "date" }), new Date("2026-09-16T12:30:59.999+09:00")),
    ).toBe("03:30");
    const date = t.object({ times: t.time({ as: "date", array: true }) });
    const temporal = t.object({ times: t.time({ as: "temporal", array: true }) });
    for (const value of [
      new Date("1970-01-01T12:30:01Z"),
      new Date("1970-01-01T12:30:00.001Z"),
      new Date("1970-01-01T12:30:59.999Z"),
    ]) {
      expect(serializeDateFields(date, { times: [value] })).toEqual({ times: ["12:30"] });
    }
    expect(() => serializeDateFields(date, { times: [new Date(NaN)] })).toThrow("times[0]");
    for (const value of ["12:30:01", "12:30:00.001", "12:30:00.000001", "12:30:00.000000001"]) {
      expect(serializeDateFields(temporal, { times: [Temporal.PlainTime.from(value)] })).toEqual({
        times: ["12:30"],
      });
    }
    expect(serializeDateFields(date, { times: [new Date("1970-01-01T23:59:59.999Z")] })).toEqual({
      times: ["23:59"],
    });
    expect(
      serializeDateFields(temporal, { times: [Temporal.PlainTime.from("23:59:59.999999999")] }),
    ).toEqual({ times: ["23:59"] });
    expect(() =>
      serializeDateFields(
        t.time({ as: "temporal" }),
        Temporal.Instant.from("2026-09-16T00:00:00Z"),
      ),
    ).toThrow("Temporal.PlainTime instance");
  });

  test("existing string fields do not require a Temporal global", () => {
    vi.stubGlobal("Temporal", undefined);
    try {
      const fields = t.object({
        at: t.datetime(),
        time: t.time(),
        dateAt: t.datetime({ as: "date" }),
        dateTime: t.time({ as: "date" }),
      });
      const input = {
        at: "2026-09-16T00:00:00Z",
        time: "12:30",
        dateAt: "2026-09-16T00:00:00Z",
        dateTime: "12:30",
      };
      const result = fields.parse({ value: input, data: input, invoker: null });
      if (result.issues) throw new Error(JSON.stringify(result.issues));
      expect(serializeDateFields(fields, result.value)).toEqual({
        ...input,
        dateAt: "2026-09-16T00:00:00.000Z",
      });
      expect(() =>
        t.datetime({ as: "temporal" }).parse({ value: input.at, data: {}, invoker: null }),
      ).toThrow(TypeError);
      expect(() =>
        t.time({ as: "temporal" }).parse({ value: input.time, data: {}, invoker: null }),
      ).toThrow(TypeError);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
