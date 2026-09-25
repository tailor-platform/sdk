import { describe, expect, test } from "vitest";
import { parseBoolean } from "./parse-boolean";

describe("parseBoolean", () => {
  test.each([
    ["true", true],
    ["True", true],
    ["TRUE", true],
    ["t", true],
    ["yes", true],
    ["YES", true],
    ["y", true],
    ["on", true],
    ["1", true],
    ["  true  ", true],
  ])("returns true for %j", (input, expected) => {
    expect(parseBoolean(input)).toBe(expected);
  });

  test.each([
    ["false", false],
    ["False", false],
    ["FALSE", false],
    ["f", false],
    ["no", false],
    ["NO", false],
    ["n", false],
    ["off", false],
    ["0", false],
    ["  false  ", false],
  ])("returns false for %j", (input, expected) => {
    expect(parseBoolean(input)).toBe(expected);
  });

  test.each([[undefined], [""], ["  "], ["maybe"], ["2"], ["truee"]])(
    "returns undefined for %j",
    (input) => {
      expect(parseBoolean(input)).toBeUndefined();
    },
  );
});
