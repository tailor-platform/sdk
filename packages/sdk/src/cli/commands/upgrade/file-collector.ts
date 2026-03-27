import { glob } from "node:fs/promises";
import * as path from "pathe";

const DEFAULT_PATTERN = "**/*.{ts,tsx,mts,cts}";
const DEFAULT_EXCLUDE = [
  "**/node_modules/**",
  "**/dist/**",
  "**/.git/**",
  "**/*.d.ts",
  "**/*.d.mts",
  "**/*.d.cts",
];

/**
 * Collect files from a project directory for migration.
 * @param projectRoot - The project root directory
 * @param patterns - Custom file glob patterns. Defaults to TypeScript patterns when omitted.
 * @returns Array of absolute file paths
 */
export async function collectFiles(projectRoot: string, patterns?: string[]): Promise<string[]> {
  const filePatterns = patterns ?? [DEFAULT_PATTERN];
  const fileSet = new Set<string>();
  for (const pattern of filePatterns) {
    for await (const file of glob(pattern, { cwd: projectRoot, exclude: DEFAULT_EXCLUDE })) {
      fileSet.add(path.resolve(projectRoot, file));
    }
  }
  return [...fileSet].sort();
}
