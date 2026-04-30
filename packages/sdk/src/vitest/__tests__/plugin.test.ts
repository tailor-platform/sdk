/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createBlockPlugin, createEnvironmentPlugin } from "../plugin";

type ImportNode = {
  type: "ImportDeclaration" | "ExportNamedDeclaration" | "ExportAllDeclaration";
  start: number;
  end: number;
  source: { value: string } | null;
  specifiers?: Array<{ type?: string; exported?: { name: string } | null }>;
  exported?: { name: string } | null;
};

function transformWith(
  plugin: ReturnType<typeof createBlockPlugin>,
  code: string,
  body: ImportNode[],
  id: string,
  testConfig: { include?: string[]; setupFiles?: string | string[]; root?: string } = {
    include: [],
  },
) {
  const parseCtx = { parse: () => ({ body }) };
  const root = testConfig.root ?? "/";
  (plugin.configResolved as any)({ root, test: { ...testConfig, root } });
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

  test("rewrites named re-exports to per-binding stub exports", () => {
    const plugin = createBlockPlugin();
    const code = `export { foo, bar as baz } from "node:crypto";`;
    const result = transformWith(
      plugin,
      code,
      [
        {
          type: "ExportNamedDeclaration",
          start: 0,
          end: code.length,
          source: { value: "node:crypto" },
          specifiers: [
            { type: "ExportSpecifier", exported: { name: "foo" } },
            { type: "ExportSpecifier", exported: { name: "baz" } },
          ],
        },
      ],
      "/src/file.ts",
    );
    expect(result.code).toMatch(/export const foo = \(\(\) => \{ throw new Error\(/);
    expect(result.code).toMatch(/export const baz = \(\(\) => \{ throw new Error\(/);
    expect(result.code).not.toContain("bar");
  });

  test("rewrites default re-export to a default-stub export", () => {
    const plugin = createBlockPlugin();
    const code = `export { default } from "node:crypto";`;
    const result = transformWith(
      plugin,
      code,
      [
        {
          type: "ExportNamedDeclaration",
          start: 0,
          end: code.length,
          source: { value: "node:crypto" },
          specifiers: [{ type: "ExportSpecifier", exported: { name: "default" } }],
        },
      ],
      "/src/file.ts",
    );
    expect(result.code).toMatch(/export default \(\(\) => \{ throw new Error\(/);
  });

  test("rewrites namespaced re-export `export * as ns` to a stub export", () => {
    const plugin = createBlockPlugin();
    const code = `export * as crypto from "node:crypto";`;
    const result = transformWith(
      plugin,
      code,
      [
        {
          type: "ExportAllDeclaration",
          start: 0,
          end: code.length,
          source: { value: "node:crypto" },
          exported: { name: "crypto" },
        },
      ],
      "/src/file.ts",
    );
    expect(result.code).toMatch(/export const crypto = \(\(\) => \{ throw new Error\(/);
  });

  test("falls back to throw for bare `export *` re-exports (no enumerable bindings)", () => {
    const plugin = createBlockPlugin();
    const code = `export * from "node:crypto";`;
    const result = transformWith(
      plugin,
      code,
      [
        {
          type: "ExportAllDeclaration",
          start: 0,
          end: code.length,
          source: { value: "node:crypto" },
          exported: null,
        },
      ],
      "/src/file.ts",
    );
    expect(result.code).toMatch(/^throw new Error\(/);
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

  test("exempts test files when matched via root-relative include glob", () => {
    const plugin = createBlockPlugin();
    const root = "/abs/project";
    const testFile = "/abs/project/tests/foo.test.ts";
    const code = `import { randomUUID } from "node:crypto";`;
    const result = transformWith(
      plugin,
      code,
      [{ type: "ImportDeclaration", start: 0, end: code.length, source: { value: "node:crypto" } }],
      testFile,
      { include: ["tests/**/*.test.ts"], root },
    );
    expect(result).toBeUndefined();
  });

  test("skips files outside the project root (e.g. symlinked workspace deps)", () => {
    const plugin = createBlockPlugin();
    const root = "/abs/project";
    const externalId = "/abs/other/packages/sdk/dist/index.mjs";
    const code = `import { randomUUID } from "node:crypto";`;
    const result = transformWith(
      plugin,
      code,
      [{ type: "ImportDeclaration", start: 0, end: code.length, source: { value: "node:crypto" } }],
      externalId,
      { include: ["tests/**/*.test.ts"], root },
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

  test("exempts files listed in test.globalSetup (string and array forms)", () => {
    const code = `import { pathToFileURL } from "node:url";\nexport const x = pathToFileURL("/x").href;`;
    const node = {
      type: "ImportDeclaration" as const,
      start: 0,
      end: 41,
      source: { value: "node:url" },
    };

    const stringForm = createBlockPlugin();
    const stringPath = "/abs/path/global-setup.ts";
    const stringResult = transformWith(stringForm, code, [node], stringPath, {
      include: [],
      // Cast: `transformWith` only types known fields, but plugin reads globalSetup.
      ...({ globalSetup: stringPath } as any),
    });
    expect(stringResult).toBeUndefined();

    const arrayForm = createBlockPlugin();
    const arrayPath = "/abs/path/global-setup-2.ts";
    const arrayResult = transformWith(arrayForm, code, [node], arrayPath, {
      include: [],
      ...({ globalSetup: [arrayPath] } as any),
    });
    expect(arrayResult).toBeUndefined();
  });
});

describe("createEnvironmentPlugin", () => {
  const ENV_VAR = "__TAILOR_RUNTIME_CONFIG";
  let originalConfig: string | undefined;

  beforeEach(() => {
    originalConfig = process.env[ENV_VAR];
    delete process.env[ENV_VAR];
  });

  afterEach(() => {
    if (originalConfig === undefined) delete process.env[ENV_VAR];
    else process.env[ENV_VAR] = originalConfig;
  });

  test("rewrites top-level `environment: 'tailor-runtime'` to an absolute file path", () => {
    const plugin = createEnvironmentPlugin();
    const userConfig = { test: { environment: "tailor-runtime" } };
    const merged = (plugin.config as any).call({}, userConfig);

    expect(userConfig.test.environment).toMatch(/environment\.mjs$/);
    expect(merged.test.setupFiles).toHaveLength(1);
    expect(merged.test.setupFiles[0]).toMatch(/setup\.mjs$/);
  });

  test("rewrites per-project `environment: 'tailor-runtime'` to an absolute file path", () => {
    const plugin = createEnvironmentPlugin();
    const userConfig = {
      test: {
        projects: [
          { test: { environment: "tailor-runtime", name: "unit" } },
          { test: { environment: "node", name: "e2e" } },
        ],
      },
    };
    (plugin.config as any).call({}, userConfig);

    expect(userConfig.test.projects[0].test.environment).toMatch(/environment\.mjs$/);
    // Other environments untouched.
    expect(userConfig.test.projects[1].test.environment).toBe("node");
  });

  test("leaves non-tailor environments untouched", () => {
    const plugin = createEnvironmentPlugin();
    const userConfig = { test: { environment: "node" } };
    (plugin.config as any).call({}, userConfig);

    expect(userConfig.test.environment).toBe("node");
  });

  test("propagates options.config to process.env.__TAILOR_RUNTIME_CONFIG", () => {
    const plugin = createEnvironmentPlugin({ config: "./tailor.config.ts" });
    (plugin.config as any).call({}, { test: { environment: "tailor-runtime" } });

    expect(process.env[ENV_VAR]).toBeDefined();
    expect(process.env[ENV_VAR]).toMatch(/tailor\.config\.ts$/);
    // Resolved to an absolute path.
    expect(process.env[ENV_VAR]?.startsWith("/")).toBe(true);
  });

  test("does not set the env var when options.config is omitted", () => {
    const plugin = createEnvironmentPlugin();
    (plugin.config as any).call({}, { test: { environment: "tailor-runtime" } });

    expect(process.env[ENV_VAR]).toBeUndefined();
  });

  test("normalizes a user-provided string setupFiles into an array", () => {
    const plugin = createEnvironmentPlugin();
    const userConfig = {
      test: { environment: "tailor-runtime", setupFiles: "./user-setup.ts" },
    };
    (plugin.config as any).call({}, userConfig);

    // Vite's array-concat merge needs both sides as arrays so the user's
    // string form is not replaced by ours.
    expect(userConfig.test.setupFiles).toEqual(["./user-setup.ts"]);
  });

  test("leaves a user-provided array setupFiles untouched", () => {
    const plugin = createEnvironmentPlugin();
    const original = ["./a.ts", "./b.ts"];
    const userConfig = { test: { environment: "tailor-runtime", setupFiles: original } };
    (plugin.config as any).call({}, userConfig);

    // Plugin should not duplicate or reorder user entries; Vite concatenates
    // the user array with our returned [setupPath] at merge time.
    expect(userConfig.test.setupFiles).toBe(original);
  });
});
