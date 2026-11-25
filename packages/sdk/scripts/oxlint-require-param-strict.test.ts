import { describe, expect, test } from "vitest";
import { lintWithLocalRule } from "./test-helpers/local-rule";

const fixture = [
  "/**",
  " * @param x - X",
  " */",
  "export function bound(this: { a: string }, x: number) { return [this, x]; }",
  "/**",
  " * @param x - X",
  " */",
  "export function missing(x: number, y: number) { return [x, y]; }",
  "",
].join("\n");

function lint(level: "error" | "off") {
  return lintWithLocalRule({
    rule: "require-param-strict",
    level,
    fileName: "module.ts",
    source: fixture,
  });
}

describe("local/require-param-strict", () => {
  test("flags an undocumented parameter but not `this`", () => {
    expect(lint("error")).toEqual([{ rule: "local(require-param-strict)", line: 8 }]);
  });

  test("reports nothing when disabled, so the fixture itself is clean", () => {
    expect(lint("off")).toEqual([]);
  });
});
