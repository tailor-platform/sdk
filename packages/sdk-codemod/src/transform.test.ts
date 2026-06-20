import * as fs from "node:fs";
import * as path from "pathe";
import { describe, expect, test } from "vitest";
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
  const transform = await loadTransform(codemodPath);

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

async function loadTransform(codemodPath: string): Promise<TransformFn> {
  const scriptPath = path.join(CODEMODS_DIR, codemodPath, "scripts/transform.ts");
  const mod = await import(scriptPath);
  return mod.default as TransformFn;
}

describe("codemod transforms", () => {
  test("v2/define-generators-to-plugins transforms correctly", async () => {
    await expect(runFixtureCases("v2/define-generators-to-plugins")).resolves.toBeUndefined();
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

  test("v2/apply-to-deploy transforms correctly", async () => {
    await expect(runFixtureCases("v2/apply-to-deploy")).resolves.toBeUndefined();
  });

  test("v2/cli-rename transforms correctly", async () => {
    await expect(runFixtureCases("v2/cli-rename")).resolves.toBeUndefined();
  });

  test("v2/auth-invoker-unwrap transforms correctly", async () => {
    await expect(runFixtureCases("v2/auth-invoker-unwrap")).resolves.toBeUndefined();
  });

  test("v2/tailordb-namespace transforms correctly", async () => {
    await expect(runFixtureCases("v2/tailordb-namespace")).resolves.toBeUndefined();
  });

  test("v2/execute-script-arg transforms correctly", async () => {
    await expect(runFixtureCases("v2/execute-script-arg")).resolves.toBeUndefined();
  });

  test("v2/runtime-globals-opt-in transforms correctly", async () => {
    await expect(runFixtureCases("v2/runtime-globals-opt-in")).resolves.toBeUndefined();
  });

  test("v2/runtime-globals-opt-in recognizes multiline type-only syntax", async () => {
    const transform = await loadTransform("v2/runtime-globals-opt-in");
    const importInput = [
      "import type",
      '{ tailor } from "pkg";',
      "",
      "const client = tailor.idp.Client;",
      "",
    ].join("\n");

    expect(await transform(importInput, "/tmp/input.ts")).toBe(
      [
        "import type",
        '{ tailor } from "pkg";',
        'import "@tailor-platform/sdk/runtime/globals";',
        "",
        "const client = tailor.idp.Client;",
        "",
      ].join("\n"),
    );

    const specifierInput = [
      "import { type",
      'tailor } from "pkg";',
      "",
      "const client = tailor.idp.Client;",
      "",
    ].join("\n");

    expect(await transform(specifierInput, "/tmp/input.ts")).toBe(
      [
        "import { type",
        'tailor } from "pkg";',
        'import "@tailor-platform/sdk/runtime/globals";',
        "",
        "const client = tailor.idp.Client;",
        "",
      ].join("\n"),
    );

    const exportInput = [
      'import type { tailor } from "pkg";',
      "export type",
      "{ tailor };",
      "",
    ].join("\n");

    expect(await transform(exportInput, "/tmp/input.ts")).toBeNull();
  });
});
