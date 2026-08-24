import { describe, expect, test } from "vitest";
import { findUndefinedReferences } from "./free-variables";

describe("findUndefinedReferences", () => {
  test.each<[name: string, code: string, expected: string[]]>([
    ["returns empty set for self-contained function", "({ value }) => value.length > 5", []],
    ["detects a single free variable", "({ value }) => value.length < MAX_LENGTH", ["MAX_LENGTH"]],
    [
      "detects multiple free variables",
      "({ data }) => formatAddress(data, PREFIX)",
      ["formatAddress", "PREFIX"],
    ],
    [
      "does not treat destructured parameters as free variables",
      "({ value, data, user }) => value + data.name + user.id",
      [],
    ],
    [
      "does not treat local variables as free variables",
      "({ value }) => { const x = 1; return value + x; }",
      [],
    ],
    [
      "detects free variables in function body with local variables",
      "({ value }) => { const x = helper(value); return x + OFFSET; }",
      ["helper", "OFFSET"],
    ],
    [
      "handles regular function syntax",
      "function({ data }) { return compute(data); }",
      ["compute"],
    ],
    [
      "excludes Web Standard globals (ES_BUILTINS)",
      "async () => { await fetch(new URL('https://x')); return new TextEncoder(); }",
      [],
    ],
  ])("%s", (_name, code, expected) => {
    const vars = findUndefinedReferences(`const __fn = ${code};`);
    expect(vars).toEqual(new Set(expected));
  });
});
