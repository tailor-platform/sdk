import { describe, expect, test } from "vitest";
import { parsePositiveInt } from "./parse-positive-int";

describe("parsePositiveInt", () => {
  test.each([
    ["1", 1],
    ["7", 7],
    ["16", 16],
    ["  7  ", 7],
    ["0007", 7],
    [String(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER],
  ])("returns the value for %j", (input, expected) => {
    expect(parsePositiveInt(input)).toBe(expected);
  });

  test.each([
    [undefined],
    [""],
    ["  "],
    ["0"],
    ["-1"],
    ["1.5"],
    ["1e3"],
    ["+5"],
    ["Infinity"],
    ["abc"],
    ["7abc"],
  ])("returns undefined for %j", (input) => {
    expect(parsePositiveInt(input)).toBeUndefined();
  });

  // A value past 2^53-1 loses integer precision, so it can no longer describe a
  // real cap; treating it as unset lets the caller's default apply instead.
  test.each([["9007199254740992"], ["99999999999999999999"]])(
    "returns undefined for the unsafe integer %j",
    (input) => {
      expect(parsePositiveInt(input)).toBeUndefined();
    },
  );
});
