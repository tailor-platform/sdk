import { describe, expect, test } from "vitest";
import { formatTypeScript } from "./format";

describe("formatTypeScript", () => {
  test("gives the same result for code that differs only in layout", async () => {
    expect(await formatTypeScript("const a  =  { b:1 }\n\n\n")).toBe(
      await formatTypeScript("const a = { b: 1 };"),
    );
  });

  test("gives a different result when the code changes", async () => {
    expect(await formatTypeScript("const a = 1;")).not.toBe(await formatTypeScript("const a = 2;"));
  });

  test("resolves to undefined for code with a syntax error", async () => {
    expect(await formatTypeScript("const = ;")).toBeUndefined();
  });
});
