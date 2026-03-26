import * as fs from "node:fs";
import * as path from "pathe";
import { expect } from "vitest";

const FIXTURES_DIR = path.resolve(import.meta.dirname);

/**
 * Run a fixture-based test for a migration rule.
 * Reads input.ts, applies the rule's transform logic, and compares with output.ts.
 * @param fixtureName - Path relative to __test_fixtures__ (e.g., "v2/sample")
 * @param transformSource - Function that transforms source code (extracted from the rule)
 */
export async function runFixtureTest(
  fixtureName: string,
  transformSource: (source: string) => string | null,
): Promise<void> {
  const fixtureDir = path.join(FIXTURES_DIR, fixtureName);
  const inputPath = path.join(fixtureDir, "input.ts");
  const outputPath = path.join(fixtureDir, "output.ts");

  const input = await fs.promises.readFile(inputPath, "utf-8");
  const expectedOutput = await fs.promises.readFile(outputPath, "utf-8");

  const result = transformSource(input);

  expect(result).not.toBeNull();
  expect(result).toBe(expectedOutput);
}

/**
 * List all fixture directories under a given version directory.
 * @param version - Version directory name (e.g., "v2")
 * @returns Array of fixture directory names
 */
export async function listFixtures(version: string): Promise<string[]> {
  const versionDir = path.join(FIXTURES_DIR, version);
  try {
    const entries = await fs.promises.readdir(versionDir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}
