import { glob } from "node:fs/promises";
import * as path from "pathe";

const DEFAULT_PATTERN = "**/*.{ts,tsx}";
const DEFAULT_EXCLUDE = ["**/node_modules/**", "**/dist/**", "**/.git/**"];

/**
 * Collect TypeScript files from a project directory for migration.
 * @param projectRoot - The project root directory
 * @returns Array of absolute file paths
 */
export async function collectFiles(projectRoot: string): Promise<string[]> {
  const files: string[] = [];
  for await (const file of glob(DEFAULT_PATTERN, { cwd: projectRoot, exclude: DEFAULT_EXCLUDE })) {
    files.push(path.resolve(projectRoot, file));
  }
  return files.sort();
}
