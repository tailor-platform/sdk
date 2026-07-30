import * as path from "pathe";
import type { LlmReviewFinding } from "../../../../src/types";

// Match the generated seed runner invocation, anchored on `node` plus the
// `<distPath>/exec.mjs` path. seedPlugin's `distPath` is a required, arbitrary
// option, so the directory cannot be pattern-matched by name; requiring a
// directory segment at all is what separates the generated runner from a
// project's own top-level `exec.mjs`.
const NODE_BINARY = "(?<![\\w.-])node(?![\\w-])";
const ARG_VALUE = `(?:[^\\s'"\`;&|]+|'[^']*'|"(?:(?:\\\\.)|[^"\\\\])*")`;
// Shell line continuations join one command; other newlines still separate YAML
// sequence items and markdown bullets that must not be rewritten together.
const SPACE = String.raw`(?:[^\S\n\r]|\\\r?\n)+`;
// Value-taking node flags must consume their value, or the value itself is read
// as the next flag and the runner path stops matching.
const VALUE_NODE_FLAG = "(?:--env-file|--env-file-if-exists|--import|--require|-r)";
// One alternative per leading-dash count, each requiring a body, so a flag token
// has a single split point; overlapping alternatives backtrack exponentially.
const BOOLEAN_NODE_FLAG = "(?:--[^\\s'\"`;&|]+|-[^\\s'\"`;&|=-][^\\s'\"`;&|=]*)";
const NODE_FLAGS = `(?:(?:${SPACE}${VALUE_NODE_FLAG}(?:=${ARG_VALUE}|${SPACE}${ARG_VALUE}))|(?:${SPACE}${BOOLEAN_NODE_FLAG}))*`;
const RUNNER_PATH = `(?:[\\w.@~-]+/)+exec\\.mjs`;
// The optional trailing group consumes the runner's own `validate` positional
// so the replacement can pick the matching `tailor seed` subcommand in one pass.
const RUNNER_PATTERN = new RegExp(
  `${NODE_BINARY}(${NODE_FLAGS})${SPACE}(['"]?)(?:\\./)?${RUNNER_PATH}\\2(${SPACE}validate(?![-\\w=.:/]))?`,
  "g",
);

// `fork()` runs the runner as a child Node module and is typically awaited
// through a hand-rolled Promise around `child.on("close", ...)`. The plugin
// binary is CLI-dispatched, so migrating those call sites also unwinds the
// surrounding async plumbing — out of reach of a single-file text rewrite.
const FORK_PATTERN = /(?<![\w.$])fork\s*\(/;
// Matched against the whole source rather than per line, so a `fork(` call whose
// runner path sits on a later line is still reported.
const FORK_RUNNER_PATTERN = new RegExp(`${FORK_PATTERN.source}\\s*(['"\`])${RUNNER_PATH}\\1`, "gs");

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);

// Only node's env-file flags have a CLI equivalent; loaders and memory limits
// belong to running a script. Matched per flag so a value that itself looks like
// `--env-file` is consumed as a value rather than read as a flag.
const NODE_FLAG_PATTERN = new RegExp(
  `(${VALUE_NODE_FLAG})(?:=(${ARG_VALUE})|${SPACE}(${ARG_VALUE}))|(${BOOLEAN_NODE_FLAG})`,
  "g",
);
const ENV_FILE_FLAG = /^--env-file(?:-if-exists)?$/;
// A package runner immediately before `node` already resolves project binaries.
const RUNNER_PREFIX_PATTERN = new RegExp(
  `(?<![\\w.-])(?:pnpm|npm|yarn|bunx|bun|npx)(?:${SPACE}(?:run|exec|dlx))?${SPACE}$`,
);
// Keeps the lookbehind on a fixed slice instead of the whole preceding file.
const RUNNER_PREFIX_WINDOW = 64;

/** Translate the leading `node` flags into flags the CLI command accepts. */
function carriedOverFlags(nodeFlags: string): string {
  return [...nodeFlags.matchAll(NODE_FLAG_PATTERN)]
    .filter((match) => match[1] != null && ENV_FILE_FLAG.test(match[1]))
    .map((match) => ` ${match[1]} ${match[2] ?? match[3]}`)
    .join("");
}

/**
 * Rewrite runner invocations. The runner spells validation as its first
 * positional argument, so a consumed `validate` selects the subcommand.
 */
function rewrite(value: string, prefix = ""): string {
  return value.replace(
    RUNNER_PATTERN,
    (_match, nodeFlags: string, _quote, validate: string | undefined, offset: number) => {
      const command = validate ? "validate" : "apply";
      // A package runner already in front of `node` stays; prefixing again
      // would produce `pnpm pnpm tailor`.
      const before = value.slice(Math.max(0, offset - RUNNER_PREFIX_WINDOW), offset);
      const runner = RUNNER_PREFIX_PATTERN.test(before) ? "" : prefix;
      return `${runner}tailor seed ${command}${carriedOverFlags(nodeFlags)}`;
    },
  );
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
  const updated = rewrite(source, "npx ");
  if (FORK_PATTERN.test(source) && updated.includes("exec.mjs")) return null;
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

  const lines = source.split(/\r\n|\n|\r/);

  return [...source.matchAll(FORK_RUNNER_PATTERN)].map((match) => {
    const index = source.slice(0, match.index).split(/\r\n|\n|\r/).length - 1;
    return {
      file: relativePath,
      line: index + 1,
      message:
        'Replace the fork()-based seed runner call with execSync("npx tailor seed apply"), forwarding env/stdio, and unwind the surrounding await/Promise plumbing.',
      excerpt: lines[index]!.trim(),
    };
  });
}
