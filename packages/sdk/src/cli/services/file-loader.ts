import * as fs from "node:fs";
import * as path from "pathe";
import { logger } from "#/cli/shared/logger";

export interface FileLoadConfig {
  files: string[];
  ignores?: string[];
}

const DEFAULT_IGNORE_PATTERNS = ["**/*.test.ts", "**/*.spec.ts"];

/**
 * Load files matching the given patterns, excluding files that match ignore patterns.
 * By default, test files (*.test.ts, *.spec.ts) are excluded unless ignores is explicitly specified.
 * @param config - Configuration with files patterns and optional ignores patterns
 * @param baseDir - Directory relative patterns are resolved against
 * @returns Array of absolute file paths
 */
export function loadFilesWithIgnores(config: FileLoadConfig, baseDir: string): string[] {
  if (config.files.length === 0) {
    return [];
  }

  const resolved = resolveFiles(config, baseDir);
  const allPatternsAbsolute = config.files.every((pattern) => path.isAbsolute(pattern));
  if (resolved.matchedAnyPattern || baseDir === process.cwd() || allPatternsAbsolute) {
    return resolved.files;
  }

  // v1 compatibility fallback: pre-existing configs may have relative
  // patterns written against the invocation cwd rather than baseDir. Only
  // triggers when baseDir's patterns matched nothing at all (not merely
  // "matched, but every hit got filtered out by ignores") — otherwise this
  // fallback would reintroduce the same cross-app file bleed this baseDir
  // resolution is meant to prevent. Also skipped when every pattern is
  // already absolute, since baseDir can't change an absolute pattern's
  // resolution — re-running against cwd would just repeat the same glob.
  // Remove this fallback in v2, once such configs are expected to have
  // migrated.
  logger.warn(
    `No files matched "${config.files.join(", ")}" relative to "${baseDir}"; falling back to ` +
      `process.cwd(). Update this config's file patterns to be relative to its own directory ` +
      `before v2, when this fallback will be removed.`,
  );
  return resolveFiles(config, process.cwd()).files;
}

interface ResolvedFiles {
  files: string[];
  /** Whether any `files` pattern matched anything under baseDir, before ignore filtering. */
  matchedAnyPattern: boolean;
}

function resolveFiles(config: FileLoadConfig, baseDir: string): ResolvedFiles {
  // Use user-provided patterns if specified, otherwise use defaults
  const ignorePatterns = config.ignores ?? DEFAULT_IGNORE_PATTERNS;

  const ignoreFiles = new Set<string>();
  for (const ignorePattern of ignorePatterns) {
    const absoluteIgnorePattern = path.resolve(baseDir, ignorePattern);
    try {
      const matchedIgnoreFiles = fs.globSync(absoluteIgnorePattern);
      matchedIgnoreFiles.forEach((file) => ignoreFiles.add(file));
    } catch (error) {
      logger.warn(`Failed to glob ignore pattern "${ignorePattern}": ${String(error)}`);
    }
  }

  const files: string[] = [];
  let matchedAnyPattern = false;
  for (const pattern of config.files) {
    const absolutePattern = path.resolve(baseDir, pattern);
    try {
      const matchedFiles = fs.globSync(absolutePattern);
      if (matchedFiles.length > 0) {
        matchedAnyPattern = true;
      }
      // Filter out ignored files
      const filteredFiles = matchedFiles.filter((file) => !ignoreFiles.has(file));
      files.push(...filteredFiles);
    } catch (error) {
      // A glob failure means we don't know whether baseDir has matching
      // files, not that it has none — treat it as a match so it can't
      // trigger the v1 compatibility fallback below.
      matchedAnyPattern = true;
      logger.warn(`Failed to glob pattern "${pattern}": ${String(error)}`);
    }
  }

  return { files, matchedAnyPattern };
}
