/* eslint-disable @typescript-eslint/no-explicit-any */
import { isAbsolute } from "node:path";
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

  test("emitted throw statement is syntactically valid JS even when the message contains quotes", () => {
    // getBlockedMessage embeds the specifier inside double quotes
    // (`"node:crypto" is not available...`). Regression guard for the
    // JSON.stringify-based escape: a naive `replace(/"/g, '\\"')` would still
    // produce valid code here, but a missing escape would not. Verifying that
    // the result parses as a statement protects against future message
    // changes (e.g. backslashes, newlines, control chars).
    const plugin = createBlockPlugin();
    const code = `import { randomUUID } from "node:crypto";`;
    const result = transformWith(
      plugin,
      code,
      [{ type: "ImportDeclaration", start: 0, end: code.length, source: { value: "node:crypto" } }],
      "/src/file.ts",
    );
    expect(() => new Function(result.code)).not.toThrow();
    // The escaped specifier must appear inside the literal so the runtime
    // error message is helpful.
    expect(result.code).toContain('\\"node:crypto\\"');
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

  test("falls back to plain throw when a re-export name is a reserved word (e.g. `as delete`)", () => {
    // `export { x as delete } from "node:crypto"` is valid ES syntax (export
    // names accept any IdentifierName), but `export const delete = ...` is
    // a syntax error (binding names cannot be reserved words). The plugin
    // must detect that and emit a plain `throw` so the transformed module
    // still parses.
    const plugin = createBlockPlugin();
    const code = `export { x as delete } from "node:crypto";`;
    const result = transformWith(
      plugin,
      code,
      [
        {
          type: "ExportNamedDeclaration",
          start: 0,
          end: code.length,
          source: { value: "node:crypto" },
          specifiers: [{ type: "ExportSpecifier", exported: { name: "delete" } }],
        },
      ],
      "/src/file.ts",
    );
    expect(result.code).toMatch(/^throw new Error\(/);
    // The whole replacement must parse as a top-level statement.
    expect(() => new Function(result.code)).not.toThrow();
  });

  test("falls back to plain throw when ANY re-export name in a group is a reserved word", () => {
    // Mixed safe/unsafe names: even though `foo` could be stubbed, emitting
    // `export const foo = ...; export const delete = ...;` would still fail
    // to parse. The plugin must bail to a plain throw for the whole group.
    const plugin = createBlockPlugin();
    const code = `export { foo, x as delete } from "node:crypto";`;
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
            { type: "ExportSpecifier", exported: { name: "delete" } },
          ],
        },
      ],
      "/src/file.ts",
    );
    expect(result.code).toMatch(/^throw new Error\(/);
    expect(result.code).not.toContain("export const foo");
    expect(() => new Function(result.code)).not.toThrow();
  });

  test("falls back to plain throw for `export * as <reserved>` re-exports", () => {
    const plugin = createBlockPlugin();
    const code = `export * as delete from "node:crypto";`;
    const result = transformWith(
      plugin,
      code,
      [
        {
          type: "ExportAllDeclaration",
          start: 0,
          end: code.length,
          source: { value: "node:crypto" },
          exported: { name: "delete" },
        },
      ],
      "/src/file.ts",
    );
    expect(result.code).toMatch(/^throw new Error\(/);
    expect(() => new Function(result.code)).not.toThrow();
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

  test("skips Vite virtual / non-absolute ids (e.g. \\0..., virtual:..., bare specifiers)", () => {
    const plugin = createBlockPlugin();
    const root = "/abs/project";
    const code = `import { randomUUID } from "node:crypto";`;
    const node = {
      type: "ImportDeclaration" as const,
      start: 0,
      end: code.length,
      source: { value: "node:crypto" },
    };
    for (const id of ["\0vite/preload-helper.js", "virtual:my-mod", "vite/dist/client/env.mjs"]) {
      const result = transformWith(plugin, code, [node], id, {
        include: ["tests/**/*.test.ts"],
        root,
      });
      expect(result).toBeUndefined();
    }
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

  test("exempts per-project setupFiles / globalSetup (Vitest projects)", () => {
    // Regression guard: Vitest `test.projects[i].test.setupFiles` and
    // `test.projects[i].test.globalSetup` also run in the host runner, not
    // the emulated runtime. They must be exempt from the node:* transform.
    const plugin = createBlockPlugin();
    const projectSetup = "/abs/path/project/setup.ts";
    const projectGlobal = "/abs/path/project/global-setup.ts";
    const code = `import { pathToFileURL } from "node:url";\nexport const x = pathToFileURL("/x").href;`;
    const node = {
      type: "ImportDeclaration" as const,
      start: 0,
      end: 41,
      source: { value: "node:url" },
    };
    (plugin.configResolved as any)({
      root: "/",
      test: {
        include: [],
        projects: [{ test: { setupFiles: [projectSetup], globalSetup: projectGlobal } }],
      },
    });
    const parseCtx = { parse: () => ({ body: [node] }) };
    expect((plugin.transform as any).call(parseCtx, code, projectSetup)).toBeUndefined();
    expect((plugin.transform as any).call(parseCtx, code, projectGlobal)).toBeUndefined();
  });

  test("resolves per-project setup paths against the project's own root", () => {
    // When a project sets its own `test.root`, relative setupFiles must be
    // resolved against that root — not the top-level vite root — so projects
    // outside cwd correctly exempt their host files.
    const plugin = createBlockPlugin();
    const code = `import { pathToFileURL } from "node:url";\nexport const x = pathToFileURL("/x").href;`;
    const node = {
      type: "ImportDeclaration" as const,
      start: 0,
      end: 41,
      source: { value: "node:url" },
    };
    (plugin.configResolved as any)({
      root: "/top-root",
      test: {
        include: [],
        projects: [
          {
            test: {
              root: "/proj-root",
              setupFiles: ["./host-setup.ts"],
            },
          },
        ],
      },
    });
    const parseCtx = { parse: () => ({ body: [node] }) };
    // Resolved as /proj-root/host-setup.ts (NOT /top-root/host-setup.ts).
    expect(
      (plugin.transform as any).call(parseCtx, code, "/proj-root/host-setup.ts"),
    ).toBeUndefined();
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
    expect(isAbsolute(process.env[ENV_VAR] ?? "")).toBe(true);
  });

  test("resolves a relative options.config against config.root, not process.cwd()", () => {
    // Vitest projects can set their own `root` (different from cwd) so a
    // bare relative options.config must be anchored to that root — otherwise
    // the env var points at a file in the wrong directory.
    const plugin = createEnvironmentPlugin({ config: "./tailor.config.ts" });
    const customRoot = "/abs/custom/project-root";
    (plugin.config as any).call({}, { root: customRoot, test: { environment: "tailor-runtime" } });

    expect(process.env[ENV_VAR]).toBe(`${customRoot}/tailor.config.ts`);
  });

  test("preserves an absolute options.config regardless of config.root", () => {
    // Absolute paths must pass through `resolve` unchanged so users can pin
    // a config location explicitly.
    const plugin = createEnvironmentPlugin({ config: "/abs/elsewhere/tailor.config.ts" });
    (plugin.config as any).call(
      {},
      { root: "/abs/custom/project-root", test: { environment: "tailor-runtime" } },
    );

    expect(process.env[ENV_VAR]).toBe("/abs/elsewhere/tailor.config.ts");
  });

  test("does not set the env var when options.config is omitted", () => {
    const plugin = createEnvironmentPlugin();
    (plugin.config as any).call({}, { test: { environment: "tailor-runtime" } });

    expect(process.env[ENV_VAR]).toBeUndefined();
  });

  test("does not set the env var when no project selects tailor-runtime (avoid leaking config across projects)", () => {
    const plugin = createEnvironmentPlugin({ config: "./tailor.config.ts" });
    // Even with options.config, the env var must not be set if the user only
    // configured non-tailor environments — otherwise it would leak into
    // unrelated projects/runs sharing the same parent process.
    (plugin.config as any).call({}, { test: { environment: "node" } });

    expect(process.env[ENV_VAR]).toBeUndefined();
  });

  test("clears a pre-existing env var when opting out (no tailor-runtime selection)", () => {
    process.env[ENV_VAR] = "/old/stale/path.ts";

    const plugin = createEnvironmentPlugin({ config: "./tailor.config.ts" });
    (plugin.config as any).call({}, { test: { environment: "node" } });

    // Stale value from a prior watch-mode iteration must not survive.
    expect(process.env[ENV_VAR]).toBeUndefined();
  });

  test("clears a pre-existing env var when options.config is omitted", () => {
    process.env[ENV_VAR] = "/old/stale/path.ts";

    const plugin = createEnvironmentPlugin();
    (plugin.config as any).call({}, { test: { environment: "tailor-runtime" } });

    expect(process.env[ENV_VAR]).toBeUndefined();
  });

  test("sets the env var when at least one project selects tailor-runtime", () => {
    const plugin = createEnvironmentPlugin({ config: "./tailor.config.ts" });
    (plugin.config as any).call(
      {},
      {
        test: {
          projects: [
            { test: { environment: "node", name: "e2e" } },
            { test: { environment: "tailor-runtime", name: "unit" } },
          ],
        },
      },
    );

    expect(process.env[ENV_VAR]).toBeDefined();
    expect(isAbsolute(process.env[ENV_VAR] ?? "")).toBe(true);
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
