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

export type ApiCheckConfig = {
  checkUnknownSdkImports?: boolean;
  requiredSdkImports?: string[];
  forbiddenSdkImports?: string[];
  requiredPatterns?: ApiCheckPattern[];
  forbiddenPatterns?: ApiCheckPattern[];
};

export type ProblemMeta = {
  id: string;
  name: string;
  difficulty: "easy" | "medium" | "hard";
  category: string;
  apiSurfaces?: string[];
  evaluationGoal?: "api-design" | "integration";
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

export function loadMeta(problemDir: string): ProblemMeta {
  const metaPath = path.join(problemDir, "meta.json");
  const content = fs.readFileSync(metaPath, "utf-8");
  return JSON.parse(content) as ProblemMeta;
}

/**
 * List all problem directories sorted by ID.
 */
export function listProblems(baseDir: string): string[] {
  const problemsDir = path.join(baseDir, "problems");
  if (!fs.existsSync(problemsDir)) {
    return [];
  }
  return fs
    .readdirSync(problemsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{3}-/.test(d.name))
    .map((d) => d.name)
    .sort();
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
 */
export function problemKey(problemId: string, problemName: string): string {
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
