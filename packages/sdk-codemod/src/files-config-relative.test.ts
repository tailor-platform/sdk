import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { aroundEach, describe, expect, test, vi } from "vitest";
import transform, { reviewFindings } from "../codemods/v3/files-config-relative/scripts/transform";
import { getApplicableCodemods } from "./registry";
import { runCodemods } from "./runner";

vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof fs>();
  return { ...original, globSync: vi.fn(original.globSync) };
});

const IMPORT = 'import { defineConfig } from "@tailor-platform/sdk";\n';
const CONFIG_PATH = "apps/a/tailor.config.ts";

describe("files patterns -> config-relative migration", () => {
  let root: string;

  aroundEach(async (runTest) => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "files-config-relative-")));
    try {
      await runTest();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  function writeFile(relativePath: string, content: string): void {
    const file = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }

  function writeFiles(...relativePaths: string[]): void {
    for (const relativePath of relativePaths) writeFile(relativePath, "");
  }

  async function migrate(body: string, configPath = CONFIG_PATH) {
    const source = IMPORT + body;
    const absolute = path.join(root, configPath);
    const findings = await reviewFindings(source, absolute, configPath, root);
    return {
      transformed: await transform(source, absolute, root),
      findings: findings.map((finding) => finding.message),
    };
  }

  test("rebases `files`, `!` patterns, and `ignores` that match only from the project directory", async () => {
    writeFiles("apps/a/tailordb/user.ts", "apps/a/executors/run.ts");

    const { transformed, findings } = await migrate(
      [
        "export default defineConfig({",
        '  db: { main: { files: ["apps/a/tailordb/*.ts", "!apps/a/tailordb/draft.ts"], ignores: ["apps/a/tailordb/*.spec.ts"] } },',
        "  executor: { files: ['./apps/a/executors/*.ts', \"/elsewhere/*.ts\"] },",
        "});",
        "",
      ].join("\n"),
    );

    expect(transformed).toBe(
      IMPORT +
        [
          "export default defineConfig({",
          '  db: { main: { files: ["tailordb/*.ts", "!tailordb/draft.ts"], ignores: ["tailordb/*.spec.ts"] } },',
          "  executor: { files: ['./executors/*.ts', \"/elsewhere/*.ts\"] },",
          "});",
          "",
        ].join("\n"),
    );
    expect(findings).toEqual([]);
  });

  test.each([
    ["apps/*/tailordb/*.ts", "../*/tailordb/*.ts"],
    ["./apps/*/tailordb/*.ts", "../*/tailordb/*.ts"],
    ["**/a/tailordb/*.ts", "../../**/a/tailordb/*.ts"],
    ["./apps/b/../a/tailordb/*.ts", "./tailordb/*.ts"],
  ])("rebases %s to %s", async (pattern, rebased) => {
    writeFiles("apps/a/tailordb/user.ts");

    const { transformed } = await migrate(
      `export default defineConfig({\n  db: { main: { files: ["${pattern}"] } },\n});\n`,
    );

    expect(transformed).toContain(`files: ["${rebased}"]`);
  });

  test("writes the config's own directory as `.`", async () => {
    writeFiles("apps/a/tailordb/user.ts");

    const { transformed } = await migrate(
      'export default defineConfig({\n  db: { main: { files: ["apps/a/tailordb/*.ts", "!./apps/a"] } },\n});\n',
    );

    expect(transformed).toContain('files: ["tailordb/*.ts", "!."]');
  });

  test("keeps a rebased pattern that starts with `!` from turning into an exclusion", async () => {
    writeFiles("apps/a/!jobs/run.ts");

    const { transformed } = await migrate(
      'export default defineConfig({\n  executor: { files: ["apps/a/!jobs/*.ts", "!apps/a/!jobs/draft.ts"] },\n});\n',
    );

    expect(transformed).toContain('files: ["./!jobs/*.ts", "!./!jobs/draft.ts"]');
  });

  test.each([
    ["an export clause", "const config = %s;\nexport { config as default };\n"],
    ["`export default` of a variable", "const config = %s;\nexport default config;\n"],
    [
      "`export default` of an exported variable",
      "export const config = %s;\nexport default config;\n",
    ],
  ])("rewrites a config default-exported through %s", async (_, template) => {
    writeFiles("apps/a/tailordb/user.ts");

    const { transformed } = await migrate(
      template.replace(
        "%s",
        'defineConfig({\n  db: { main: { files: ["apps/a/tailordb/*.ts"] } },\n})',
      ),
    );

    expect(transformed).toContain('files: ["tailordb/*.ts"]');
  });

  test("rewrites only the defineConfig() call the module default-exports", async () => {
    writeFiles("apps/a/tailordb/user.ts", "apps/a/executors/run.ts");
    const fragment =
      'export const fragment = defineConfig({\n  executor: { files: ["apps/a/executors/*.ts"] },\n});\n';

    const { transformed, findings } = await migrate(
      fragment +
        'export default defineConfig({\n  db: { main: { files: ["apps/a/tailordb/*.ts"] } },\n});\n',
    );

    expect(transformed).toBe(
      IMPORT +
        fragment +
        'export default defineConfig({\n  db: { main: { files: ["tailordb/*.ts"] } },\n});\n',
    );
    expect(findings).toEqual([expect.stringContaining("not the module's default export")]);
  });

  test("reports a defineConfig() call next to an unrelated default export instead of rewriting it", async () => {
    writeFiles("apps/a/executors/run.ts");

    const { transformed, findings } = await migrate(
      'export const fragment = defineConfig({\n  executor: { files: ["apps/a/executors/*.ts"] },\n});\nexport default function helper() {}\n',
    );

    expect(transformed).toBeNull();
    expect(findings).toEqual([expect.stringContaining("not the module's default export")]);
  });

  test("does not report a defineConfig() call that is not the default export when it needs no rewrite", async () => {
    writeFiles("apps/a/executors/run.ts");

    const { transformed, findings } = await migrate(
      'export const fragment = defineConfig({\n  executor: { files: ["executors/*.ts"] },\n});\n',
    );

    expect(transformed).toBeNull();
    expect(findings).toEqual([]);
  });

  test.each([
    ["a pattern matches from the config's directory", '["tailordb/*.ts", "apps/a/executors/*.ts"]'],
    ["every positive pattern is absolute", '["/elsewhere/*.ts", "!apps/a/tailordb/draft.ts"]'],
    ["the service lists only `!` patterns", '["!apps/a/tailordb/draft.ts"]'],
  ])("leaves a service alone when %s", async (_, files) => {
    writeFiles("apps/a/tailordb/user.ts", "apps/a/executors/run.ts");

    const { transformed, findings } = await migrate(
      `export default defineConfig({\n  db: { main: { files: ${files} } },\n});\n`,
    );

    expect(transformed).toBeNull();
    expect(findings).toEqual([]);
  });

  test("reports a service instead of rewriting it when globbing fails", async () => {
    writeFiles("apps/a/tailordb/user.ts");
    using _globSync = vi.mocked(fs.globSync).mockImplementation(() => {
      throw new Error("EACCES");
    });

    const { transformed, findings } = await migrate(
      'export default defineConfig({\n  db: { main: { files: ["apps/a/tailordb/*.ts"] } },\n});\n',
    );

    expect(transformed).toBeNull();
    expect(findings).toEqual([
      expect.stringContaining('db.main.files could not be globbed: "apps/a/tailordb/*.ts"'),
    ]);
  });

  test("changes and reports nothing for a config in the project directory", async () => {
    writeFiles("apps/a/tailordb/user.ts");

    const { transformed, findings } = await migrate(
      'export default defineConfig({\n  db: { main: { files: ["missing/*.ts"] } },\n  executor: { files: executorFiles },\n});\n',
      "tailor.config.ts",
    );

    expect(transformed).toBeNull();
    expect(findings).toEqual([]);
  });

  test("leaves the result unchanged when run again", async () => {
    writeFiles("apps/a/tailordb/user.ts");
    const { transformed } = await migrate(
      'export default defineConfig({\n  db: { main: { files: ["apps/a/tailordb/*.ts"] } },\n});\n',
    );

    expect(await transform(transformed!, path.join(root, CONFIG_PATH), root)).toBeNull();
  });

  test("names the project directory it searched when no pattern matches from either directory", async () => {
    writeFiles("apps/a/tailordb/user.ts");

    const { transformed, findings } = await migrate(
      'export default defineConfig({\n  db: { main: { files: ["apps/a/missing/*.ts"] } },\n});\n',
    );

    expect(transformed).toBeNull();
    expect(findings).toEqual([
      expect.stringContaining(
        `db.main.files matches no files from this config's directory or from the project directory "${root}"`,
      ),
    ]);
  });

  test.each([
    [
      "`files` passed as a variable",
      "export default defineConfig({\n  executor: { files: executorFiles },\n});\n",
      "executor.files is not an array literal",
    ],
    [
      "a `files` entry that is not a string literal",
      "export default defineConfig({\n  executor: { files: [`apps/a/${dir}/*.ts`] },\n});\n",
      "executor.files has an entry that is not a string literal",
    ],
    [
      "`ignores` passed as a variable",
      'export default defineConfig({\n  executor: { files: ["apps/a/tailordb/*.ts"], ignores },\n});\n',
      "executor.ignores is not an array of string literals",
    ],
    [
      "a pattern written with a backslash",
      'export default defineConfig({\n  executor: { files: ["apps\\\\a\\\\tailordb\\\\*.ts"] },\n});\n',
      "executor.files has a pattern written with a backslash",
    ],
    [
      "an `ignores` pattern written with a backslash",
      'export default defineConfig({\n  executor: { files: ["apps/a/tailordb/*.ts"], ignores: ["apps\\\\a\\\\x.ts"] },\n});\n',
      "executor.ignores has a pattern written with a backslash",
    ],
    [
      "a service composed with a spread",
      "export default defineConfig({\n  workflow: { ...workflowFiles },\n});\n",
      "workflow has a spread or computed key",
    ],
    [
      "a namespace passed as a variable",
      "export default defineConfig({\n  db: { main: mainDb },\n});\n",
      "a `db` namespace is not written as an object literal",
    ],
    [
      "a config passed as a variable",
      "export default defineConfig(config);\n",
      "not an object literal",
    ],
    [
      "a module that does not default-export a config",
      'export const shared = defineConfig({\n  db: { main: { files: ["apps/a/tailordb/*.ts"] } },\n});\n',
      "not the module's default export",
    ],
    [
      "a defineConfig() call other than the default export whose patterns cannot be read",
      "export const shared = defineConfig({\n  executor: { files: executorFiles },\n});\nexport default function helper() {}\n",
      "not the module's default export",
    ],
  ])("reports %s outside the project directory", async (_, body, reason) => {
    writeFiles("apps/a/tailordb/user.ts");

    const { transformed, findings } = await migrate(body);

    expect(transformed).toBeNull();
    expect(findings).toEqual([expect.stringContaining(reason)]);
  });

  test("reports a default-exported config that a config file elsewhere re-exports instead of rewriting it", async () => {
    writeFiles("src/run.ts");
    writeFile("tailor.config.ts", 'export { default } from "./configs/shared";\n');

    const { transformed, findings } = await migrate(
      'export default defineConfig({\n  name: "app",\n  executor: { files: ["src/*.ts"] },\n});\n',
      "configs/shared.ts",
    );

    expect(transformed).toBeNull();
    expect(findings).toEqual([expect.stringContaining("`tailor.config.ts` loads this config")]);
  });

  const EXPORTED_CONFIG =
    'export const config = defineConfig({\n  db: { main: { files: ["apps/a/tailordb/*.ts"] } },\n});\nexport default config;\n';

  test.each<[string, Record<string, string>, string]>([
    [
      "re-exports the default",
      { "tailor.config.ts": 'export { default } from "./apps/a/tailor.config";\n' },
      "tailor.config.ts",
    ],
    [
      "re-exports the default under a `.js` specifier",
      { "tailor.config.ts": 'export { default as default } from "./apps/a/tailor.config.js";\n' },
      "tailor.config.ts",
    ],
    [
      "default-exports the default import",
      { "tailor.config.ts": 'import a from "./apps/a/tailor.config.ts";\nexport default a;\n' },
      "tailor.config.ts",
    ],
    [
      "exports a `{ default as … }` import as default",
      {
        "tailor.config.ts":
          'import { default as a } from "./apps/a/tailor.config";\nexport { a as default };\n',
      },
      "tailor.config.ts",
    ],
    [
      "default-exports the binding the config module default-exports",
      {
        "tailor.config.ts":
          'import { config } from "./apps/a/tailor.config";\nexport default config;\n',
      },
      "tailor.config.ts",
    ],
    [
      "spreads the default import into its own default-exported config",
      {
        "tailor.config.ts": `${IMPORT}import a from "./apps/a/tailor.config";\nexport default defineConfig({ ...a, name: "root" });\n`,
      },
      "tailor.config.ts",
    ],
    [
      "spreads the default import into a config it default-exports through a variable",
      {
        "tailor.config.ts": `${IMPORT}import a from "./apps/a/tailor.config";\nconst config = defineConfig({ ...a, name: "root" });\nexport default config;\n`,
      },
      "tailor.config.ts",
    ],
    [
      "default-exports what a barrel re-exports under another name",
      {
        "configs/index.ts": 'export { default as a } from "../apps/a/tailor.config";\n',
        "tailor.config.ts": 'import { a } from "./configs";\nexport default a;\n',
      },
      "tailor.config.ts",
    ],
    [
      "default-exports what a barrel imports and exports by name",
      {
        "configs/all.ts": 'import shared from "../apps/a/tailor.config";\nexport { shared };\n',
        "tailor.config.ts": 'import { shared } from "./configs/all";\nexport default shared;\n',
      },
      "tailor.config.ts",
    ],
    [
      "re-exports an index module in the config's directory that re-exports it",
      {
        "apps/a/index.ts": 'export { default } from "./tailor.config";\n',
        "tailor.config.ts": 'export { default } from "./apps/a";\n',
      },
      "tailor.config.ts",
    ],
  ])("reports a config that a config file elsewhere %s", async (_, importers, loader) => {
    writeFiles("apps/a/tailordb/user.ts");
    for (const [importerPath, importer] of Object.entries(importers)) {
      writeFile(importerPath, importer);
    }

    const { transformed, findings } = await migrate(EXPORTED_CONFIG);

    expect(transformed).toBeNull();
    expect(findings).toEqual([expect.stringContaining(`\`${loader}\` loads this config`)]);
  });

  test("reports an index module that a config file elsewhere re-exports by its directory", async () => {
    writeFiles("apps/a/tailordb/user.ts");
    writeFile("tailor.config.ts", 'export { default } from "./apps/a";\n');

    const { transformed, findings } = await migrate(EXPORTED_CONFIG, "apps/a/index.ts");

    expect(transformed).toBeNull();
    expect(findings).toEqual([expect.stringContaining("`tailor.config.ts` loads this config")]);
  });

  test.each<[string, Record<string, string>]>([
    [
      "a resolver imports a named export",
      {
        "apps/b/resolvers/user.ts":
          'import { auth } from "../../a/tailor.config";\nexport default createResolver({ auth });\n',
      },
    ],
    [
      "a resolver default-imports the config for something other than its default export",
      {
        "apps/a/resolvers/user.ts":
          'import config from "../tailor.config";\nexport default createResolver({ body: () => config.name });\n',
      },
    ],
    [
      "a test default-imports the config without a default export of its own",
      {
        "apps/a/tests/config.test.ts":
          'import config from "../tailor.config";\ntest("config", () => expect(config).toBeDefined());\n',
      },
    ],
    [
      "a module re-exports only its type",
      { "tailor.config.ts": 'export type { default } from "./apps/a/tailor.config";\n' },
    ],
    [
      "a module re-exports the default as a type",
      { "tailor.config.ts": 'export { type default } from "./apps/a/tailor.config";\n' },
    ],
    [
      "a module default-exports a type-only default import",
      { "tailor.config.ts": 'import type a from "./apps/a/tailor.config";\nexport default a;\n' },
    ],
    [
      "a module default-exports a type-only named import",
      {
        "tailor.config.ts":
          'import { type config } from "./apps/a/tailor.config";\nexport default config;\n',
      },
    ],
    [
      "a module re-exports `*`, which leaves out the default",
      { "tailor.config.ts": 'export * from "./apps/a/tailor.config";\n' },
    ],
    [
      "a module imports it through a bare specifier",
      { "tailor.config.ts": 'export { default } from "apps/a/tailor.config";\n' },
    ],
    [
      "a config file in the same directory re-exports it",
      { "apps/a/tailor.plugins.config.ts": 'export { default } from "./tailor.config";\n' },
    ],
    [
      "a barrel re-exports it under another name that no config file default-exports",
      { "configs/index.ts": 'export { default as a } from "../apps/a/tailor.config";\n' },
    ],
    [
      "a config file default-exports another config that a barrel carrying it by name default-exports",
      {
        "configs/index.ts":
          'export { default as a } from "../apps/a/tailor.config";\nexport { default } from "../apps/b/tailor.config";\n',
        "tailor.config.ts": 'import b from "./configs";\nexport default b;\n',
      },
    ],
  ])("still rewrites a config when %s", async (_, importers) => {
    writeFiles("apps/a/tailordb/user.ts");
    for (const [importerPath, importer] of Object.entries(importers)) {
      writeFile(importerPath, importer);
    }

    const { transformed, findings } = await migrate(EXPORTED_CONFIG);

    expect(transformed).toContain('files: ["tailordb/*.ts"]');
    expect(findings).toEqual([]);
  });

  test("runs before the `ignores` migration, which then moves the rebased patterns", async () => {
    writeFiles("apps/a/tailordb/user.ts", "apps/a/executors/run.ts");
    fs.writeFileSync(
      path.join(root, CONFIG_PATH),
      IMPORT +
        [
          "export default defineConfig({",
          '  db: { main: { files: ["apps/a/tailordb/*.ts"], ignores: ["apps/a/tailordb/draft.ts"] } },',
          '  executor: { files: ["apps/a/executors/*.ts"] },',
          "});",
          "",
        ].join("\n"),
    );
    const ids = ["v3/files-config-relative", "v3/files-ignores-to-negation"];
    const codemods = getApplicableCodemods("2.41.0", "3.0.0")
      .filter((codemod) => ids.includes(codemod.id))
      .map((codemod) => ({
        codemod,
        scriptPath: path.resolve(
          __dirname,
          "../codemods",
          codemod.scriptPath!.replace(/\.js$/, ".ts"),
        ),
      }));

    await runCodemods(codemods, root, false);

    expect(fs.readFileSync(path.join(root, CONFIG_PATH), "utf-8")).toBe(
      IMPORT +
        [
          "export default defineConfig({",
          '  db: { main: { files: ["tailordb/*.ts", "!tailordb/draft.ts"] } },',
          '  executor: { files: ["executors/*.ts", "!**/*.test.ts", "!**/*.spec.ts"] },',
          "});",
          "",
        ].join("\n"),
    );
  });
});
