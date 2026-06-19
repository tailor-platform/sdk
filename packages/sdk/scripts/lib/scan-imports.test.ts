import { describe, expect, test } from "vitest";
import { extractImportSpecifiers } from "./scan-imports.js";

describe("extractImportSpecifiers", () => {
  test("collects static imports, re-exports, and side-effect imports", () => {
    const src = [
      `import a from "mod-a";`,
      `import { b } from "mod-b";`,
      `import type { C } from "mod-c";`,
      `export { d } from "mod-d";`,
      `export * from "mod-e";`,
      `import "mod-side-effect";`,
    ].join("\n");
    expect(extractImportSpecifiers(src)).toEqual([
      "mod-a",
      "mod-b",
      "mod-c",
      "mod-d",
      "mod-e",
      "mod-side-effect",
    ]);
  });

  test("collects dynamic import() and require()", () => {
    const src = `const x = await import("dyn"); const y = require("req");`;
    expect(extractImportSpecifiers(src)).toEqual(["dyn", "req"]);
  });

  test("collects inline import() type references (d.mts style)", () => {
    const src = `type T = import("./chunk.mjs").Foo;`;
    expect(extractImportSpecifiers(src)).toEqual(["./chunk.mjs"]);
  });

  test("ignores a /* sequence inside a string literal (no swallowed imports)", () => {
    const src = [`const glob = "packages/*";`, `import { real } from "./real";`].join("\n");
    expect(extractImportSpecifiers(src)).toEqual(["./real"]);
  });

  test("ignores import-like text inside a string literal", () => {
    const src = `const help = "run: import { x } from \\"./example\\"";`;
    expect(extractImportSpecifiers(src)).toEqual([]);
  });

  test("ignores import-like text inside template literals", () => {
    const src = 'const tpl = `import { x } from "./tpl-example"`;';
    expect(extractImportSpecifiers(src)).toEqual([]);
  });

  test("ignores imports inside line and block comments", () => {
    const src = [
      `// import { x } from "./line-comment";`,
      `/* import { y } from "./block-comment"; */`,
      `import { z } from "./kept";`,
    ].join("\n");
    expect(extractImportSpecifiers(src)).toEqual(["./kept"]);
  });

  test("does not treat object property named from as a specifier", () => {
    const src = `const o = { from: "not-a-module" };`;
    expect(extractImportSpecifiers(src)).toEqual([]);
  });
});
