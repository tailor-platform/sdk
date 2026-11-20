import { describe, expect, test } from "vitest";
import { locateArgPath, normalizeArg } from "./arg";

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

describe("locateArgPath", () => {
  const at = (text: string, path: (string | number)[]) => {
    const range = locateArgPath(text, path);
    return range === undefined ? undefined : text.slice(range.from, range.to);
  };

  test("finds the value a path points at", () => {
    expect(at('{"a": "x", "b": 2}', ["a"])).toBe('"x"');
  });

  test("follows keys without quotes, comments and single quotes", () => {
    const text = "{\n  // first\n  a: 1,\n  nested: { c: 'five', },\n}";

    expect([at(text, ["a"]), at(text, ["nested", "c"])]).toEqual(["1", "'five'"]);
  });

  test("follows an array index", () => {
    expect(at('{"items": [10, {"name": 5}]}', ["items", 1, "name"])).toBe("5");
  });

  test("points at the opening brace of the object that lacks the key", () => {
    expect([at('{"a": 1}', ["b"]), at('{"o": {"x": 1}}', ["o", "y"])]).toEqual(["{", "{"]);
  });

  test("points at the opening bracket of an array that is too short", () => {
    expect(at('{"items": [1]}', ["items", 3])).toBe("[");
  });

  test("points at the value when the path goes on past a plain value", () => {
    expect(at('{"a": 1}', ["a", "x"])).toBe("1");
  });

  test.each([
    ["an empty path", '{"a": 1}', []],
    ["text that does not parse", "{a: ", ["a"]],
  ])("finds nothing for %s", (_name, text, path) => {
    expect(locateArgPath(text, path)).toBeUndefined();
  });
});
