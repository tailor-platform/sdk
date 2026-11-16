import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { getApplicableCodemods } from "./registry";
import { runCodemods } from "./runner";
import { reviewInProject, runnableCodemod } from "./test-helpers/codemods";

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
    const { transformed, findings } = await reviewInProject(
      "v3/files-config-relative",
      root,
      IMPORT + body,
      configPath,
    );
    return { transformed, findings: findings.map((finding) => finding.message) };
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

  test("rebases template literals without substitutions and keeps their backticks", async () => {
    writeFiles("apps/a/tailordb/user.ts");

    const { transformed, findings } = await migrate(
      "export default defineConfig({\n  db: { main: { files: [`apps/a/tailordb/*.ts`], ignores: [`apps/a/tailordb/draft.ts`] } },\n});\n",
    );

    expect(transformed).toContain("files: [`tailordb/*.ts`], ignores: [`tailordb/draft.ts`]");
    expect(findings).toEqual([]);
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

    const rerun = await reviewInProject(
      "v3/files-config-relative",
      root,
      transformed!,
      CONFIG_PATH,
    );

    expect(rerun.transformed).toBeNull();
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

  test("changes and reports nothing for a config that a config file in the project directory re-exports", async () => {
    writeFiles("src/run.ts");
    writeFile("tailor.config.ts", 'export { default } from "./configs/shared";\n');

    const { transformed, findings } = await migrate(
      'export default defineConfig({\n  name: "app",\n  executor: { files: ["src/*.ts"] },\n});\n',
      "configs/shared.ts",
    );

    expect(transformed).toBeNull();
    expect(findings).toEqual([]);
  });

  const SHARED_EXECUTOR = 'defineConfig({\n  executor: { files: ["jobs/*.ts"] },\n})';

  test.each([
    [
      "by name",
      `export const shared = ${SHARED_EXECUTOR};\n`,
      'export { shared as default } from "../../configs/shared";\n',
    ],
    [
      "under an alias",
      `const base = ${SHARED_EXECUTOR};\nexport { base as shared };\n`,
      'export { shared as default } from "../../configs/shared";\n',
    ],
    [
      "as its default",
      `export default ${SHARED_EXECUTOR};\n`,
      'export { default } from "../../configs/shared";\n',
    ],
    [
      "as its default with patterns it cannot read",
      "export default defineConfig({\n  executor: { files: executorFiles },\n});\n",
      'export { default } from "../../configs/shared";\n',
    ],
    [
      "as its default with a variable passed to defineConfig()",
      "export default defineConfig(base);\n",
      'export { default } from "../../configs/shared";\n',
    ],
  ])(
    "reports a shared config exported %s that a config file in another directory loads",
    async (_, body, loader) => {
      writeFiles("jobs/run.ts", "configs/jobs/helper.ts");
      writeFile("apps/a/tailor.config.ts", loader);

      const { transformed, findings } = await migrate(body, "configs/shared.ts");

      expect(transformed).toBeNull();
      expect(findings).toEqual([
        expect.stringContaining("`apps/a/tailor.config.ts` loads this config"),
      ]);
    },
  );

  test("follows a name a module gains through a second route after the first one reached it", async () => {
    writeFiles("jobs/run.ts", "barrels/jobs/local.ts");
    writeFile("configs/forward.ts", 'export { default } from "./shared";\n');
    writeFile(
      "barrels/index.ts",
      'export { default as named } from "../configs/shared";\nexport { default } from "../configs/forward";\n',
    );
    writeFile("apps/a/tailor.config.ts", 'import a from "../../barrels";\nexport default a;\n');

    const { transformed, findings } = await migrate(
      `export default ${SHARED_EXECUTOR};\n`,
      "configs/shared.ts",
    );

    expect(transformed).toBeNull();
    expect(findings).toEqual([
      expect.stringContaining("`apps/a/tailor.config.ts`, `barrels/index.ts` load this config"),
    ]);
  });

  test.each([
    [
      "its patterns match from the loading config file's directory",
      `export const shared = ${SHARED_EXECUTOR};\n`,
      { "apps/a/tailor.config.ts": 'export { shared as default } from "../../configs/shared";\n' },
      ["jobs/run.ts", "configs/jobs/helper.ts", "apps/a/jobs/run.ts"],
    ],
    [
      "it has no `files` patterns",
      'export const shared = defineConfig({\n  name: "app",\n});\n',
      { "apps/a/tailor.config.ts": 'export { shared as default } from "../../configs/shared";\n' },
      [],
    ],
    [
      "only a config file in the project directory loads it",
      `export const shared = ${SHARED_EXECUTOR};\n`,
      { "tailor.config.ts": 'export { shared as default } from "./configs/shared";\n' },
      ["jobs/run.ts", "configs/jobs/helper.ts"],
    ],
    [
      "only a config file in the project directory loads it with a variable passed to defineConfig()",
      "export default defineConfig(base);\n",
      { "tailor.config.ts": 'export { default } from "./configs/shared";\n' },
      [],
    ],
    [
      "a module beside the config file that loads it takes it through a namespace",
      `export default ${SHARED_EXECUTOR};\n`,
      {
        "apps/a/tailor.config.ts": 'export { default } from "../../configs/shared";\n',
        "apps/a/name.ts":
          'import * as shared from "../../configs/shared";\nexport const name = shared.default.name;\n',
      },
      ["apps/a/jobs/run.ts"],
    ],
  ])(
    "changes and reports nothing for a shared config when %s",
    async (_, body, importers, files) => {
      writeFiles(...files);
      for (const [importerPath, importer] of Object.entries(importers)) {
        writeFile(importerPath, importer);
      }

      const { transformed, findings } = await migrate(body, "configs/shared.ts");

      expect(transformed).toBeNull();
      expect(findings).toEqual([]);
    },
  );

  test.each<[string, Record<string, string>, string]>([
    [
      "a config file that default-exports a member of it",
      {
        "apps/a/tailor.config.ts":
          'import * as shared from "../../configs/shared";\nexport default shared.default;\n',
      },
      "`apps/a/tailor.config.ts` imports or re-exports this config through a namespace",
    ],
    [
      "a config file, through a module that re-exports it,",
      {
        "configs/index.ts": 'export { default } from "./shared";\n',
        "apps/a/tailor.config.ts":
          'import * as configs from "../../configs";\nexport default configs.default;\n',
      },
      "`apps/a/tailor.config.ts` imports or re-exports this config through a namespace",
    ],
    [
      "a module with `export * as`",
      {
        "lib/configs.ts": 'export * as shared from "../configs/shared";\n',
        "apps/a/tailor.config.ts":
          'import { shared } from "../../lib/configs";\nexport default shared.default;\n',
      },
      "`lib/configs.ts` imports or re-exports this config through a namespace",
    ],
    [
      "a module in the config's directory",
      {
        "configs/all.ts": 'export * as shared from "./shared";\n',
        "apps/a/tailor.config.ts":
          'import { shared } from "../../configs/all";\nexport default shared.default;\n',
      },
      "`configs/all.ts` imports or re-exports this config through a namespace",
    ],
    [
      "a module in the project directory",
      { "index.ts": 'export * as shared from "./configs/shared";\n' },
      "`index.ts` imports or re-exports this config through a namespace",
    ],
    [
      "a config file that default-exports a member of what it imports dynamically",
      {
        "apps/a/tailor.config.ts":
          'export default (await import("../../configs/shared")).default;\n',
      },
      "`apps/a/tailor.config.ts` imports or re-exports this config through a namespace",
    ],
  ])("reports a shared config that %s takes through a namespace", async (_, importers, reason) => {
    writeFiles("jobs/run.ts");
    for (const [importerPath, importer] of Object.entries(importers)) {
      writeFile(importerPath, importer);
    }

    const { transformed, findings } = await migrate(
      `export default ${SHARED_EXECUTOR};\n`,
      "configs/shared.ts",
    );

    expect(transformed).toBeNull();
    expect(findings).toEqual([expect.stringContaining(reason)]);
  });

  test("names the files that load a config and those that take it through a namespace in one finding", async () => {
    writeFiles("jobs/run.ts");
    writeFile("apps/a/tailor.config.ts", 'export { default } from "../../configs/shared";\n');
    writeFile(
      "apps/b/tailor.config.ts",
      'import shared, * as all from "../../configs/shared";\nexport default shared;\n',
    );
    writeFile("lib/b.ts", 'export * as shared from "../configs/shared";\n');
    writeFile("lib/a.ts", 'export * as shared from "../configs/shared";\n');

    const { transformed, findings } = await migrate(
      `export default ${SHARED_EXECUTOR};\n`,
      "configs/shared.ts",
    );

    expect(transformed).toBeNull();
    expect(findings).toEqual([
      expect.stringContaining(
        "`apps/a/tailor.config.ts`, `apps/b/tailor.config.ts` load this config, so its patterns resolve against the directory of whichever of them the CLI loads; `lib/a.ts`, `lib/b.ts` import or re-export this config through a namespace",
      ),
    ]);
  });

  const EXPORTED_CONFIG =
    'export const config = defineConfig({\n  db: { main: { files: ["apps/a/tailordb/*.ts"] } },\n});\nexport default config;\n';

  test.each<[string, Record<string, string>]>([
    [
      "re-exports the default",
      { "deploy/tailor.config.ts": 'export { default } from "../apps/a/tailor.config";\n' },
    ],
    [
      "re-exports the default under a `.js` specifier",
      {
        "deploy/tailor.config.ts":
          'export { default as default } from "../apps/a/tailor.config.js";\n',
      },
    ],
    [
      "default-exports the default import",
      {
        "deploy/tailor.config.ts":
          'import a from "../apps/a/tailor.config.ts";\nexport default a;\n',
      },
    ],
    [
      "exports a `{ default as … }` import as default",
      {
        "deploy/tailor.config.ts":
          'import { default as a } from "../apps/a/tailor.config";\nexport { a as default };\n',
      },
    ],
    [
      "default-exports the binding the config module default-exports",
      {
        "deploy/tailor.config.ts":
          'import { config } from "../apps/a/tailor.config";\nexport default config;\n',
      },
    ],
    [
      "spreads the default import into its own default-exported config",
      {
        "deploy/tailor.config.ts": `${IMPORT}import a from "../apps/a/tailor.config";\nexport default defineConfig({ ...a, name: "root" });\n`,
      },
    ],
    [
      "spreads the default import into a config it default-exports through a variable",
      {
        "deploy/tailor.config.ts": `${IMPORT}import a from "../apps/a/tailor.config";\nconst config = defineConfig({ ...a, name: "root" });\nexport default config;\n`,
      },
    ],
    [
      "default-exports what a barrel re-exports under another name",
      {
        "configs/index.ts": 'export { default as a } from "../apps/a/tailor.config";\n',
        "deploy/tailor.config.ts": 'import { a } from "../configs";\nexport default a;\n',
      },
    ],
    [
      "default-exports what a barrel imports and exports by name",
      {
        "configs/all.ts": 'import shared from "../apps/a/tailor.config";\nexport { shared };\n',
        "deploy/tailor.config.ts":
          'import { shared } from "../configs/all";\nexport default shared;\n',
      },
    ],
    [
      "default-exports what a module re-exports with `export *`",
      {
        "configs/mid.ts": 'export * from "../apps/a/tailor.config";\n',
        "deploy/tailor.config.ts":
          'import { config } from "../configs/mid";\nexport default config;\n',
      },
    ],
    [
      "re-exports an index module in the config's directory that re-exports it",
      {
        "apps/a/index.ts": 'export { default } from "./tailor.config";\n',
        "deploy/tailor.config.ts": 'export { default } from "../apps/a";\n',
      },
    ],
  ])("reports a config that a config file in another directory %s", async (_, importers) => {
    writeFiles("apps/a/tailordb/user.ts");
    for (const [importerPath, importer] of Object.entries(importers)) {
      writeFile(importerPath, importer);
    }

    const { transformed, findings } = await migrate(EXPORTED_CONFIG);

    expect(transformed).toBeNull();
    expect(findings).toEqual([
      expect.stringContaining("`deploy/tailor.config.ts` loads this config"),
    ]);
  });

  test("reports an index module that a config file in another directory re-exports by its directory", async () => {
    writeFiles("apps/a/tailordb/user.ts");
    writeFile("deploy/tailor.config.ts", 'export { default } from "../apps/a";\n');

    const { transformed, findings } = await migrate(EXPORTED_CONFIG, "apps/a/index.ts");

    expect(transformed).toBeNull();
    expect(findings).toEqual([
      expect.stringContaining("`deploy/tailor.config.ts` loads this config"),
    ]);
  });

  test("names every config file that loads a config when one outside the project directory does", async () => {
    writeFiles("apps/a/tailordb/user.ts");
    writeFile("tailor.config.ts", 'export { default } from "./apps/a/tailor.config";\n');
    writeFile("configs/index.ts", 'export { default as a } from "../apps/a/tailor.config";\n');
    writeFile("apps/b/tailor.config.ts", 'import { a } from "../../configs";\nexport default a;\n');

    const { transformed, findings } = await migrate(EXPORTED_CONFIG);

    expect(transformed).toBeNull();
    expect(findings).toEqual([
      expect.stringContaining("`apps/b/tailor.config.ts`, `tailor.config.ts` load this config"),
    ]);
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
      "a test takes it through a namespace without exports of its own",
      {
        "apps/a/tests/config.test.ts":
          'import * as config from "../tailor.config";\ntest("config", () => expect(config.default).toBeDefined());\n',
      },
    ],
    [
      "a module that exports only a type alias takes it through a namespace",
      {
        "apps/a/types.ts":
          'import * as config from "./tailor.config";\nexport type AppConfig = typeof config.default;\n',
      },
    ],
    [
      "a module that exports only type specifiers takes it through a namespace",
      {
        "apps/a/types.ts":
          'import * as config from "./tailor.config";\ntype AppConfig = typeof config.default;\nexport { type AppConfig };\n',
      },
    ],
    [
      "a module with exports takes only its types through a namespace import",
      {
        "deploy/name.ts":
          'import type * as a from "../apps/a/tailor.config";\nexport const name = "deploy";\n',
      },
    ],
    [
      "a module with exports re-exports only its types through a namespace",
      {
        "lib/configs.ts":
          'export type * as a from "../apps/a/tailor.config";\nexport const version = 1;\n',
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
      "a config file default-exports a name a module re-exports with `export type *`",
      {
        "configs/mid.ts": 'export type * from "../apps/a/tailor.config";\n',
        "deploy/tailor.config.ts":
          'import { config } from "../configs/mid";\nexport default config;\n',
      },
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
    writeFile(
      CONFIG_PATH,
      IMPORT +
        [
          "export default defineConfig({",
          '  db: { main: { files: ["apps/a/tailordb/*.ts"], ignores: ["apps/a/tailordb/draft.ts"] } },',
          '  executor: { files: ["apps/a/executors/*.ts"] },',
          "});",
          "",
        ].join("\n"),
    );
    const codemods = getApplicableCodemods("2.41.0", "3.0.0")
      .map((codemod) => codemod.id)
      .filter((id) => id === "v3/files-config-relative" || id === "v3/files-ignores-to-negation")
      .map(runnableCodemod);

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
