import * as fs from "node:fs";
import * as path from "pathe";
import { parse, Lang } from "@ast-grep/napi";
import { describe, expect, it } from "vitest";

const CODEMODS_DIR = path.resolve(__dirname, "../codemods");

/**
 * Run a transform against its fixture files (input.ts → expected.ts).
 * Uses @ast-grep/napi directly instead of the codemod CLI.
 * @param codemodPath - Relative path from the codemods root
 */
async function runFixtureTest(codemodPath: string): Promise<void> {
  const scriptPath = path.join(CODEMODS_DIR, codemodPath, "scripts/transform.ts");
  const inputPath = path.join(CODEMODS_DIR, codemodPath, "tests/basic/input.ts");
  const expectedPath = path.join(CODEMODS_DIR, codemodPath, "tests/basic/expected.ts");

  const input = await fs.promises.readFile(inputPath, "utf-8");
  const expected = await fs.promises.readFile(expectedPath, "utf-8");

  // Import the transform function
  const mod = await import(scriptPath);
  const transform = mod.default as (root: ReturnType<typeof parse>) => string | null;

  // Parse and transform
  const root = parse(Lang.TypeScript, input);
  const result = transform(root);

  expect(result).not.toBeNull();
  expect(result).toBe(expected);
}

describe("codemod transforms", () => {
  it("v2/define-generators-to-plugins transforms correctly", async () => {
    await runFixtureTest("v2/define-generators-to-plugins");
  });
});
