import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { describe, expect, test } from "vitest";
import migrateGenerators from "../codemods/v2/define-generators-to-plugins/scripts/transform";
import normalizePluginExport from "../codemods/v2/plugin-export-name-normalize/scripts/transform";
import type { TransformFn } from "./runner";

const CODEMODS_DIR = path.resolve(__dirname, "../codemods");

interface FixtureCase {
  caseName: string;
  caseDir: string;
  inputFile: string;
  expectedFile: string | null;
}

async function discoverCases(codemodPath: string): Promise<FixtureCase[]> {
  const testsDir = path.join(CODEMODS_DIR, codemodPath, "tests");
  const entries = await fs.promises.readdir(testsDir, { withFileTypes: true });
  const cases: FixtureCase[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const caseDir = path.join(testsDir, entry.name);
    const files = await fs.promises.readdir(caseDir);
    const inputFile = files.find((f) => f.startsWith("input."));
    const expectedFile = files.find((f) => f.startsWith("expected."));
    if (!inputFile) {
      throw new Error(`No input.* file found in fixture ${caseDir}`);
    }
    cases.push({
      caseName: entry.name,
      caseDir,
      inputFile,
      expectedFile: expectedFile ?? null,
    });
  }

  return cases.toSorted((a, b) => a.caseName.localeCompare(b.caseName));
}

async function runFixtureCases(codemodPath: string): Promise<void> {
  const scriptPath = path.join(CODEMODS_DIR, codemodPath, "scripts/transform.ts");
  const mod = await import(scriptPath);
  const transform = mod.default as TransformFn;

  const cases = await discoverCases(codemodPath);
  expect(cases.length, `expected at least one fixture under ${codemodPath}/tests`).toBeGreaterThan(
    0,
  );

  for (const c of cases) {
    const inputPath = path.join(c.caseDir, c.inputFile);
    const input = await fs.promises.readFile(inputPath, "utf-8");
    const result = await transform(input, inputPath);
    const expected = c.expectedFile
      ? await fs.promises.readFile(path.join(c.caseDir, c.expectedFile), "utf-8")
      : null;
    expect(result).toBe(expected);
  }
}

