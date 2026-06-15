import { describe, expect, test } from "vitest";
import { globToRegExp } from "./verification";

describe("globToRegExp", () => {
  test("expands braces into alternations", () => {
    const regex = globToRegExp("**/*.{test,spec}.ts");

    expect(regex.test("src/foo.test.ts")).toBe(true);
    expect(regex.test("bar.spec.ts")).toBe(true);
    expect(regex.test("foo.ts")).toBe(false);
  });

  test("matches multiple extensions through brace alternation", () => {
    const regex = globToRegExp("**/*.{ts,json,jsonc}");

    expect(regex.test("tsconfig.json")).toBe(true);
    expect(regex.test("a/b.ts")).toBe(true);
    expect(regex.test("a/b.md")).toBe(false);
  });

  test("preserves existing non-brace glob behavior", () => {
    const tsRegex = globToRegExp("**/*.ts");
    expect(tsRegex.test("src/app.ts")).toBe(true);
    expect(tsRegex.test("app.ts")).toBe(true);
    expect(tsRegex.test("app.tsx")).toBe(false);

    const generatedRegex = globToRegExp("**/generated/**/*");
    expect(generatedRegex.test("a/generated/b/c.ts")).toBe(true);
    expect(generatedRegex.test("generated/x.ts")).toBe(true);
    expect(generatedRegex.test("src/app.ts")).toBe(false);
  });

  test("handles single-element and unclosed braces safely", () => {
    const single = globToRegExp("a.{ts}");
    expect(single.test("a.ts")).toBe(true);
    expect(single.test("a.js")).toBe(false);

    const unclosed = globToRegExp("a.{ts");
    expect(unclosed.test("a.{ts")).toBe(true);
    expect(unclosed.test("a.ts")).toBe(false);
  });
});
