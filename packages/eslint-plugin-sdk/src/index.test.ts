import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

describe("plugin", () => {
  test("exports every rule in the recommended ESLint flat config", () => {
    expect(Object.keys(plugin.rules).toSorted()).toEqual([
      "no-api-prefix-in-path-pattern",
      "no-direct-exec-job-function",
      "no-execute-script-arg-stringify",
      "no-job-start-outside-body",
      "no-node-builtin-imports",
      "no-node-only-globals",
      "no-unconditional-permit",
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
      "tailor-sdk/no-unconditional-permit": "warn",
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

  test("runs the built plugin through an Oxlint jsPlugins config", () => {
    const dir = mkdtempSync(join(tmpdir(), "tailor-sdk-lint-"));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(
      join(dir, "adapter.ts"),
      'import { createHttpAdapter } from "@tailor-platform/sdk";\nexport default createHttpAdapter({ pathPattern: "/api/users/*" });',
    );
    writeFileSync(
      join(dir, ".oxlintrc.json"),
      JSON.stringify({
        jsPlugins: [
          { name: "tailor-sdk", specifier: new URL("../dist/index.js", import.meta.url).href },
        ],
        rules: plugin.configs.recommended.rules,
      }),
    );

    const result = spawnSync(
      process.execPath,
      [oxlintBinScript, "--config", ".oxlintrc.json", "--format=json", "adapter.ts"],
      { cwd: dir, encoding: "utf8" },
    );

    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: "" });
    const { diagnostics } = JSON.parse(result.stdout) as {
      diagnostics: { code: string; severity: string }[];
    };
    expect(
      diagnostics
        .filter(({ code }) => code.startsWith("tailor-sdk("))
        .map(({ code, severity }) => ({ code, severity })),
    ).toEqual([{ code: "tailor-sdk(no-api-prefix-in-path-pattern)", severity: "warning" }]);
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
