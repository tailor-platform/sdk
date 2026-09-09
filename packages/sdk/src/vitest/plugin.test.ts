/* eslint-disable @typescript-eslint/no-explicit-any */
import { isAbsolute, resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { createBlockPlugin, createEnvironmentPlugin } from "./plugin";

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

function importNode(specifier: string, end: number, start = 0): ImportNode {
  return { type: "ImportDeclaration", start, end, source: { value: specifier } };
}

function resolveConfig(
  plugin: ReturnType<typeof createBlockPlugin>,
  config: Record<string, unknown>,
) {
  (plugin.configResolved as any)(config);
}

function callTransform(
  plugin: ReturnType<typeof createBlockPlugin>,
  code: string,
  body: ImportNode[],
  id: string,
) {
  const parseCtx = { parse: () => ({ body }) };
  return (plugin.transform as any).call(parseCtx, code, id);
}

function applyConfig(plugin: ReturnType<typeof createEnvironmentPlugin>, userConfig: any) {
  return (plugin.config as any).call({}, userConfig);
}

describe("createBlockPlugin", () => {
  test("replaces a blocked import with a throwing statement", () => {
    const plugin = createBlockPlugin();
    const code = `import { randomUUID } from "node:crypto";`;
    const result = transformWith(
      plugin,
      code,
      [importNode("node:crypto", code.length)],
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
      [importNode("node:crypto", code.length)],
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
      [importNode("node:crypto", code.length)],
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
      [importNode("node:crypto", code.length)],
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
        importNode("@x", stmt1.length),
        importNode("node:fs", code.length, stmt1.length + sep.length),
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
      [importNode("@tailor-platform/sdk", stmt.length)],
      "/src/file.ts",
    );
    expect(result).toBeUndefined();
  });

  test.each([
    [
      "exempts test files when matched via root-relative include glob",
      "/abs/project/tests/foo.test.ts",
    ],
    [
      "skips files outside the project root (e.g. symlinked workspace deps)",
      "/abs/other/packages/sdk/dist/index.mjs",
    ],
  ])("%s", (_name, id) => {
    const plugin = createBlockPlugin();
    const root = "/abs/project";
    const code = `import { randomUUID } from "node:crypto";`;
    const result = transformWith(plugin, code, [importNode("node:crypto", code.length)], id, {
      include: ["tests/**/*.test.ts"],
      root,
    });
    expect(result).toBeUndefined();
  });

  test("skips Vite virtual / non-absolute ids (e.g. \\0..., virtual:..., bare specifiers)", () => {
    const plugin = createBlockPlugin();
    const root = "/abs/project";
    const code = `import { randomUUID } from "node:crypto";`;
    const node = importNode("node:crypto", code.length);
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
    const result = transformWith(plugin, code, [importNode("node:url", 41)], setupPath, {
      include: [],
      setupFiles: [setupPath],
    });
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
    const node = importNode("node:url", 41);
    resolveConfig(plugin, {
      root: "/",
      test: {
        include: [],
        projects: [{ test: { setupFiles: [projectSetup], globalSetup: projectGlobal } }],
      },
    });
    expect(callTransform(plugin, code, [node], projectSetup)).toBeUndefined();
    expect(callTransform(plugin, code, [node], projectGlobal)).toBeUndefined();
  });

  test("resolves per-project setup paths against the project's own root", () => {
    // When a project sets its own `test.root`, relative setupFiles must be
    // resolved against that root — not the top-level vite root — so projects
    // outside cwd correctly exempt their host files.
    const plugin = createBlockPlugin();
    const code = `import { pathToFileURL } from "node:url";\nexport const x = pathToFileURL("/x").href;`;
    const node = importNode("node:url", 41);
    resolveConfig(plugin, {
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
    // Resolved as /proj-root/host-setup.ts (NOT /top-root/host-setup.ts).
    expect(callTransform(plugin, code, [node], "/proj-root/host-setup.ts")).toBeUndefined();
  });

  test("exempts files listed in test.globalSetup (string and array forms)", () => {
    const code = `import { pathToFileURL } from "node:url";\nexport const x = pathToFileURL("/x").href;`;
    const node = importNode("node:url", 41);

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

  test("exempts test files matched only by per-project test.include patterns", () => {
    // Vitest projects can each set their own `test.include` (and root). A
    // project that uses non-default patterns — e.g. `e2e/**/*.spec.ts` under
    // a sibling project root — must still be recognised as test code, or its
    // node:* imports will be rewritten as if it were production source.
    const plugin = createBlockPlugin();
    const code = `import { randomUUID } from "node:crypto";`;
    const node = importNode("node:crypto", code.length);
    resolveConfig(plugin, {
      root: "/top-root",
      test: {
        // Top-level patterns intentionally do NOT cover the project file.
        include: ["src/**/*.test.ts"],
        projects: [
          {
            test: {
              root: "/proj-root",
              include: ["e2e/**/*.spec.ts"],
            },
          },
        ],
      },
    });
    expect(callTransform(plugin, code, [node], "/proj-root/e2e/foo.spec.ts")).toBeUndefined();
  });

  test("strips query/hash suffixes from id before path lookups", () => {
    // Vite can hand transform() ids like `file.ts?import`, `file.ts?v=hash`,
    // or `file.ts#fragment`. The exemption logic compares ids against
    // configured paths via Set membership / glob match / absolute-path check
    // — all exact-string operations that would silently miss a suffixed id
    // and re-transform a setup file, blowing up its node:* imports.
    const plugin = createBlockPlugin();
    const setupPath = "/abs/path/setup.ts";
    const code = `import { pathToFileURL } from "node:url";\nexport const x = pathToFileURL("/x").href;`;
    const node = importNode("node:url", 41);
    resolveConfig(plugin, { root: "/", test: { include: [], setupFiles: [setupPath] } });
    for (const suffix of ["?import", "?direct", "?raw", "?v=abc123", "#frag"]) {
      expect(callTransform(plugin, code, [node], setupPath + suffix)).toBeUndefined();
    }
  });
});

describe("createEnvironmentPlugin", () => {
  const ENV_VAR = "__TAILOR_RUNTIME_CONFIG";

  // The plugin seeds the config path through Vitest's `test.env` (per project
  // and at the root) rather than `process.env`, so each project's worker gets
  // its own value instead of the last one resolved winning for the whole run.
  const configEnvOf = (test: any): string | undefined => test?.env?.[ENV_VAR];
  const projectConfigEnv = (userConfig: any, index: number): string | undefined =>
    configEnvOf(userConfig.test.projects[index]?.test);

  test("rewrites top-level `environment: 'tailor-runtime'` to an absolute file path", () => {
    const plugin = createEnvironmentPlugin();
    const userConfig = { test: { environment: "tailor-runtime" } };
    const merged = applyConfig(plugin, userConfig);

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
    applyConfig(plugin, userConfig);

    expect(userConfig.test.projects[0]!.test.environment).toMatch(/environment\.mjs$/);
    // Other environments untouched.
    expect(userConfig.test.projects[1]!.test.environment).toBe("node");
  });

  test("adds the setup file only to inline projects that select tailor-runtime", () => {
    // Vitest 5 inline projects no longer inherit the root `setupFiles` this
    // hook returns, so the setup file is added per project. It must not go
    // into projects on another environment: setup.ts statically imports
    // "node:url" and fails to load where Node builtins do not resolve
    // (e.g. Vitest browser mode).
    const plugin = createEnvironmentPlugin();
    const userConfig = {
      test: {
        projects: [
          { test: { environment: "tailor-runtime", name: "unit" } },
          { test: { environment: "node", name: "e2e", setupFiles: "./e2e-setup.ts" } },
          { test: { name: "plain", setupFiles: ["./a.ts"] } },
          { plugins: [] },
          "./packages/*/vitest.config.ts",
        ],
      },
    };
    applyConfig(plugin, userConfig);

    const setupFilesOf = (index: number) =>
      (userConfig.test.projects[index] as { test?: { setupFiles?: unknown } }).test?.setupFiles;
    expect(setupFilesOf(0)).toEqual([expect.stringMatching(/setup\.mjs$/)]);
    expect(setupFilesOf(1)).toBe("./e2e-setup.ts");
    expect(setupFilesOf(2)).toEqual(["./a.ts"]);
    expect(setupFilesOf(3)).toBeUndefined();
    expect(userConfig.test.projects[4]).toBe("./packages/*/vitest.config.ts");
  });

  test("treats an inline project without its own environment as tailor-runtime when the root selects it", () => {
    // Vitest 5 no longer propagates the plugin-rewritten root `environment`
    // into projects that do not declare one, so the project would keep the
    // literal "tailor-runtime" and Vitest would try to load it as a module.
    // A string `extends` inherits from that file instead of the root, so it
    // must be left alone. Inheriting without `extends` is Vitest 5 behavior;
    // plugin-vitest4.test.ts covers the same config on Vitest 4.
    const plugin = createEnvironmentPlugin();
    const userConfig = {
      test: {
        environment: "tailor-runtime",
        projects: [
          { test: { name: "inherits" } },
          { test: { name: "opts-out" }, extends: false },
          { test: { name: "other-config" }, extends: "./other.config.mjs" },
          { test: { name: "other-env", environment: "node" } },
        ],
      },
    };
    applyConfig(plugin, userConfig);

    const projectTest = (index: number) =>
      (userConfig.test.projects[index] as { test: { environment?: unknown; setupFiles?: unknown } })
        .test;
    expect(projectTest(0).environment).toMatch(/environment\.mjs$/);
    expect(projectTest(0).setupFiles).toEqual([expect.stringMatching(/setup\.mjs$/)]);
    expect(projectTest(1).environment).toBeUndefined();
    expect(projectTest(1).setupFiles).toBeUndefined();
    expect(projectTest(2).environment).toBeUndefined();
    expect(projectTest(2).setupFiles).toBeUndefined();
    expect(projectTest(3).environment).toBe("node");
    expect(projectTest(3).setupFiles).toBeUndefined();
  });

  test("does not inject the setup file into a root config that selects another environment", () => {
    // The fallback return must stay gated on the root's own environment
    // selection: an unconditional return would force setup.ts (and its
    // static "node:url" import) onto a standalone browser-mode config.
    const plugin = createEnvironmentPlugin();
    const userConfig: { test: { environment: string; setupFiles?: string | string[] } } = {
      test: { environment: "browser" },
    };
    const merged = applyConfig(plugin, userConfig);

    expect(merged.test?.setupFiles ?? []).toEqual([]);
    expect(userConfig.test.setupFiles).toBeUndefined();
  });

  test("a sibling project re-resolving without tailor-runtime cannot disturb another project's seed", () => {
    // Vitest 5 re-executes the root config once per inline project that needs
    // its own Vite server. Each pass writes only into the config object it is
    // handed, so the "e2e" pass cannot reach the seed "unit" already carries.
    const plugin = createEnvironmentPlugin({ config: "./tailor.config.ts" });
    const firstPass: any = {
      root: "/proj",
      test: {
        projects: [
          { test: { environment: "tailor-runtime", name: "unit" } },
          { test: { environment: "node", name: "e2e" } },
        ],
      },
    };
    applyConfig(plugin, firstPass);
    expect(projectConfigEnv(firstPass, 0)).toBe(resolve("/proj", "tailor.config.ts"));

    // Re-run for the "e2e" project: named, no `projects`, non-tailor env.
    applyConfig(plugin, { root: "/proj", test: { environment: "node", name: "e2e" } });

    expect(projectConfigEnv(firstPass, 0)).toBe(resolve("/proj", "tailor.config.ts"));
  });

  test("survives Vitest re-running the config for a project whose environment is already rewritten", () => {
    // Vitest 5 re-executes the root config for inline projects that need
    // their own Vite server: `projects` is stripped and `environment` is the
    // absolute path from the first pass.
    const plugin = createEnvironmentPlugin({ config: "./tailor.config.ts" });
    const firstPass: any = {
      root: "/proj",
      test: { projects: [{ test: { environment: "tailor-runtime", name: "unit" } }] },
    };
    applyConfig(plugin, firstPass);
    const project = firstPass.test.projects[0]!.test as {
      environment: string;
      setupFiles?: string[];
    };
    expect(projectConfigEnv(firstPass, 0)).toBe(resolve("/proj", "tailor.config.ts"));

    const secondPass: any = {
      root: "/proj",
      test: { environment: project.environment, setupFiles: project.setupFiles },
    };
    const merged = applyConfig(plugin, secondPass);

    expect(configEnvOf(secondPass.test)).toBe(resolve("/proj", "tailor.config.ts"));
    expect(merged.test?.setupFiles ?? []).toEqual([]);
    expect(secondPass.test.setupFiles).toEqual([expect.stringMatching(/setup\.mjs$/)]);
  });

  test("leaves non-tailor environments untouched", () => {
    const plugin = createEnvironmentPlugin();
    const userConfig = { test: { environment: "node" } };
    applyConfig(plugin, userConfig);

    expect(userConfig.test.environment).toBe("node");
  });

  test("propagates options.config to the root test env", () => {
    const plugin = createEnvironmentPlugin({ config: "./tailor.config.ts" });
    const userConfig: any = { test: { environment: "tailor-runtime" } };
    applyConfig(plugin, userConfig);

    expect(configEnvOf(userConfig.test)).toMatch(/tailor\.config\.ts$/);
    expect(isAbsolute(configEnvOf(userConfig.test) ?? "")).toBe(true);
  });

  test("never writes the config path to process.env", () => {
    // A process-global slot is shared by every project resolved in the same
    // parent process, so the last one to resolve would win for all workers.
    const original = process.env[ENV_VAR];
    delete process.env[ENV_VAR];
    try {
      const plugin = createEnvironmentPlugin({ config: "./tailor.config.ts" });
      applyConfig(plugin, { test: { environment: "tailor-runtime" } });

      expect(process.env[ENV_VAR]).toBeUndefined();
    } finally {
      if (original === undefined) delete process.env[ENV_VAR];
      else process.env[ENV_VAR] = original;
    }
  });

  test("resolves a relative options.config against config.root, not process.cwd()", () => {
    // Vitest projects can set their own `root` (different from cwd) so a
    // bare relative options.config must be anchored to that root — otherwise
    // the env var points at a file in the wrong directory.
    const plugin = createEnvironmentPlugin({ config: "./tailor.config.ts" });
    const customRoot = "/abs/custom/project-root";
    const userConfig: any = { root: customRoot, test: { environment: "tailor-runtime" } };
    applyConfig(plugin, userConfig);

    expect(configEnvOf(userConfig.test)).toBe(`${customRoot}/tailor.config.ts`);
  });

  test("preserves an absolute options.config regardless of config.root", () => {
    // Absolute paths must pass through `resolve` unchanged so users can pin
    // a config location explicitly.
    const plugin = createEnvironmentPlugin({ config: "/abs/elsewhere/tailor.config.ts" });
    const userConfig: any = {
      root: "/abs/custom/project-root",
      test: { environment: "tailor-runtime" },
    };
    applyConfig(plugin, userConfig);

    expect(configEnvOf(userConfig.test)).toBe("/abs/elsewhere/tailor.config.ts");
  });

  test("does not set the env var when options.config is omitted", () => {
    const plugin = createEnvironmentPlugin();
    const userConfig: any = { test: { environment: "tailor-runtime" } };
    applyConfig(plugin, userConfig);

    expect(configEnvOf(userConfig.test)).toBeUndefined();
  });

  test("blanks the env var when the root selects another environment", () => {
    // Setting an empty value rather than omitting the key: a stale value
    // inherited from an outer config must be overridden, not left standing.
    const plugin = createEnvironmentPlugin({ config: "./tailor.config.ts" });
    const userConfig: any = { test: { environment: "node" } };
    applyConfig(plugin, userConfig);

    expect(configEnvOf(userConfig.test)).toBe("");
  });

  test("preserves a user-provided test.env alongside the config path", () => {
    const plugin = createEnvironmentPlugin({ config: "./tailor.config.ts" });
    const userConfig: any = {
      test: { environment: "tailor-runtime", env: { MY_FLAG: "1" } },
    };
    applyConfig(plugin, userConfig);

    expect(userConfig.test.env.MY_FLAG).toBe("1");
    expect(configEnvOf(userConfig.test)).toMatch(/tailor\.config\.ts$/);
  });

  test("seeds each tailor-runtime project from its own root", () => {
    // The config path is a per-project value: two projects with distinct
    // roots must each resolve their own config, not share one global slot.
    const plugin = createEnvironmentPlugin({ config: "./tailor.config.ts" });
    const userConfig: any = {
      test: {
        projects: [
          { test: { environment: "tailor-runtime", name: "a", root: "/abs/app-a" } },
          { test: { environment: "tailor-runtime", name: "b", root: "/abs/app-b" } },
        ],
      },
    };
    applyConfig(plugin, userConfig);

    expect(projectConfigEnv(userConfig, 0)).toBe("/abs/app-a/tailor.config.ts");
    expect(projectConfigEnv(userConfig, 1)).toBe("/abs/app-b/tailor.config.ts");
  });

  test("blanks the env var on projects that select another environment", () => {
    const plugin = createEnvironmentPlugin({ config: "./tailor.config.ts" });
    const userConfig: any = {
      test: {
        projects: [
          { test: { environment: "node", name: "e2e" } },
          { test: { environment: "tailor-runtime", name: "unit" } },
        ],
      },
    };
    applyConfig(plugin, userConfig);

    expect(projectConfigEnv(userConfig, 0)).toBe("");
    expect(isAbsolute(projectConfigEnv(userConfig, 1) ?? "")).toBe(true);
  });

  test("normalizes a user-provided string setupFiles into an array", () => {
    const plugin = createEnvironmentPlugin();
    const userConfig = {
      test: { environment: "tailor-runtime", setupFiles: "./user-setup.ts" },
    };
    applyConfig(plugin, userConfig);

    // Vite's array-concat merge needs both sides as arrays so the user's
    // string form is not replaced by ours.
    expect(userConfig.test.setupFiles).toEqual(["./user-setup.ts"]);
  });

  test("leaves a user-provided array setupFiles untouched", () => {
    const plugin = createEnvironmentPlugin();
    const original = ["./a.ts", "./b.ts"];
    const userConfig = { test: { environment: "tailor-runtime", setupFiles: original } };
    applyConfig(plugin, userConfig);

    // Plugin should not duplicate or reorder user entries; Vite concatenates
    // the user array with our returned [setupPath] at merge time.
    expect(userConfig.test.setupFiles).toBe(original);
  });
});
