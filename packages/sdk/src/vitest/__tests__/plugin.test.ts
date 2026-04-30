/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, test } from "vitest";
import { createBlockPlugin } from "../plugin";

type ImportNode = {
  type: "ImportDeclaration" | "ExportNamedDeclaration" | "ExportAllDeclaration";
  start: number;
  end: number;
  source: { value: string } | null;
};

function transformWith(
  plugin: ReturnType<typeof createBlockPlugin>,
  code: string,
  body: ImportNode[],
  id: string,
  testConfig: { include?: string[]; setupFiles?: string | string[] } = { include: [] },
) {
  const parseCtx = { parse: () => ({ body }) };
  (plugin.configResolved as any)({ test: testConfig });
  return (plugin.transform as any).call(parseCtx, code, id);
}

describe("createBlockPlugin", () => {
  test("replaces a blocked import with a throwing statement", () => {
    const plugin = createBlockPlugin();
    const code = `import { randomUUID } from "node:crypto";`;
    const result = transformWith(
      plugin,
      code,
      [{ type: "ImportDeclaration", start: 0, end: code.length, source: { value: "node:crypto" } }],
      "/src/file.ts",
    );
    expect(result.code).toMatch(/throw new Error\(/);
    expect(result.code).not.toContain('"node:crypto"');
  });

  test("only replaces the blocked import when mixed with allowed declarations", () => {
    const plugin = createBlockPlugin();
    const stmt1 = `import { foo } from "@tailor-platform/sdk";`;
    const middle = `\n\nexport const config = { version: 1 };\n\n`;
    const stmt2 = `import { randomUUID } from "node:crypto";`;
    const code = stmt1 + middle + stmt2;
    const result = transformWith(
      plugin,
      code,
      [
        {
          type: "ImportDeclaration",
          start: 0,
          end: stmt1.length,
          source: { value: "@tailor-platform/sdk" },
        },
        {
          type: "ImportDeclaration",
          start: stmt1.length + middle.length,
          end: code.length,
          source: { value: "node:crypto" },
        },
      ],
      "/src/file.ts",
    );
    expect(result.code).toContain("export const config = { version: 1 };");
    expect(result.code).toContain('import { foo } from "@tailor-platform/sdk"');
    expect(result.code).toMatch(/throw new Error\(/);
  });

  test("preserves multi-line spans of a blocked import declaration", () => {
    const plugin = createBlockPlugin();
    const code = `import {
  randomUUID,
  randomBytes,
} from "node:crypto";`;
    const result = transformWith(
      plugin,
      code,
      [{ type: "ImportDeclaration", start: 0, end: code.length, source: { value: "node:crypto" } }],
      "/src/file.ts",
    );
    expect(result.code).toMatch(/throw new Error\(/);
    expect(result.code).not.toContain("randomUUID");
  });

  test("handles re-exports from blocked modules", () => {
    const plugin = createBlockPlugin();
    const code = `export { foo } from "node:crypto";`;
    const result = transformWith(
      plugin,
      code,
      [
        {
          type: "ExportNamedDeclaration",
          start: 0,
          end: code.length,
          source: { value: "node:crypto" },
        },
      ],
      "/src/file.ts",
    );
    expect(result.code).toMatch(/throw new Error\(/);
  });

  test("handles bare imports of blocked modules", () => {
    const plugin = createBlockPlugin();
    const code = `import "node:crypto";`;
    const result = transformWith(
      plugin,
      code,
      [{ type: "ImportDeclaration", start: 0, end: code.length, source: { value: "node:crypto" } }],
      "/src/file.ts",
    );
    expect(result.code).toMatch(/throw new Error\(/);
  });

  test("replaces the correct span when multiple imports share a line", () => {
    const plugin = createBlockPlugin();
    const stmt1 = `import { a } from "@x";`;
    const sep = ` `;
    const stmt2 = `import { b } from "node:fs";`;
    const code = stmt1 + sep + stmt2;
    const result = transformWith(
      plugin,
      code,
      [
        { type: "ImportDeclaration", start: 0, end: stmt1.length, source: { value: "@x" } },
        {
          type: "ImportDeclaration",
          start: stmt1.length + sep.length,
          end: code.length,
          source: { value: "node:fs" },
        },
      ],
      "/src/file.ts",
    );
    expect(result.code).toContain('import { a } from "@x"');
    expect(result.code).toMatch(/throw new Error\(/);
  });

  test("does not transform when no blocked imports are present", () => {
    const plugin = createBlockPlugin();
    const stmt = `import { foo } from "@tailor-platform/sdk";`;
    const code = `${stmt}\nexport const x = 1;`;
    const result = transformWith(
      plugin,
      code,
      [
        {
          type: "ImportDeclaration",
          start: 0,
          end: stmt.length,
          source: { value: "@tailor-platform/sdk" },
        },
      ],
      "/src/file.ts",
    );
    expect(result).toBeUndefined();
  });

  test("exempts files listed in test.setupFiles", () => {
    const plugin = createBlockPlugin();
    const setupPath = "/abs/path/setup.ts";
    const code = `import { pathToFileURL } from "node:url";\nexport const x = pathToFileURL("/x").href;`;
    const result = transformWith(
      plugin,
      code,
      [
        {
          type: "ImportDeclaration",
          start: 0,
          end: 41,
          source: { value: "node:url" },
        },
      ],
      setupPath,
      { include: [], setupFiles: [setupPath] },
    );
    expect(result).toBeUndefined();
  });
});
