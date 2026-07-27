import * as path from "pathe";
import type { LlmReviewFinding } from "../../../../src/types";

// Match the generated seed runner invocation, anchored on `node` plus the
// `<dir>/exec.mjs` path. A bare `exec.mjs` is too generic to rewrite: only an
// invocation that runs it through node under a directory is the seed runner.
// The runner path is captured so the leading `node` flags can be replaced
// wholesale by the CLI command.
const NODE_BINARY = "(?<![\\w.-])node(?![\\w-])";
const NODE_FLAG = "(?:-[^\\s'\"`;&|]*|--[^\\s'\"`;&|]*)";
// seedPlugin's `distPath` is user-configured, so the runner path varies
// (`./seed`, `./src/seed`, `.tailor-sdk`). Requiring the parent segment to name
// seed or a Tailor output directory keeps an unrelated `tools/exec.mjs` from
// being rewritten, since `exec.mjs` on its own is a generic script name.
const RUNNER_DIR = "(?:[\\w.@~/-]*/)?(?:[\\w.-]*seed[\\w.-]*|\\.tailor(?:-sdk)?)";
const RUNNER_PATH = `${RUNNER_DIR}/exec\\.mjs`;
// The optional trailing group consumes the runner's own `validate` positional
// so the replacement can pick the matching `tailor seed` subcommand in one pass.
const RUNNER_PATTERN = new RegExp(
  `${NODE_BINARY}((?:\\s+${NODE_FLAG})*)\\s+(['"]?)${RUNNER_PATH}\\2(\\s+validate(?![-\\w]))?`,
  "g",
);

// `fork()` runs the runner as a child Node module and is typically awaited
// through a hand-rolled Promise around `child.on("close", ...)`. The plugin
// binary is CLI-dispatched, so migrating those call sites also unwinds the
// surrounding async plumbing — out of reach of a single-file text rewrite.
const FORK_PATTERN = /(?<![\w.$])fork\s*\(/;

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);

// Node's own env-file flags carry over to the CLI, which accepts the same names
// but only in the space-separated form. Every other node flag (loaders, memory
// limits) belongs to running a script and has no CLI equivalent.
const ENV_FILE_FLAG_PATTERN = /^--(env-file|env-file-if-exists)=(.+)$/;

/** Translate the leading `node` flags into flags the CLI command accepts. */
function carriedOverFlags(nodeFlags: string): string {
  const carried: string[] = [];
  for (const flag of nodeFlags.trim().split(/\s+/).filter(Boolean)) {
    const envFile = ENV_FILE_FLAG_PATTERN.exec(flag);
    if (envFile) carried.push(`--${envFile[1]} ${envFile[2]}`);
  }
  return carried.map((flag) => ` ${flag}`).join("");
}

/**
 * Rewrite runner invocations. The runner spells validation as its first
 * positional argument, so a consumed `validate` selects the subcommand.
 */
function rewrite(value: string, prefix = ""): string {
  return value.replace(RUNNER_PATTERN, (_match, nodeFlags: string, _quote, validate?: string) => {
    const command = validate ? "validate" : "apply";
    return `${prefix}tailor seed ${command}${carriedOverFlags(nodeFlags)}`;
  });
}

function transformText(source: string): string | null {
  const updated = rewrite(source);
  return updated === source ? null : updated;
}

/**
 * Source files reach the plugin through a package runner rather than the bare
 * binary, since the plugin executable is resolved from the project's
 * node_modules rather than the PATH.
 */
function transformSourceText(source: string): string | null {
  if (FORK_PATTERN.test(source)) return null;
  const updated = rewrite(source, "pnpm ");
  return updated === source ? null : updated;
}

function transformPackageJson(source: string): string | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(source) as Record<string, unknown>;
  } catch {
    return null;
  }

  const scripts = parsed.scripts;
  if (typeof scripts !== "object" || scripts == null || Array.isArray(scripts)) return null;

  let modified = false;
  for (const [name, value] of Object.entries(scripts as Record<string, unknown>)) {
    if (typeof value !== "string") continue;
    const updated = rewrite(value);
    if (updated !== value) {
      (scripts as Record<string, string>)[name] = updated;
      modified = true;
    }
  }

  if (!modified) return null;
  const trailing = source.endsWith("\n") ? "\n" : "";
  return JSON.stringify(parsed, null, 2) + trailing;
}

/**
 * Rewrite generated seed runner invocations to the `tailor seed` CLI plugin.
 * @param source - File contents
 * @param filePath - Absolute path to the file (used to dispatch package.json vs source vs text)
 * @returns Transformed source or null when nothing matched.
 */
export default function transform(source: string, filePath: string): string | null {
  if (!source.includes("exec.mjs")) return null;

  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".json") return transformPackageJson(source);
  if (SOURCE_EXTENSIONS.has(ext)) return transformSourceText(source);
  return transformText(source);
}

/**
 * Report `fork()` call sites the transform declined, so the migration surfaces
 * the async-plumbing rewrite instead of silently leaving a stale invocation.
 * @param source - Post-transform file contents
 * @param filePath - Absolute path to the file
 * @param relativePath - Path relative to the transformed project root
 * @returns Locations that need manual migration.
 */
export function reviewFindings(
  source: string,
  filePath: string,
  relativePath: string,
): LlmReviewFinding[] {
  const ext = path.extname(filePath).toLowerCase();
  if (!SOURCE_EXTENSIONS.has(ext)) return [];
  if (!source.includes("exec.mjs") || !FORK_PATTERN.test(source)) return [];

  return source
    .split(/\r\n|\n|\r/)
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => FORK_PATTERN.test(line))
    .map(({ line, number }) => ({
      file: relativePath,
      line: number,
      message:
        'Replace the fork()-based seed runner call with execSync("pnpm tailor seed apply"), forwarding env/stdio, and unwind the surrounding await/Promise plumbing.',
      excerpt: line.trim(),
    }));
}
