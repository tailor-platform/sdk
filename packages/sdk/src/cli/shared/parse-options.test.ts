import { describe, expect, expectTypeOf, test } from "vitest";
import { z } from "zod";
import { parseOptions } from "./parse-options";

describe("parseOptions", () => {
  test("returns the transformed schema output", () => {
    const schema = z.strictObject({ value: z.string().transform((value) => value.length) });

    const result = parseOptions(schema, { value: "tailor" });

    expect(result).toEqual({ value: 6 });
    expectTypeOf(result).toEqualTypeOf<{ value: number }>();
  });

  test("throws the first validation issue message", () => {
    const schema = z.strictObject({
      first: z.string().min(1, "first issue"),
      second: z.string().min(1, "second issue"),
    });

    expect(() => parseOptions(schema, { first: "", second: "" })).toThrowError(
      new Error("first issue"),
    );
  });
});
