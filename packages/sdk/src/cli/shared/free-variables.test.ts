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
      "does not flag the same idiom after a minifier rewrites the string literal to a template literal",
      "() => typeof globalThis==`object`&&globalThis||typeof window==`object`&&window||typeof self==`object`&&self||typeof global==`object`&&global",
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
    [
      "still flags a reference guarded by the wrong-direction comparison (=== undefined)",
      "() => typeof process === 'undefined' && process.env",
      ["process"],
    ],
    [
      "still flags a reference guarded by the wrong-direction comparison (!== a non-undefined type)",
      "() => typeof process !== 'object' && process.env",
      ["process"],
    ],
    [
      "does not flag the positive form compared against a non-undefined type",
      "() => typeof process === 'object' && process.env",
      [],
    ],
  ])("%s", (_name, code, expected) => {
    const vars = findUndefinedReferences(`const __fn = ${code};`);
    expect(vars).toEqual(new Set(expected));
  });

  test("throws on unparsable code instead of silently returning an incomplete result", () => {
    expect(() => findUndefinedReferences("const __fn = ({ value }) =>;")).toThrow(/Parse errors/);
  });

  test("treats an ESM import's local binding as bound, not a free variable", () => {
    const vars = findUndefinedReferences(
      'import { process } from "./local-shim";\nconst __fn = () => process.env.X;',
    );
    expect(vars).toEqual(new Set());
  });

  test("still flags an unrelated free variable alongside a bound import", () => {
    const vars = findUndefinedReferences(
      'import { helper } from "./local-shim";\nconst __fn = () => helper(OFFSET);',
    );
    expect(vars).toEqual(new Set(["OFFSET"]));
  });

  test("does not treat a class method name as a reference", () => {
    const vars = findUndefinedReferences(
      "class Job { process(x) { return x + 1; } }\nnew Job().process(1);",
    );
    expect(vars).toEqual(new Set());
  });

  test("does not treat a class field name as a reference", () => {
    const vars = findUndefinedReferences("class Job { process = 1; }\nnew Job().process;");
    expect(vars).toEqual(new Set());
  });

  test("does not treat a class accessor name as a reference", () => {
    const vars = findUndefinedReferences(
      "class Job { get process() { return 1; } }\nnew Job().process;",
    );
    expect(vars).toEqual(new Set());
  });

  test("a parameter named after a forbidden global only shadows it within that function", () => {
    const vars = findUndefinedReferences(
      "function f(process) { return process.x; }\nprocess.env.FOO;",
    );
    expect(vars).toEqual(new Set(["process"]));
  });

  test("a parameter named after a forbidden global is not flagged within its own function", () => {
    const vars = findUndefinedReferences("function f(process) { return process.x; }");
    expect(vars).toEqual(new Set());
  });
});
