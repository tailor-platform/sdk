import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Linter } from "eslint";
import { describe, expect, onTestFinished, test } from "vitest";
import plugin from "./index.js";

const packageDir = dirname(fileURLToPath(import.meta.url));

// Invoke oxlint's JS bin script via `node` directly rather than the
// platform-specific `.bin/` shim, which is `.cmd`/`.ps1` on Windows.
const oxlintBinScript = fileURLToPath(
  new URL("bin/oxlint", import.meta.resolve("oxlint/package.json")),
);

const NODE_FS_HELPER =
  'import { readFileSync } from "node:fs";\nexport const text = readFileSync("x", "utf8");';

describe("plugin", () => {
  test("exports every rule in the recommended ESLint flat config", () => {
    expect(Object.keys(plugin.rules).toSorted()).toEqual([
      "no-api-prefix-in-path-pattern",
      "no-direct-exec-job-function",
      "no-execute-script-arg-stringify",
      "no-job-start-outside-body",
      "no-node-builtin-imports",
      "no-node-only-globals",
      "no-plain-tailor-any-field-param",
      "no-unbound-caller-id-input",
      "no-unconditional-permit",
      "no-unused-resolver-input",
      "valid-execution-policy-definition",
      "valid-resolver-permission",
      "valid-workflow-exports",
      "valid-workflow-job-definition",
      "valid-workflow-retry-policy",
    ]);
    expect(plugin.configs.recommended.plugins?.["tailor-sdk"]).toBe(plugin);
    expect(plugin.configs.recommended.rules).toEqual({
      "tailor-sdk/no-api-prefix-in-path-pattern": "warn",
      "tailor-sdk/no-direct-exec-job-function": "warn",
      "tailor-sdk/no-execute-script-arg-stringify": "warn",
      "tailor-sdk/no-job-start-outside-body": "warn",
      "tailor-sdk/no-node-builtin-imports": "warn",
      "tailor-sdk/no-node-only-globals": "warn",
      "tailor-sdk/no-plain-tailor-any-field-param": "warn",
      "tailor-sdk/no-unbound-caller-id-input": "warn",
      "tailor-sdk/no-unconditional-permit": "warn",
      "tailor-sdk/no-unused-resolver-input": "warn",
      "tailor-sdk/valid-execution-policy-definition": "warn",
      "tailor-sdk/valid-resolver-permission": "warn",
      "tailor-sdk/valid-workflow-exports": "warn",
      "tailor-sdk/valid-workflow-job-definition": "warn",
      "tailor-sdk/valid-workflow-retry-policy": "warn",
    });
  });

  test("runs through the ESLint v9 recommended flat config", () => {
    const messages = new Linter().verify(
      'import { createHttpAdapter } from "@tailor-platform/sdk";\nexport default createHttpAdapter({ pathPattern: "/api/users/*" });',
      [plugin.configs.recommended],
      { filename: "adapter.js" },
    );

    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: "tailor-sdk/no-api-prefix-in-path-pattern",
          severity: 1,
        }),
      ]),
    );
  });

  test("checks every file an ESLint config object enables `check: all-files` for", () => {
    const config: Linter.Config[] = [
      plugin.configs.recommended,
      {
        files: ["lib/**"],
        rules: { "tailor-sdk/no-node-builtin-imports": ["warn", { check: "all-files" }] },
      },
    ];
    const ruleIds = (filename: string) =>
      new Linter().verify(NODE_FS_HELPER, config, { filename }).map(({ ruleId }) => ruleId);

    expect({ helper: ruleIds("lib/helper.js"), seed: ruleIds("seed.js") }).toEqual({
      helper: ["tailor-sdk/no-node-builtin-imports"],
      seed: [],
    });
  });

  test("runs the built plugin through an Oxlint jsPlugins config", () => {
    const dir = mkdtempSync(join(tmpdir(), "tailor-sdk-lint-"));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(
      join(dir, "adapter.ts"),
      'import { createHttpAdapter } from "@tailor-platform/sdk";\nexport default createHttpAdapter({ pathPattern: "/api/users/*" });',
    );
    mkdirSync(join(dir, "lib"));
    writeFileSync(join(dir, "lib", "helper.ts"), NODE_FS_HELPER);
    writeFileSync(join(dir, "seed.ts"), NODE_FS_HELPER);
    writeFileSync(
      join(dir, ".oxlintrc.json"),
      JSON.stringify({
        jsPlugins: [
          { name: "tailor-sdk", specifier: new URL("../dist/index.js", import.meta.url).href },
        ],
        rules: plugin.configs.recommended.rules,
        overrides: [
          {
            files: ["lib/**"],
            rules: { "tailor-sdk/no-node-builtin-imports": ["warn", { check: "all-files" }] },
          },
        ],
      }),
    );

    const result = spawnSync(
      process.execPath,
      [
        oxlintBinScript,
        "--config",
        ".oxlintrc.json",
        "--format=json",
        "adapter.ts",
        "lib/helper.ts",
        "seed.ts",
      ],
      { cwd: dir, encoding: "utf8" },
    );

    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: "" });
    const { diagnostics } = JSON.parse(result.stdout) as {
      diagnostics: { code: string; filename: string; severity: string }[];
    };
    expect(
      diagnostics
        .filter(({ code }) => code.startsWith("tailor-sdk("))
        .map(({ code, filename, severity }) => ({ code, filename, severity }))
        .toSorted((a, b) => a.filename.localeCompare(b.filename)),
    ).toEqual([
      {
        code: "tailor-sdk(no-api-prefix-in-path-pattern)",
        filename: "adapter.ts",
        severity: "warning",
      },
      {
        code: "tailor-sdk(no-node-builtin-imports)",
        filename: "lib/helper.ts",
        severity: "warning",
      },
    ]);
  });

  test("keeps scaffolded Oxlint configs aligned with required rules", () => {
    const templatesDir = resolve(packageDir, "../../create-sdk/templates");
    const templates = readdirSync(templatesDir, { withFileTypes: true }).filter((entry) =>
      entry.isDirectory(),
    );
    expect(templates.map(({ name }) => name)).toContain("hello-world");

    for (const template of templates) {
      const config = JSON.parse(
        readFileSync(resolve(templatesDir, template.name, ".oxlintrc.json"), "utf8"),
      );
      const rules = Object.fromEntries(
        Object.entries(config.rules).filter(([name]) => name.startsWith("tailor-sdk/")),
      );
      const importRules = Object.fromEntries(
        Object.entries(config.rules).filter(([name]) => name.startsWith("import/")),
      );
      expect(
        { importPlugin: config.plugins.includes("import"), importRules, rules },
        `template: ${template.name}`,
      ).toMatchObject({
        importPlugin: true,
        importRules: {
          "import/default": "off",
          "import/namespace": "off",
          "import/no-duplicates": ["error", { considerQueryString: true }],
        },
        rules: plugin.configs.recommended.rules,
      });
    }
  });
});