describe("codemod transforms", () => {
  test("preserves imports when multiple legacy exports prevent config normalization", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-export-normalize-"));
    try {
      const config = `import { definePlugins } from "@tailor-platform/sdk";
export const generator = definePlugins();
export const generators = definePlugins();
`;
      const configPath = path.join(dir, "tailor.config.ts");
      fs.writeFileSync(configPath, config);
      expect(normalizePluginExport(config, configPath)).toBeNull();
      const consumer = `import { generator } from "./tailor.config";
console.log(generator);
`;
      expect(normalizePluginExport(consumer, path.join(dir, "consumer.ts"))).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test.each([
    { define: "defineGenerators", transform: migrateGenerators },
    { define: "definePlugins", transform: normalizePluginExport },
  ])("$define preserves remote names in unrelated aliased imports", ({ define, transform }) => {
    const source = `import { ${define} } from "@tailor-platform/sdk";
import { generators as unrelated } from "./other";
export const generators = ${define}();
console.log(generators, unrelated);
`;
    const expected = `import { definePlugins } from "@tailor-platform/sdk";
import { generators as unrelated } from "./other";
export const plugins = definePlugins();
console.log(plugins, unrelated);
`;
    expect(transform(source)).toBe(expected);
  });

  test.each([
    { define: "defineGenerators", transform: migrateGenerators },
    { define: "definePlugins", transform: normalizePluginExport },
  ])("$define preserves defaulted destructuring bindings", ({ define, transform }) => {
    const source = `import { ${define} } from "@tailor-platform/sdk";
export const generators = ${define}();
function read(value: { generators?: unknown[] }) {
  const { generators = [] } = value;
  return generators;
}
`;
    const expected = `import { definePlugins } from "@tailor-platform/sdk";
export const generators = definePlugins();
function read(value: { generators?: unknown[] }) {
  const { generators = [] } = value;
  return generators;
}
`;
    expect(transform(source) ?? source).toBe(expected);
  });

  test.each([
    { define: "defineGenerators", transform: migrateGenerators },
    { define: "definePlugins", transform: normalizePluginExport },
  ])("$define preserves references when plugins is a parameter", ({ define, transform }) => {
    const source = `import { ${define} } from "@tailor-platform/sdk";
export const generators = ${define}();
export function read(plugins: unknown) { return generators; }
`;
    expect(transform(source)).toBeNull();
  });

  test("v2/define-generators-to-plugins transforms correctly", async () => {
    await expect(runFixtureCases("v2/define-generators-to-plugins")).resolves.toBeUndefined();
  });

  test("v2/plugin-export-name-normalize transforms correctly", async () => {
    await expect(runFixtureCases("v2/plugin-export-name-normalize")).resolves.toBeUndefined();
  });

  test("v2/plugin-cli-import transforms correctly", async () => {
    await expect(runFixtureCases("v2/plugin-cli-import")).resolves.toBeUndefined();
  });

  test("v2/test-run-arg-input transforms correctly", async () => {
    await expect(runFixtureCases("v2/test-run-arg-input")).resolves.toBeUndefined();
  });

  test("v2/sdk-skills-shim transforms correctly", async () => {
    await expect(runFixtureCases("v2/sdk-skills-shim")).resolves.toBeUndefined();
  });

  test("v2/principal-unify transforms correctly", async () => {
    await expect(runFixtureCases("v2/principal-unify")).resolves.toBeUndefined();
  });

  test("v2/erd-site-to-plugin transforms correctly", async () => {
    await expect(runFixtureCases("v2/erd-site-to-plugin")).resolves.toBeUndefined();
  });

  test("v2/auth-attributes-rename transforms correctly", async () => {
    await expect(runFixtureCases("v2/auth-attributes-rename")).resolves.toBeUndefined();
  });

  test("v2/apply-to-deploy transforms correctly", async () => {
    await expect(runFixtureCases("v2/apply-to-deploy")).resolves.toBeUndefined();
  });

  test("v2/cli-rename transforms correctly", async () => {
    await expect(runFixtureCases("v2/cli-rename")).resolves.toBeUndefined();
  });

  test("v2/env-var-rename transforms correctly", async () => {
    await expect(runFixtureCases("v2/env-var-rename")).resolves.toBeUndefined();
  });

  test("v2/auth-invoker-call-unwrap transforms correctly", async () => {
    await expect(runFixtureCases("v2/auth-invoker-call-unwrap")).resolves.toBeUndefined();
  });

  test("v2/auth-invoker-unwrap transforms correctly", async () => {
    await expect(runFixtureCases("v2/auth-invoker-unwrap")).resolves.toBeUndefined();
  });

  test("v2/auth-connection-token-helper transforms correctly", async () => {
    await expect(runFixtureCases("v2/auth-connection-token-helper")).resolves.toBeUndefined();
  });

  test("v2/runtime-subpath-namespace transforms correctly", async () => {
    await expect(runFixtureCases("v2/runtime-subpath-namespace")).resolves.toBeUndefined();
  });

  test("v2/tailordb-namespace transforms correctly", async () => {
    await expect(runFixtureCases("v2/tailordb-namespace")).resolves.toBeUndefined();
  });

  test("v2/runtime-globals-opt-in transforms correctly", async () => {
    await expect(runFixtureCases("v2/runtime-globals-opt-in")).resolves.toBeUndefined();
  });

  test("v2/execute-script-arg transforms correctly", async () => {
    await expect(runFixtureCases("v2/execute-script-arg")).resolves.toBeUndefined();
  });

  test("v2/tailor-output-ignore-dir transforms correctly", async () => {
    await expect(runFixtureCases("v2/tailor-output-ignore-dir")).resolves.toBeUndefined();
  });

  test("v2/rename-bin transforms correctly", async () => {
    await expect(runFixtureCases("v2/rename-bin")).resolves.toBeUndefined();
  });

  test("v2/wait-point-rename transforms correctly", async () => {
    await expect(runFixtureCases("v2/wait-point-rename")).resolves.toBeUndefined();
  });

  test("v2/db-type-to-table transforms correctly", async () => {
    await expect(runFixtureCases("v2/db-type-to-table")).resolves.toBeUndefined();
  });

  test("v2/exec-job-function-rename transforms correctly", async () => {
    await expect(runFixtureCases("v2/exec-job-function-rename")).resolves.toBeUndefined();
  });

  test("v2/workflow-trigger-rename transforms correctly", async () => {
    await expect(runFixtureCases("v2/workflow-trigger-rename")).resolves.toBeUndefined();
  });

  test("v2/seed-exec-to-cli-plugin transforms correctly", async () => {
    await expect(runFixtureCases("v2/seed-exec-to-cli-plugin")).resolves.toBeUndefined();
  });

  test("v2/idp-publish-events-rename transforms correctly", async () => {
    await expect(runFixtureCases("v2/idp-publish-events-rename")).resolves.toBeUndefined();
  });

  test("v3/function-test-run-rename transforms correctly", async () => {
    await expect(runFixtureCases("v3/function-test-run-rename")).resolves.toBeUndefined();
  });

  test("v3/relation-toward-table transforms correctly", async () => {
    await expect(runFixtureCases("v3/relation-toward-table")).resolves.toBeUndefined();
  });
});
