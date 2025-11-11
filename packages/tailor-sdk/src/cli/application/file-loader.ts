import * as fs from "node:fs";
import * as path from "node:path";

export interface FileLoadConfig {
  files: string[];
  ignores?: string[];
}

const DEFAULT_IGNORE_PATTERNS = ["**/*.test.ts", "**/*.spec.ts"];

/**
 * Load files matching the given patterns, excluding files that match ignore patterns.
 * By default, test files (*.test.ts, *.spec.ts) are excluded.
 *
 * @param config - Configuration with files patterns and optional ignores patterns
 * @returns Array of absolute file paths
 */
export function loadFilesWithIgnores(config: FileLoadConfig): string[] {
  // Combine default ignore patterns with user-provided patterns
  const ignorePatterns = [
    ...DEFAULT_IGNORE_PATTERNS,
    ...(config.ignores || []),
  ];

  const ignoreFiles = new Set<string>();
  for (const ignorePattern of ignorePatterns) {
    const absoluteIgnorePattern = path.resolve(process.cwd(), ignorePattern);
    try {
      const matchedIgnoreFiles = fs.globSync(absoluteIgnorePattern);
      matchedIgnoreFiles.forEach((file) => ignoreFiles.add(file));
    } catch (error) {
      console.warn(`Failed to glob ignore pattern "${ignorePattern}":`, error);
    }
  }

  const files: string[] = [];
  for (const pattern of config.files) {
    const absolutePattern = path.resolve(process.cwd(), pattern);
    try {
      const matchedFiles = fs.globSync(absolutePattern);
      // Filter out ignored files
      const filteredFiles = matchedFiles.filter(
        (file) => !ignoreFiles.has(file),
      );
      files.push(...filteredFiles);
    } catch (error) {
      console.warn(`Failed to glob pattern "${pattern}":`, error);
    }
  }

  return files;
}
