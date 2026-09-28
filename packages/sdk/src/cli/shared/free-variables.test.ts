import { describe, expect, test } from "vitest";
import { findUndefinedReferences } from "./free-variables";

describe("findUndefinedReferences", () => {
  test("includes guarded free references when requested", () => {
    expect(
      findUndefinedReferences('typeof _data !== "undefined" && _data[typeof key]', {
        includeGuardedReferences: true,
      }),
    ).toEqual(new Set(["_data", "key"]));
  });

  test("includes references guarded by an if statement or an early exit when requested", () => {
    expect(
      findUndefinedReferences(
        "if (typeof process !== 'undefined') process.cwd();\n" +
          "if (typeof Buffer === 'undefined') throw new Error('x');\n" +
          "Buffer.from('');\n" +
          "typeof Deno < 'u' && Deno.exit(1);",
        { includeGuardedReferences: true },
      ),
    ).toEqual(new Set(["process", "Buffer", "Deno"]));
  });

  test("does not flag module-level references after an early throw guarded by typeof", () => {
    expect(
      findUndefinedReferences(
        "if (typeof Buffer === 'undefined') throw new Error('x');\nBuffer.from('');",
      ),
    ).toEqual(new Set());
  });

  test("keeps locally bound names excluded when including guarded references", () => {
    expect(
      findUndefinedReferences('(_data) => typeof _data !== "undefined" && _data.name', {
        includeGuardedReferences: true,
      }),
    ).toEqual(new Set());
  });

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
      "does not flag the UMD ternary global-detection idiom",
      "() => typeof global !== 'undefined' ? global : typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : {}",
      [],
    ],
    [
      "does not flag the UMD ternary idiom after a minifier rewrites !== 'undefined' to < 'u'",
      "() => typeof global<`u`?global:typeof self<`u`?self:typeof window<`u`?window:{}",
      [],
    ],
    [
      "does not flag a typeof-guarded && chain after a minifier rewrites !== 'undefined' to < 'u'",
      "() => typeof process<`u`&&process.env",
      [],
    ],
    [
      "still flags a reference guarded by the minified wrong-direction comparison (> 'u')",
      "() => typeof global>`u`?global:{}",
      ["global"],
    ],
    [
      "does not flag the alternate branch of a ternary that tests typeof === 'undefined'",
      "() => typeof window === 'undefined' ? {} : window",
      [],
    ],
    [
      "does not flag the alternate branch of a ternary after a minifier rewrites === 'undefined' to > 'u'",
      "() => typeof window>`u`?{}:window",
      [],
    ],
    [
      "still flags a global in the alternate branch of a typeof-guarded ternary",
      "() => typeof global !== 'undefined' ? global : process.env",
      ["process"],
    ],
    [
      "still flags a ternary consequent guarded by the wrong-direction comparison (=== undefined)",
      "() => typeof global === 'undefined' ? global : {}",
      ["global"],
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
    [
      "does not flag a call on a typeof-guarded identifier on the right of &&",
      "(m) => typeof process < 'u' && process.emitWarning(m)",
      [],
    ],
    [
      "does not flag a typeof-guarded identifier passed as an argument on the right of &&",
      "() => typeof Buffer !== 'undefined' && wrap(Buffer)",
      ["wrap"],
    ],
    [
      "does not flag the right of || whose left is true while the identifier is undeclared",
      "() => typeof process > 'u' || process.emitWarning('x')",
      [],
    ],
    [
      "still flags the right of || whose left is false while the identifier is undeclared",
      "() => typeof process !== 'undefined' || process.env",
      ["process"],
    ],
    [
      "does not flag a call in a ternary branch guarded by typeof",
      "() => typeof process !== 'undefined' ? process.cwd() : '/'",
      [],
    ],
    [
      "does not flag references guarded by any operand of an && test",
      "() => typeof window !== 'undefined' && typeof process !== 'undefined' && process.env",
      [],
    ],
    [
      "does not flag references guarded by any operand of a parenthesized || test",
      "() => (typeof process > 'u' || typeof window > 'u') || process.env",
      [],
    ],
    [
      "does not flag references in an if consequent guarded by typeof",
      "() => { if (typeof process !== 'undefined') { return process.env.FOO; } }",
      [],
    ],
    [
      "does not flag references in an if alternate when the test is true while undeclared",
      "() => { if (typeof process === 'undefined') { return 1; } else { return process.env.FOO; } }",
      [],
    ],
    [
      "still flags references in an if consequent when the test is true while undeclared",
      "() => { if (typeof process === 'undefined') { return process.env.FOO; } }",
      ["process"],
    ],
    [
      "still flags references in an if alternate when the test is false while undeclared",
      "() => { if (typeof process !== 'undefined') { return 1; } else { return process.env.FOO; } }",
      ["process"],
    ],
    [
      "does not flag references after an early return guarded by typeof",
      "() => { if (typeof process === 'undefined') return; return process.env.FOO; }",
      [],
    ],
    [
      "does not flag references after an early throw in a block guarded by typeof",
      "() => { if (typeof process > 'u') { log('missing'); throw new Error('no process'); } return process.env.FOO; }",
      ["log"],
    ],
    [
      "does not flag references after an early break in a switch case guarded by typeof",
      "(k) => { switch (k) { case 1: if (typeof process > 'u') break; process.exit(1); } }",
      [],
    ],
    [
      "does not flag references after an early continue in a loop guarded by typeof",
      "(ks) => { for (const k of ks) { if (typeof process > 'u') continue; process.emit(k); } }",
      [],
    ],
    [
      "still flags references after an early-exit if when its test is false while undeclared",
      "() => { if (typeof process !== 'undefined') return; return process.env.FOO; }",
      ["process"],
    ],
    [
      "still flags references after an if guarded by typeof whose consequent does not always exit",
      "(c) => { if (typeof process === 'undefined') { if (c) return; } return process.env.FOO; }",
      ["process"],
    ],
    [
      "still flags references before an early return guarded by typeof",
      "() => { process.exit(1); if (typeof process === 'undefined') return; }",
      ["process"],
    ],
    [
      "still flags references outside the block that holds an early return guarded by typeof",
      "(c) => { if (c) { if (typeof process === 'undefined') return; } return process.env.FOO; }",
      ["process"],
    ],
    [
      "still flags references in a function defined inside a typeof-guarded region",
      "() => typeof process !== 'undefined' && (() => process.env)",
      ["process"],
    ],
    [
      "still flags references guarded by a negated typeof test",
      "() => { if (!(typeof process === 'undefined')) return process.env; }",
      ["process"],
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
