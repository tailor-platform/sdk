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
    [
      "does not flag a typeof check on an undeclared identifier",
      "() => typeof process === 'undefined'",
      [],
    ],
    [
      "does not flag the cross-environment global-detection idiom (es-toolkit/lodash/core-js)",
      "() => typeof globalThis === 'object' && globalThis || typeof window === 'object' && window || typeof self === 'object' && self || typeof global === 'object' && global",
      [],
    ],
    [
      "does not flag the same idiom after a minifier rewrites === to == against typeof",
      "() => typeof globalThis == 'object' && globalThis || typeof window == 'object' && window || typeof self == 'object' && self || typeof global == 'object' && global",
      [],
    ],
    [
      "still flags a global referenced outside a typeof guard",
      "() => typeof process === 'object' ? 1 : process.exit(1)",
      ["process"],
    ],
    [
      "does not flag a member-expression chain rooted at a typeof-guarded identifier",
      "() => typeof process !== 'undefined' && process.env",
      [],
    ],
    [
      "does not flag a nested member-expression chain rooted at a typeof-guarded identifier",
      "() => typeof global !== 'undefined' && global.Object.keys",
      [],
    ],
    [
      "still flags free variables inside a computed member access on a guarded chain",
      "() => typeof process !== 'undefined' && process.env[KEY]",
      ["KEY"],
    ],
  ])("%s", (_name, code, expected) => {
    const vars = findUndefinedReferences(`const __fn = ${code};`);
    expect(vars).toEqual(new Set(expected));
  });

  test("throws on unparsable code instead of silently returning an incomplete result", () => {
    expect(() => findUndefinedReferences("const __fn = ({ value }) =>;")).toThrow(/Parse errors/);
  });
});
