import * as fs from "node:fs";
import * as path from "pathe";
import { logger } from "#/cli/shared/logger";

export interface FileLoadConfig {
  files: string[];
  ignores?: string[];
}

const DEFAULT_IGNORE_PATTERNS = ["**/*.test.ts", "**/*.spec.ts"];

// loadFilesWithIgnores is called once per service/bundler, so a single
// generate/apply run can call it multiple times for the same baseDir (once
// per resolver/executor/tailordb/etc. config sharing that directory). Track
// which (baseDir, patterns) pairs have already warned so each one only warns
// once per run — keyed by patterns too, since different services sharing a
// baseDir can have different `files` patterns each needing their own warning.
const warnedFallbacks = new Set<string>();

/**
 * Load files matching the given patterns, excluding files that match ignore patterns.
 * A `files` entry starting with `!` excludes the files it matches; for each file, the last
 * `files` entry that matches it decides. Each file is returned once.
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
  const allPositivePatternsAbsolute = config.files
    .filter((pattern) => !pattern.startsWith("!"))
    .every((pattern) => path.isAbsolute(pattern));
  if (resolved.matchedAnyPattern || baseDir === process.cwd() || allPositivePatternsAbsolute) {
    return resolved.files;
  }

  // v1 compatibility fallback: pre-existing configs may have relative
  // patterns written against the invocation cwd rather than baseDir. Only
  // triggers when baseDir's patterns matched nothing at all (not merely
  // "matched, but every hit got filtered out by ignores") — otherwise this
  // fallback would reintroduce the same cross-app file bleed this baseDir
  // resolution is meant to prevent. Also skipped when every non-`!` pattern
  // is already absolute, since baseDir can't change an absolute pattern's
  // resolution — re-running against cwd would just repeat the same glob.
  // Remove this fallback in v2, once such configs are expected to have
  // migrated.
  const fallbackKey = `${baseDir}\0${config.files.join("\0")}`;
  if (!warnedFallbacks.has(fallbackKey)) {
    warnedFallbacks.add(fallbackKey);
    logger.warn(
      `No files matched "${config.files.join(", ")}" relative to "${baseDir}"; falling back to ` +
        `process.cwd(). Update this config's file patterns to be relative to its own directory ` +
        `before v2, when this fallback will be removed.`,
    );
  }
  return resolveFiles(config, process.cwd()).files;
}

interface ResolvedFiles {
  files: string[];
  /** Whether any non-`!` `files` pattern matched anything under baseDir, before any exclusion. */
  matchedAnyPattern: boolean;
}

function resolveFiles(config: FileLoadConfig, baseDir: string): ResolvedFiles {
  // Use user-provided patterns if specified, otherwise use defaults. Default
  // patterns are left unanchored ("**/*.test.ts") so they match a test file
  // regardless of which directory a `files` pattern's matches actually came
  // from — this matters when a pattern is absolute or otherwise escapes
  // baseDir. User-provided patterns are baseDir-relative, matching `files`.
  const isDefaultIgnores = config.ignores === undefined;
  const ignorePatterns = config.ignores ?? DEFAULT_IGNORE_PATTERNS;
  const resolvedIgnorePatterns = isDefaultIgnores
    ? ignorePatterns
    : ignorePatterns.map((ignorePattern) => path.resolve(baseDir, ignorePattern));

  const rules = config.files.map((pattern) => parseFilePattern(pattern, baseDir));
  // Map insertion order keeps each file at the position its first match produced.
  const lastPositiveRuleIndex = new Map<string, number>();
  let matchedAnyPattern = false;
  rules.forEach((rule, ruleIndex) => {
    if (rule.negated) return;
    try {
      const matchedFiles = fs.globSync(rule.absolutePattern);
      if (matchedFiles.length > 0) {
        matchedAnyPattern = true;
      }
      for (const file of matchedFiles) {
        lastPositiveRuleIndex.set(file, ruleIndex);
      }
    } catch (error) {
      // A glob failure means we don't know whether baseDir has matching
      // files, not that it has none — treat it as a match so it can't
      // trigger the v1 compatibility fallback below.
      matchedAnyPattern = true;
      logger.warn(`Failed to glob pattern "${rule.pattern}": ${String(error)}`);
    }
  });

  const files = [...lastPositiveRuleIndex]
    .filter(
      ([file, ruleIndex]) =>
        !rules
          .slice(ruleIndex + 1)
          .some((rule) => rule.negated && path.matchesGlob(file, rule.absolutePattern)),
    )
    .map(([file]) => file)
    .filter(
      (file) =>
        !resolvedIgnorePatterns.some((ignorePattern) => path.matchesGlob(file, ignorePattern)),
    );

  return { files, matchedAnyPattern };
}

interface FilePatternRule {
  /** The `files` entry as written. */
  pattern: string;
  /** Whether the entry starts with `!` and excludes the files it matches. */
  negated: boolean;
  /** The entry without its `!`, resolved against baseDir. */
  absolutePattern: string;
}

function parseFilePattern(pattern: string, baseDir: string): FilePatternRule {
  const negated = pattern.startsWith("!");
  const glob = negated ? pattern.slice(1) : pattern;
  return { pattern, negated, absolutePattern: path.resolve(baseDir, glob) };
}
