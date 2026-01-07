import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@/cli/utils/logger";

export interface FileLoadConfig {
  files: string[];
  ignores?: string[];
}

const DEFAULT_IGNORE_PATTERNS = ["**/*.test.ts", "**/*.spec.ts"];

/**
 * Load files matching the given patterns, excluding files that match ignore patterns.
 * By default, test files (*.test.ts, *.spec.ts) are excluded unless ignores is explicitly specified.
 *
 * @param {FileLoadConfig} config - Configuration with files patterns and optional ignores patterns
 * @returns {string[]} Array of absolute file paths
 */
export function loadFilesWithIgnores(config: FileLoadConfig): string[] {
  // Use user-provided patterns if specified, otherwise use defaults
  const ignorePatterns = config.ignores ?? DEFAULT_IGNORE_PATTERNS;

  const ignoreFiles = new Set<string>();
  for (const ignorePattern of ignorePatterns) {
    const absoluteIgnorePattern = path.resolve(process.cwd(), ignorePattern);
    try {
      const matchedIgnoreFiles = fs.globSync(absoluteIgnorePattern);
      matchedIgnoreFiles.forEach((file) => ignoreFiles.add(file));
    } catch (error) {
      logger.warn(`Failed to glob ignore pattern "${ignorePattern}": ${String(error)}`);
    }
  }

  const files: string[] = [];
  for (const pattern of config.files) {
    const absolutePattern = path.resolve(process.cwd(), pattern);
    try {
      const matchedFiles = fs.globSync(absolutePattern);
      // Filter out ignored files
      const filteredFiles = matchedFiles.filter((file) => !ignoreFiles.has(file));
      files.push(...filteredFiles);
    } catch (error) {
      logger.warn(`Failed to glob pattern "${pattern}": ${String(error)}`);
    }
  }

  return files;
}
