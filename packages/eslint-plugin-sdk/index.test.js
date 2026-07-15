/* oxlint-disable vitest/expect-expect -- Assertions are centralized in shared lint helpers. */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Linter } from "eslint";
import { afterEach, describe, expect, test } from "vitest";
import plugin from "./index.js";

const packageDir = dirname(fileURLToPath(import.meta.url));
const oxlintBin = resolve(packageDir, "../../node_modules/.bin/oxlint");
const pluginUrl = pathToFileURL(resolve(packageDir, "index.js")).href;
const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function lint(source, rule, filename = "fixture.ts") {
  const dir = mkdtempSync(join(tmpdir(), "tailor-sdk-lint-"));
  tempDirs.push(dir);
  const file = join(dir, filename);
  const config = join(dir, ".oxlintrc.json");

  writeFileSync(file, source);
  writeFileSync(
    config,
    JSON.stringify({
      jsPlugins: [{ name: "tailor-sdk", specifier: pluginUrl }],
      rules: { [`tailor-sdk/${rule}`]: "error" },
    }),
  );

  const result = spawnSync(oxlintBin, ["--config", config, file], {
    cwd: dir,
    encoding: "utf8",
  });

  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
  };
}

function expectViolation(source, rule, message, filename) {
  const result = lint(source, rule, filename);
  expect({ status: result.status, output: result.output }).toMatchObject({ status: 1 });
  expect(result.output).toContain(`tailor-sdk(${rule})`);
  expect(result.output).toContain(message);
}

function expectClean(source, rule, filename) {
  const result = lint(source, rule, filename);
  expect({ status: result.status, output: result.output }).toMatchObject({ status: 0 });
}

describe("plugin", () => {
  test("exports every rule in the recommended ESLint flat config", () => {
    expect(Object.keys(plugin.rules).toSorted()).toEqual(["no-api-prefix-in-path-pattern"]);
    expect(plugin.configs.recommended.plugins["tailor-sdk"]).toBe(plugin);
    expect(plugin.configs.recommended.rules).toEqual({
      "tailor-sdk/no-api-prefix-in-path-pattern": "warn",
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

  test("keeps scaffolded Oxlint rules aligned with the recommended config", () => {
    const templatesDir = resolve(packageDir, "../create-sdk/templates");
    const templates = readdirSync(templatesDir, { withFileTypes: true }).filter((entry) =>
      entry.isDirectory(),
    );

    for (const template of templates) {
      const config = JSON.parse(
        readFileSync(resolve(templatesDir, template.name, ".oxlintrc.json"), "utf8"),
      );
      const rules = Object.fromEntries(
        Object.entries(config.rules).filter(([name]) => name.startsWith("tailor-sdk/")),
      );
      expect({ rules, template: template.name }).toMatchObject({
        rules: plugin.configs.recommended.rules,
      });
    }
  });
});

describe("no-api-prefix-in-path-pattern", () => {
  test.each(['"/api/users/*"', "`/api/orders`"])(
    "rejects the external /api prefix in %s",
    (pattern) => {
      expectViolation(
        `import { createHttpAdapter } from "@tailor-platform/sdk";\nexport default createHttpAdapter({ pathPattern: ${pattern} });`,
        "no-api-prefix-in-path-pattern",
        "pathPattern is matched after the /api prefix; remove the leading /api.",
      );
    },
  );

  test("accepts relative platform paths and dynamic values", () => {
    expectClean(
      'import { createHttpAdapter } from "@tailor-platform/sdk";\nexport default createHttpAdapter({ pathPattern: "/users/*" });',
      "no-api-prefix-in-path-pattern",
    );
    expectClean(
      'import { createHttpAdapter } from "@tailor-platform/sdk";\nexport default createHttpAdapter({ pathPattern });',
      "no-api-prefix-in-path-pattern",
    );
    expectClean(
      'import { createHttpAdapter } from "@tailor-platform/sdk";\nexport default createHttpAdapter({ pathPattern: "/api/users", pathPattern: "/users" });',
      "no-api-prefix-in-path-pattern",
    );
  });

  test("rejects a prefixed path in a constant options object", () => {
    expectViolation(
      'import { createHttpAdapter } from "@tailor-platform/sdk";\nconst options = { pathPattern: "/api/users/*" };\nexport default createHttpAdapter(options);',
      "no-api-prefix-in-path-pattern",
      "pathPattern is matched after the /api prefix; remove the leading /api.",
    );
  });

  test("ignores same-named factories from other packages", () => {
    expectClean(
      'import { createHttpAdapter } from "another-sdk";\nexport default createHttpAdapter({ pathPattern: "/api/users/*" });',
      "no-api-prefix-in-path-pattern",
    );
  });

  test("supports namespace imports", () => {
    expectViolation(
      'import * as sdk from "@tailor-platform/sdk";\nexport default sdk.createHttpAdapter({ pathPattern: "/api/users/*" });',
      "no-api-prefix-in-path-pattern",
      "pathPattern is matched after the /api prefix; remove the leading /api.",
    );
  });
});
