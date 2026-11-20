import { describe, expect, test } from "vitest";
import { normalizeArg } from "./arg";

describe("normalizeArg", () => {
  test.each([
    ["JSON", '{"a": 1, "b": [true, null]}', '{"a":1,"b":[true,null]}'],
    ["keys without quotes", "{a: 1, b: 2}", '{"a":1,"b":2}'],
    ["single-quoted strings", "{a: 'x'}", '{"a":"x"}'],
    ["a trailing comma", "{a: [1, 2,],}", '{"a":[1,2]}'],
    ["comments", "{\n  // the first number\n  a: 1, /* the second */ b: 2\n}", '{"a":1,"b":2}'],
  ])("turns %s into plain JSON", (_name, input, expected) => {
    expect(normalizeArg(input)).toBe(expected);
  });

  test("treats an empty argument as {}", () => {
    expect([normalizeArg(""), normalizeArg("  \n")]).toEqual(["{}", "{}"]);
  });

  test.each(["{oops", "{a: }", "undefined"])("rejects %s", (input) => {
    expect(normalizeArg(input)).toBeUndefined();
  });
});
