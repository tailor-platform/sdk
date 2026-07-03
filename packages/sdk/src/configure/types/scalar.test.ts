// oxlint-disable vitest/expect-expect -- Type-only assertions are checked by TypeScript.
import { describe, expect, expectTypeOf, test } from "vitest";
import {
  assertDateString,
  assertDateTimeString,
  assertDecimalString,
  assertTimeString,
  assertUUIDString,
  isDateString,
  isDateTimeString,
  isDecimalString,
  isTimeString,
  isUUIDString,
  parseDateString,
  parseDateTimeString,
  parseDecimalString,
  parseTimeString,
  parseUUIDString,
} from "../index";
import type { DateString, DateTimeString, DecimalString, TimeString, UUIDString } from "../index";

describe("scalar string helpers", () => {
  test("type guard helpers narrow unknown values", () => {
    const uuid: unknown = "550e8400-e29b-41d4-a716-446655440000";
    const date: unknown = "2026-07-03";
    const datetime: unknown = "2026-07-03T12:34:56+09:00";
    const time: unknown = "12:34";
    const decimal: unknown = "123.45";

    if (isUUIDString(uuid)) {
      expectTypeOf(uuid).toEqualTypeOf<UUIDString>();
    }
    if (isDateString(date)) {
      expectTypeOf(date).toEqualTypeOf<DateString>();
    }
    if (isDateTimeString(datetime)) {
      expectTypeOf(datetime).toEqualTypeOf<DateTimeString>();
    }
    if (isTimeString(time)) {
      expectTypeOf(time).toEqualTypeOf<TimeString>();
    }
    if (isDecimalString(decimal)) {
      expectTypeOf(decimal).toEqualTypeOf<DecimalString>();
    }

    expect(isUUIDString(uuid)).toBe(true);
    expect(isDateString(date)).toBe(true);
    expect(isDateTimeString(datetime)).toBe(true);
    expect(isTimeString(time)).toBe(true);
    expect(isDecimalString(decimal)).toBe(true);
  });

  test("type guard helpers reject invalid values", () => {
    expect(isUUIDString("not-a-uuid")).toBe(false);
    expect(isDateString("2026/07/03")).toBe(false);
    expect(isDateTimeString("2026-07-03T12:34:56+0900")).toBe(false);
    expect(isTimeString("12:34:56")).toBe(false);
    expect(isTimeString("24:00")).toBe(false);
    expect(isTimeString("23:60")).toBe(false);
    expect(isTimeString("99:99")).toBe(false);
    expect(isDecimalString("1_000")).toBe(false);
    expect(isUUIDString(123)).toBe(false);
  });

  test("parse helpers return typed scalar strings", () => {
    const uuid = parseUUIDString("550e8400-e29b-41d4-a716-446655440000");
    const date = parseDateString("2026-07-03");
    const datetime = parseDateTimeString("2026-07-03T12:34:56Z");
    const time = parseTimeString("12:34");
    const decimal = parseDecimalString("123.45");

    expectTypeOf(uuid).toEqualTypeOf<UUIDString>();
    expectTypeOf(date).toEqualTypeOf<DateString>();
    expectTypeOf(datetime).toEqualTypeOf<DateTimeString>();
    expectTypeOf(time).toEqualTypeOf<TimeString>();
    expectTypeOf(decimal).toEqualTypeOf<DecimalString>();

    expect(uuid).toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(date).toBe("2026-07-03");
    expect(datetime).toBe("2026-07-03T12:34:56Z");
    expect(time).toBe("12:34");
    expect(decimal).toBe("123.45");
  });

  test("parse helpers throw TypeError with the given label", () => {
    expect(() => parseUUIDString("not-a-uuid", "customerId")).toThrow(
      new TypeError("customerId must be a UUID string"),
    );
    expect(() => parseDateString("2026/07/03", "businessDate")).toThrow(
      new TypeError("businessDate must be a date string"),
    );
    expect(() => parseDateTimeString("2026-07-03T12:34:56+0900", "scheduledAt")).toThrow(
      new TypeError("scheduledAt must be a datetime string"),
    );
    expect(() => parseTimeString("12:34:56", "openingTime")).toThrow(
      new TypeError("openingTime must be a time string"),
    );
    expect(() => parseDecimalString("1_000", "amount")).toThrow(
      new TypeError("amount must be a decimal string"),
    );
  });

  test("assert helpers narrow unknown values", () => {
    const uuid: unknown = "550e8400-e29b-41d4-a716-446655440000";
    const date: unknown = "2026-07-03";
    const datetime: unknown = "2026-07-03T12:34:56Z";
    const time: unknown = "12:34";
    const decimal: unknown = "123.45";

    assertUUIDString(uuid);
    assertDateString(date);
    assertDateTimeString(datetime);
    assertTimeString(time);
    assertDecimalString(decimal);

    expectTypeOf(uuid).toEqualTypeOf<UUIDString>();
    expectTypeOf(date).toEqualTypeOf<DateString>();
    expectTypeOf(datetime).toEqualTypeOf<DateTimeString>();
    expectTypeOf(time).toEqualTypeOf<TimeString>();
    expectTypeOf(decimal).toEqualTypeOf<DecimalString>();
  });
});
