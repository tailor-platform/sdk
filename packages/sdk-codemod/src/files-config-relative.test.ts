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

  function writeFiles(...relativePaths: string[]): void {
    for (const relativePath of relativePaths) {
      const file = path.join(root, relativePath);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, "");
    }
  }

  function migrate(body: string, configPath = CONFIG_PATH) {
    const source = IMPORT + body;
    const absolute = path.join(root, configPath);
    return {
      transformed: transform(source, absolute, root),
      findings: reviewFindings(source, absolute, configPath, root).map(
        (finding) => finding.message,
      ),
    };
  }

  test("rebases `files`, `!` patterns, and `ignores` that match only from the project directory", () => {
    writeFiles("apps/a/tailordb/user.ts", "apps/a/executors/run.ts");

    const { transformed, findings } = migrate(
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
  ])("rebases %s to %s", (pattern, rebased) => {
    writeFiles("apps/a/tailordb/user.ts");

    const { transformed } = migrate(
      `export default defineConfig({\n  db: { main: { files: ["${pattern}"] } },\n});\n`,
    );

    expect(transformed).toContain(`files: ["${rebased}"]`);
  });

  test("writes the config's own directory as `.`", () => {
    writeFiles("apps/a/tailordb/user.ts");

    const { transformed } = migrate(
      'export default defineConfig({\n  db: { main: { files: ["apps/a/tailordb/*.ts", "!./apps/a"] } },\n});\n',
    );

    expect(transformed).toContain('files: ["tailordb/*.ts", "!."]');
  });

  test("keeps a rebased pattern that starts with `!` from turning into an exclusion", () => {
    writeFiles("apps/a/!jobs/run.ts");

    const { transformed } = migrate(
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
  ])("rewrites a config default-exported through %s", (_, template) => {
    writeFiles("apps/a/tailordb/user.ts");

    const { transformed } = migrate(
      template.replace(
        "%s",
        'defineConfig({\n  db: { main: { files: ["apps/a/tailordb/*.ts"] } },\n})',
      ),
    );

    expect(transformed).toContain('files: ["tailordb/*.ts"]');
  });

  test("rewrites only the defineConfig() call the module default-exports", () => {
    writeFiles("apps/a/tailordb/user.ts", "apps/a/executors/run.ts");
    const fragment =
      'export const fragment = defineConfig({\n  executor: { files: ["apps/a/executors/*.ts"] },\n});\n';

    const { transformed, findings } = migrate(
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

  test("reports a defineConfig() call next to an unrelated default export instead of rewriting it", () => {
    writeFiles("apps/a/executors/run.ts");

    const { transformed, findings } = migrate(
      'export const fragment = defineConfig({\n  executor: { files: ["apps/a/executors/*.ts"] },\n});\nexport default function helper() {}\n',
    );

    expect(transformed).toBeNull();
    expect(findings).toEqual([expect.stringContaining("not the module's default export")]);
  });

  test("does not report a defineConfig() call that is not the default export when it needs no rewrite", () => {
    writeFiles("apps/a/executors/run.ts");

    const { transformed, findings } = migrate(
      'export const fragment = defineConfig({\n  executor: { files: ["executors/*.ts"] },\n});\n',
    );

    expect(transformed).toBeNull();
    expect(findings).toEqual([]);
  });

  test.each([
    ["a pattern matches from the config's directory", '["tailordb/*.ts", "apps/a/executors/*.ts"]'],
    ["every positive pattern is absolute", '["/elsewhere/*.ts", "!apps/a/tailordb/draft.ts"]'],
    ["the service lists only `!` patterns", '["!apps/a/tailordb/draft.ts"]'],
  ])("leaves a service alone when %s", (_, files) => {
    writeFiles("apps/a/tailordb/user.ts", "apps/a/executors/run.ts");

    const { transformed, findings } = migrate(
      `export default defineConfig({\n  db: { main: { files: ${files} } },\n});\n`,
    );

    expect(transformed).toBeNull();
    expect(findings).toEqual([]);
  });

  test("reports a service instead of rewriting it when globbing fails", () => {
    writeFiles("apps/a/tailordb/user.ts");
    using _globSync = vi.mocked(fs.globSync).mockImplementation(() => {
      throw new Error("EACCES");
    });

    const { transformed, findings } = migrate(
      'export default defineConfig({\n  db: { main: { files: ["apps/a/tailordb/*.ts"] } },\n});\n',
    );

    expect(transformed).toBeNull();
    expect(findings).toEqual([
      expect.stringContaining('db.main.files could not be globbed: "apps/a/tailordb/*.ts"'),
    ]);
  });

  test("changes and reports nothing for a config in the project directory", () => {
    writeFiles("apps/a/tailordb/user.ts");

    const { transformed, findings } = migrate(
      'export default defineConfig({\n  db: { main: { files: ["missing/*.ts"] } },\n  executor: { files: executorFiles },\n});\n',
      "tailor.config.ts",
    );

    expect(transformed).toBeNull();
    expect(findings).toEqual([]);
  });

  test("leaves the result unchanged when run again", () => {
    writeFiles("apps/a/tailordb/user.ts");
    const { transformed } = migrate(
      'export default defineConfig({\n  db: { main: { files: ["apps/a/tailordb/*.ts"] } },\n});\n',
    );

    expect(transform(transformed!, path.join(root, CONFIG_PATH), root)).toBeNull();
  });

  test("names the project directory it searched when no pattern matches from either directory", () => {
    writeFiles("apps/a/tailordb/user.ts");

    const { transformed, findings } = migrate(
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
  ])("reports %s outside the project directory", (_, body, reason) => {
    writeFiles("apps/a/tailordb/user.ts");

    const { transformed, findings } = migrate(body);

    expect(transformed).toBeNull();
    expect(findings).toEqual([expect.stringContaining(reason)]);
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
