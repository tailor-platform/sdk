import { describe, expect, test } from "vitest";
import { assertParsableExpression } from "./script-expr";

describe("assertParsableExpression", () => {
  test("returns the expression when it parses", () => {
    const expr = `((v) => v.length > 0)({ value: _value })`;

    expect(assertParsableExpression(expr, "hooks")).toBe(expr);
  });

  test("accepts expressions ending with a line comment", () => {
    const expr = `(() => 1)() // generated`;

    expect(assertParsableExpression(expr, "hooks")).toBe(expr);
  });

  test("throws with context and parse errors for invalid expressions", () => {
    const expr = `(create() { return 1; })({ value: _value })`;

    expect(() => assertParsableExpression(expr, "hooks in /path/to/type.ts")).toThrow(
      /Generated hooks in \/path\/to\/type\.ts script is not valid JavaScript/,
    );
    expect(() => assertParsableExpression(expr, "hooks")).toThrow(/Parse errors:/);
  });

  test("rejects statement sequences that are not a single expression", () => {
    expect(() => assertParsableExpression("a; b", "validate")).toThrow(/not valid JavaScript/);
  });
});
