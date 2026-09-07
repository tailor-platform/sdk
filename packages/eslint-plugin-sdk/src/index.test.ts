import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Linter } from "eslint";
import { describe, expect, test } from "vitest";
import plugin from "./index.js";

const packageDir = dirname(fileURLToPath(import.meta.url));

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
