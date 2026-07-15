import { describe, expect, test } from "vitest";
import { applyReplacements } from "./ast-utils";

describe("applyReplacements", () => {
  test("applies non-overlapping replacements regardless of input order", () => {
    const source = "aaa bbb ccc";

    const result = applyReplacements(source, [
      { start: 8, end: 11, text: "C" },
      { start: 0, end: 3, text: "A" },
    ]);

    expect(result).toBe("A bbb C");
  });

  test("allows adjacent ranges that touch without overlapping", () => {
    const source = "abcdef";

    const result = applyReplacements(source, [
      { start: 0, end: 3, text: "X" },
      { start: 3, end: 6, text: "Y" },
    ]);

    expect(result).toBe("XY");
  });

  test("throws on partially overlapping ranges", () => {
    expect(() =>
      applyReplacements("abcdef", [
        { start: 0, end: 4, text: "X" },
        { start: 2, end: 6, text: "Y" },
      ]),
    ).toThrow(/overlapping replacement ranges/);
  });

  test("throws on nested ranges", () => {
    expect(() =>
      applyReplacements("abcdefgh", [
        { start: 0, end: 8, text: "outer" },
        { start: 2, end: 4, text: "inner" },
      ]),
    ).toThrow(/overlapping replacement ranges/);
  });

  test("throws on duplicate ranges", () => {
    expect(() =>
      applyReplacements("abcdef", [
        { start: 1, end: 3, text: "X" },
        { start: 1, end: 3, text: "Y" },
      ]),
    ).toThrow(/overlapping replacement ranges/);
  });
});
