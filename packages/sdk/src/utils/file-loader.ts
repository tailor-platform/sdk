import * as fs from "node:fs";
import * as path from "pathe";

export interface FileLoadConfig {
  files: string[];
  ignores?: string[];
}

const TEST_FILE_SUFFIXES = [".test.ts", ".spec.ts"];

// Unanchored, so they also exclude test files a pattern reaching outside baseDir matches.
const DEFAULT_TEST_FILE_EXCLUSIONS: FilePatternRule[] = TEST_FILE_SUFFIXES.map((suffix) => ({
  pattern: `!**/*${suffix}`,
  negated: true,
  glob: `**/*${suffix}`,
}));

// Deduplicate compatibility warnings per destination, directory, and pattern set.
const warnedFallbacks = new WeakMap<(message: string) => void, Set<string>>();

/**
 * Load files matching the given patterns, excluding files that match ignore patterns.
 * A `files` entry starting with `!` excludes the files it matches; for each file, the last
 * `files` entry that matches it decides. Each file is returned once.
 * Unless ignores is specified, test files (*.test.ts, *.spec.ts) are excluded as if `!`
 * entries for them followed the last `files` entry that does not end in `.test.ts` or
 * `.spec.ts`, so entries ending in those after it include test files.
 * @param config - Configuration with files patterns and optional ignores patterns
 * @param baseDir - Directory relative patterns are resolved against
 * @param warn - Reports glob errors and compatibility warnings
 * @returns Array of absolute file paths
 */
export function loadFilesWithIgnores(
  config: FileLoadConfig,
  baseDir: string,
  warn: (message: string) => void,
): string[] {
  if (config.files.length === 0) {
    return [];
  }

  const resolved = resolveFiles(config, baseDir, warn);
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
  let warned = warnedFallbacks.get(warn);
  if (!warned) {
    warned = new Set<string>();
    warnedFallbacks.set(warn, warned);
  }
  if (!warned.has(fallbackKey)) {
    warned.add(fallbackKey);
    warn(
      `No files matched "${config.files.join(", ")}" relative to "${baseDir}"; falling back to ` +
        `process.cwd(). Update this config's file patterns to be relative to its own directory ` +
        `before v2, when this fallback will be removed.`,
    );
  }
  return resolveFiles(config, process.cwd(), warn).files;
}

interface ResolvedFiles {
  files: string[];
  /** Whether any non-`!` `files` pattern matched anything under baseDir, before any exclusion. */
  matchedAnyPattern: boolean;
}

function resolveFiles(
  config: FileLoadConfig,
  baseDir: string,
  warn: (message: string) => void,
): ResolvedFiles {
  const resolvedIgnorePatterns = (config.ignores ?? []).map((ignorePattern) =>
    path.resolve(baseDir, ignorePattern),
  );

  const rules = config.files.map((pattern) => parseFilePattern(pattern, baseDir));
  if (config.ignores === undefined) {
    const lastNonTestRuleIndex = rules.findLastIndex(
      (rule) => !rule.negated && !isTestFilePattern(rule.pattern),
    );
    rules.splice(lastNonTestRuleIndex + 1, 0, ...DEFAULT_TEST_FILE_EXCLUSIONS);
  }
  // Map insertion order keeps each file at the position its first match produced.
  const lastPositiveRuleIndex = new Map<string, number>();
  let matchedAnyPattern = false;
  rules.forEach((rule, ruleIndex) => {
    if (rule.negated) return;
    try {
      const matchedFiles = fs.globSync(rule.glob);
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
      warn(`Failed to glob pattern "${rule.pattern}": ${String(error)}`);
    }
  });

  const files = [...lastPositiveRuleIndex]
    .filter(
      ([file, ruleIndex]) =>
        !rules
          .slice(ruleIndex + 1)
          .some((rule) => rule.negated && path.matchesGlob(file, rule.glob)),
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
  glob: string;
}

function parseFilePattern(pattern: string, baseDir: string): FilePatternRule {
  const negated = pattern.startsWith("!");
  const glob = negated ? pattern.slice(1) : pattern;
  return { pattern, negated, glob: path.resolve(baseDir, glob) };
}

function isTestFilePattern(pattern: string): boolean {
  return TEST_FILE_SUFFIXES.some((suffix) => pattern.endsWith(suffix));
}
