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

  cases.sort((a, b) => a.caseName.localeCompare(b.caseName));
  return cases;
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

    if (c.expectedFile) {
      const expected = await fs.promises.readFile(path.join(c.caseDir, c.expectedFile), "utf-8");
      expect(result, `${codemodPath}/${c.caseName}`).toBe(expected);
    } else {
      expect(result, `${codemodPath}/${c.caseName} (no expected.* → expect no change)`).toBeNull();
    }
  }
}

describe("codemod transforms", () => {
  test("v2/define-generators-to-plugins transforms correctly", async () => {
    await runFixtureCases("v2/define-generators-to-plugins");
  });

  test("v2/test-run-arg-input transforms correctly", async () => {
    await runFixtureCases("v2/test-run-arg-input");
  });

  test("v2/sdk-skills-shim transforms correctly", async () => {
    await runFixtureCases("v2/sdk-skills-shim");
  });

  test("v2/principal-unify transforms correctly", async () => {
    await runFixtureCases("v2/principal-unify");
  });

  test("v2/apply-to-deploy transforms correctly", async () => {
    await runFixtureCases("v2/apply-to-deploy");
  });

  test("v2/cli-rename transforms correctly", async () => {
    await runFixtureCases("v2/cli-rename");
  });

  test("v2/auth-invoker-unwrap transforms correctly", async () => {
    await runFixtureCases("v2/auth-invoker-unwrap");
  });

  test("v2/tailordb-namespace transforms correctly", async () => {
    await runFixtureCases("v2/tailordb-namespace");
  });
});
