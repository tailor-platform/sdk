import { ScalarType } from "@bufbuild/protobuf";
import { describe, expect, test } from "vitest";
import { coerceEnumValue, coerceScalarValue } from "./coerce";

describe("coerceScalarValue", () => {
  test("returns string scalar verbatim", () => {
    expect(coerceScalarValue(ScalarType.STRING, "hello")).toEqual({ ok: true, value: "hello" });
    expect(coerceScalarValue(ScalarType.STRING, "")).toEqual({ ok: true, value: "" });
  });

  test("parses BOOL from common forms", () => {
    expect(coerceScalarValue(ScalarType.BOOL, "true")).toEqual({ ok: true, value: true });
    expect(coerceScalarValue(ScalarType.BOOL, "TRUE")).toEqual({ ok: true, value: true });
    expect(coerceScalarValue(ScalarType.BOOL, "1")).toEqual({ ok: true, value: true });
    expect(coerceScalarValue(ScalarType.BOOL, "false")).toEqual({ ok: true, value: false });
    expect(coerceScalarValue(ScalarType.BOOL, "0")).toEqual({ ok: true, value: false });
  });

  test("rejects malformed BOOL", () => {
    const r = coerceScalarValue(ScalarType.BOOL, "yes");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/boolean/i);
  });

  test("parses 32-bit signed integers", () => {
    for (const t of [ScalarType.INT32, ScalarType.SINT32, ScalarType.SFIXED32]) {
      expect(coerceScalarValue(t, "42")).toEqual({ ok: true, value: 42 });
      expect(coerceScalarValue(t, "-7")).toEqual({ ok: true, value: -7 });
    }
  });

  test("rejects non-integer 32-bit input", () => {
    const r = coerceScalarValue(ScalarType.INT32, "3.14");
    expect(r.ok).toBe(false);
  });

  test("rejects negative for unsigned 32-bit", () => {
    const r = coerceScalarValue(ScalarType.UINT32, "-1");
    expect(r.ok).toBe(false);
  });

  test("64-bit integers are returned as strings", () => {
    for (const t of [
      ScalarType.INT64,
      ScalarType.UINT64,
      ScalarType.SINT64,
      ScalarType.FIXED64,
      ScalarType.SFIXED64,
    ]) {
      expect(coerceScalarValue(t, "9007199254740993")).toEqual({
        ok: true,
        value: "9007199254740993",
      });
    }
  });

  test("rejects non-integer 64-bit input", () => {
    const r = coerceScalarValue(ScalarType.INT64, "abc");
    expect(r.ok).toBe(false);
  });

  test("rejects out-of-range int64", () => {
    const tooLarge = coerceScalarValue(ScalarType.INT64, "9223372036854775808");
    expect(tooLarge.ok).toBe(false);
    const tooSmall = coerceScalarValue(ScalarType.INT64, "-9223372036854775809");
    expect(tooSmall.ok).toBe(false);
  });

  test("accepts int64 boundaries", () => {
    expect(coerceScalarValue(ScalarType.INT64, "9223372036854775807")).toEqual({
      ok: true,
      value: "9223372036854775807",
    });
    expect(coerceScalarValue(ScalarType.INT64, "-9223372036854775808")).toEqual({
      ok: true,
      value: "-9223372036854775808",
    });
  });

  test("rejects out-of-range uint64", () => {
    const r = coerceScalarValue(ScalarType.UINT64, "18446744073709551616");
    expect(r.ok).toBe(false);
  });

  test("accepts uint64 max", () => {
    expect(coerceScalarValue(ScalarType.UINT64, "18446744073709551615")).toEqual({
      ok: true,
      value: "18446744073709551615",
    });
  });

  test("parses FLOAT/DOUBLE", () => {
    expect(coerceScalarValue(ScalarType.FLOAT, "3.14")).toEqual({ ok: true, value: 3.14 });
    expect(coerceScalarValue(ScalarType.DOUBLE, "-0.5")).toEqual({ ok: true, value: -0.5 });
  });

  test("rejects non-finite float", () => {
    const r = coerceScalarValue(ScalarType.DOUBLE, "abc");
    expect(r.ok).toBe(false);
  });

  test("returns BYTES verbatim (base64 expected)", () => {
    expect(coerceScalarValue(ScalarType.BYTES, "aGVsbG8=")).toEqual({
      ok: true,
      value: "aGVsbG8=",
    });
  });
});

describe("coerceEnumValue", () => {
  const enumDesc = {
    values: [
      { name: "ROLE_UNSPECIFIED", localName: "Unspecified", number: 0 },
      { name: "ROLE_ADMIN", localName: "Admin", number: 1 },
      { name: "ROLE_VIEWER", localName: "Viewer", number: 2 },
    ],
  };

  test("matches by proto name", () => {
    expect(coerceEnumValue(enumDesc, "ROLE_ADMIN")).toEqual({ ok: true, value: "ROLE_ADMIN" });
  });

  test("matches by localName", () => {
    expect(coerceEnumValue(enumDesc, "Admin")).toEqual({ ok: true, value: "ROLE_ADMIN" });
  });

  test("rejects unknown enum value with candidate suggestion", () => {
    const r = coerceEnumValue(enumDesc, "ROLE_OWNER");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/ROLE_ADMIN|ROLE_VIEWER/);
  });

  test("rejects numeric input", () => {
    const r = coerceEnumValue(enumDesc, "1");
    expect(r.ok).toBe(false);
  });
});
