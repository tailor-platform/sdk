import { describe, expect, test } from "vitest";
import { stripDeadNodeBuiltinImports } from "./strip-dead-node-imports.js";

describe("stripDeadNodeBuiltinImports", () => {
  test("removes an unused named import from a node: builtin", () => {
    const src = [
      `import { createRequire } from "node:module";`,
      ``,
      `var __defProp = Object.defineProperty;`,
      `var __exportAll = (all, no_symbols) => {};`,
      ``,
      `export { __exportAll as t };`,
      ``,
    ].join("\n");

    expect(stripDeadNodeBuiltinImports(src)).toBe(
      [
        ``,
        `var __defProp = Object.defineProperty;`,
        `var __exportAll = (all, no_symbols) => {};`,
        ``,
        `export { __exportAll as t };`,
        ``,
      ].join("\n"),
    );
  });

  test("keeps the import when the binding is referenced elsewhere in the file", () => {
    const src = [
      `import { createRequire } from "node:module";`,
      ``,
      `const require = createRequire(import.meta.url);`,
      ``,
    ].join("\n");

    expect(stripDeadNodeBuiltinImports(src)).toBe(src);
  });
});
