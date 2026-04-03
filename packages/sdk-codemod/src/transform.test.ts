import * as fs from "node:fs";
import * as path from "pathe";
import { describe, expect, it } from "vitest";
import type { TransformFn } from "./runner";

const CODEMODS_DIR = path.resolve(__dirname, "../codemods");

/**
 * Run a transform against its fixture files (input.ts → expected.ts).
 * @param codemodPath - Relative path from the codemods root
 */
async function runFixtureTest(codemodPath: string): Promise<void> {
  const scriptPath = path.join(CODEMODS_DIR, codemodPath, "scripts/transform.ts");
  const inputPath = path.join(CODEMODS_DIR, codemodPath, "tests/basic/input.ts");
  const expectedPath = path.join(CODEMODS_DIR, codemodPath, "tests/basic/expected.ts");

  const input = await fs.promises.readFile(inputPath, "utf-8");
  const expected = await fs.promises.readFile(expectedPath, "utf-8");

  const mod = await import(scriptPath);
  const transform = mod.default as TransformFn;

  const result = await transform(input, inputPath);

  expect(result).not.toBeNull();
  expect(result).toBe(expected);
}

describe("codemod transforms", () => {
  it("v2/define-generators-to-plugins transforms correctly", async () => {
    await runFixtureTest("v2/define-generators-to-plugins");
  });
});
