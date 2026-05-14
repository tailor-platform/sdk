import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export type ChallengeStage = "generate" | "apiCheck" | "typecheck" | "tests";

export type ContextProfile = "types-only" | "docs-only" | "tailor-sdk-skill" | "full-package";

export type ApiCheckPattern = {
  name: string;
  pattern: string;
  message?: string;
  files?: string[];
  /**
   * What text the pattern is applied to.
   * - `"code"` (default): comments and string/template bodies are blanked, import/export
   *   module specifiers are preserved. Use this for API-shape patterns to avoid false
   *   positives from comments and string contents.
   * - `"raw"`: the original source is matched verbatim. Use this when the pattern targets
   *   string-valued config (e.g. legacy package names passed to `defineGenerators`).
   */
  searchScope?: "code" | "raw";
};

/**
 * Per-file required identifiers. AST-precise check that complements the
 * regex-based `requiredPatterns`: while a pattern matches a shape (e.g.
 * `db.type(...).hooks(...)`), `requiredSymbols` asserts that a specific name
 * appears in a specific file. Inspired by Anthropic's "what agents omit"
 * principle in writing-tools-for-agents — surfaces missing symbols as a
 * first-class signal rather than letting them hide behind a downstream
 * typecheck or test failure.
 *
 * Keys are workDir-relative file paths from `files.implement`; values are
 * identifier names that must appear as a reference (any Identifier AST node)
 * in that file.
 */
export type RequiredSymbolsConfig = Record<string, string[]>;

export type ApiCheckConfig = {
  checkUnknownSdkImports?: boolean;
  requiredSdkImports?: string[];
  forbiddenSdkImports?: string[];
  requiredPatterns?: ApiCheckPattern[];
  forbiddenPatterns?: ApiCheckPattern[];
  requiredSymbols?: RequiredSymbolsConfig;
};

/**
 * Held-out split for overfit detection. Adapted from Anthropic's
 * "writing-tools-for-agents" methodology: optimize against `train`, verify
 * against `holdout`. `regression` is for problems that already pass and exist
 * to guard against regressions when API changes land. Defaults to `train` when
 * omitted so the existing problem set keeps current semantics.
 */
export type ProblemSplit = "train" | "holdout" | "regression";

export type ProblemMeta = {
  id: string;
  name: string;
  difficulty: "easy" | "medium" | "hard";
  category: string;
  split?: ProblemSplit;
  contextProfiles?: ContextProfile[];
  scoring: {
    generate: number;
    apiCheck?: number;
    typecheck: number;
    tests: number;
  };
  files: {
    implement: string[];
    scaffold: string[];
  };
  apiCheck?: ApiCheckConfig;
};

export function getProblemSplit(meta: ProblemMeta): ProblemSplit {
  return meta.split ?? "train";
}

export function loadMeta(problemDir: string): ProblemMeta {
  const metaPath = path.join(problemDir, "meta.json");
  const content = fs.readFileSync(metaPath, "utf-8");
  return JSON.parse(content) as ProblemMeta;
}

/**
 * List all problem directories sorted by ID.
 *
 * Accepts legacy three-digit IDs (`001-foo`), Phase 2 micro-problem IDs
 * (`m01-foo`), and Phase 2.5 harder-tier IDs (`h01-foo`). Directories beginning
 * with `_` (e.g. `_shared`) are excluded — they hold cross-problem assets, not
 * runnable problems. The `archived/` sub-directory is also excluded by
 * default: graduated problems (5 consecutive passRate=1.0) live there and
 * are skipped by `challenge:solve`. Pass `{ includeArchived: true }` to
 * re-include them — useful for `challenge:analyze --include-archived` so
 * trend lines remain continuous past a graduation.
 */
export function listProblems(
  baseDir: string,
  options: { includeArchived?: boolean } = {},
): string[] {
  const problemsDir = path.join(baseDir, "problems");
  if (!fs.existsSync(problemsDir)) {
    return [];
  }
  const idRegex = /^(\d{3}|m\d+|h\d+)-/;
  const active = fs
    .readdirSync(problemsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_") && idRegex.test(d.name))
    .map((d) => d.name);
  if (!options.includeArchived) return active.sort();
  const archivedDir = path.join(problemsDir, "archived");
  let archived: string[] = [];
  if (fs.existsSync(archivedDir)) {
    archived = fs
      .readdirSync(archivedDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && idRegex.test(d.name))
      .map((d) => path.join("archived", d.name));
  }
  return [...active, ...archived].sort();
}

/**
 * Copy directory recursively.
 */
export function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Import a module from a filesystem path, converting to file URL for cross-platform compatibility.
 * Raw filesystem paths break on Windows ESM (ERR_UNSUPPORTED_ESM_URL_SCHEME).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic imports in tests need flexible typing
export function importPath(filePath: string): Promise<Record<string, any>> {
  return import(pathToFileURL(filePath).href) as Promise<Record<string, any>>;
}

/**
 * Build a problem key string from ID and name, used consistently across runner files.
 *
 * Phase 2 micro-problem IDs (e.g. `m01-db-field-unique-required`) already
 * include the slug, so when `problemName` repeats the slug portion we collapse
 * to just `problemId` to avoid `m01-db-field-unique-required-db-field-unique-required`.
 */
export function problemKey(problemId: string, problemName: string): string {
  if (!problemName) {
    return problemId;
  }
  if (problemId === problemName || problemId.endsWith(`-${problemName}`)) {
    return problemId;
  }
  return `${problemId}-${problemName}`;
}

/**
 * Parse a required CLI argument value at position i+1.
 * Exits with an error if the value is missing.
 */
export function requireArg(args: string[], i: number, flag: string): string {
  if (i + 1 >= args.length) {
    console.error(`Error: ${flag} requires a value`);
    process.exit(1);
  }
  return args[i + 1]!;
}

/**
 * Format a duration in milliseconds as a human-readable string (e.g. "2m30s" or "45s").
 */
export function formatDuration(ms: number): string {
  const secs = ms / 1000;
  const mins = Math.floor(secs / 60);
  const remainSecs = Math.round(secs % 60);
  return mins > 0 ? `${mins}m${remainSecs}s` : `${remainSecs}s`;
}

/**
 * Read SDK version from package.json.
 */
export function getSdkVersion(challengeRoot: string): string | undefined {
  try {
    const sdkPkgPath = path.join(challengeRoot, "..", "packages", "sdk", "package.json");
    const sdkPkg = JSON.parse(fs.readFileSync(sdkPkgPath, "utf-8")) as { version: string };
    return sdkPkg.version;
  } catch {
    return undefined;
  }
}

/**
 * Replace filename-unsafe characters with dashes.
 */
export function sanitizeForFilename(label: string): string {
  return label.replace(/[/\\:*?"<>|]/g, "-");
}

/**
 * Filesystem-safe ISO timestamp (`YYYY-MM-DDTHH-MM-SS`) used to derive run IDs
 * and experiment IDs. Colons in standard ISO 8601 break file paths on Windows
 * (and look ugly elsewhere), so we replace them with dashes and drop the
 * milliseconds + Z suffix for compactness.
 */
export function createTimestampId(): string {
  return new Date().toISOString().replace(/:/g, "-").slice(0, 19);
}
