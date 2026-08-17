import * as path from "pathe";

// Match the start of a `setup branch` invocation only as part of a tailor CLI
// command (`tailor`, the v1 `tailor-sdk` binary, or their Windows launcher
// forms) so `setup tag` / `setup preview` — whose `--branch` keeps its name —
// and prose that merely mentions the subcommand are left alone. Tokens may be
// separated by backslash-newline shell continuations as well as spaces.
const TOKEN_SEPARATOR = "(?:[ \\t]|\\\\\\r?\\n)+";
const COMMAND_START = new RegExp(
  `(?<![\\w.-])tailor(?:-sdk)?(?:\\.(?:cmd|ps1|exe))?${TOKEN_SEPARATOR}setup${TOKEN_SEPARATOR}branch(?![\\w.-])`,
  "g",
);

// One shell token after a separator: a quoted string (never rewritten) or a
// bare word. Stops at newlines without a continuation and at `;`, `&`, `|`,
// which end the command.
const NEXT_TOKEN = new RegExp(`${TOKEN_SEPARATOR}("[^"\\n]*"|'[^'\\n]*'|[^\\s;&|]+)`, "y");

function replaceCommand(value: string): string {
  let result = "";
  let cursor = 0;
  COMMAND_START.lastIndex = 0;
  for (let match = COMMAND_START.exec(value); match; match = COMMAND_START.exec(value)) {
    let pos = COMMAND_START.lastIndex;
    result += value.slice(cursor, pos);
    NEXT_TOKEN.lastIndex = pos;
    for (let token = NEXT_TOKEN.exec(value); token; token = NEXT_TOKEN.exec(value)) {
      const chunk = token[0];
      const word = token[1]!;
      if (word === "--branch" || word.startsWith("--branch=")) {
        const separator = chunk.slice(0, chunk.length - word.length);
        result += `${separator}--trigger-branch${word.slice("--branch".length)}`;
      } else {
        result += chunk;
      }
      pos = NEXT_TOKEN.lastIndex;
      // A command substitution starts a nested command whose own `--branch`
      // must not be renamed; leave the rest for residual detection.
      if (word.includes("$(") || word.includes("`")) break;
    }
    cursor = pos;
    COMMAND_START.lastIndex = pos;
  }
  result += value.slice(cursor);
  return result;
}

function transformText(source: string): string | null {
  const updated = replaceCommand(source);
  return updated === source ? null : updated;
}

function transformPackageJson(source: string): string | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(source) as Record<string, unknown>;
  } catch {
    return null;
  }

  let modified = false;
  const scripts = parsed.scripts;
  if (typeof scripts === "object" && scripts != null && !Array.isArray(scripts)) {
    for (const [name, value] of Object.entries(scripts as Record<string, unknown>)) {
      if (typeof value !== "string") continue;
      const updated = replaceCommand(value);
      if (updated !== value) {
        (scripts as Record<string, string>)[name] = updated;
        modified = true;
      }
    }
  }

  if (!modified) return null;
  const trailing = source.endsWith("\n") ? "\n" : "";
  return JSON.stringify(parsed, null, 2) + trailing;
}

/**
 * Rename the `--branch` option of `tailor setup branch` invocations to
 * `--trigger-branch`.
 *
 * `--branch` remains as a deprecated alias until v3, where only
 * `--trigger-branch` is recognized. `setup tag`, `setup preview`, and
 * `setup coordinate` keep their own `--branch` option unchanged.
 * @param source - File contents
 * @param filePath - Absolute path to the file (used to dispatch package.json vs text)
 * @returns Transformed source or null when nothing matched.
 */
export default function transform(source: string, filePath: string): string | null {
  if (!source.includes("--branch")) return null;

  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".json") return transformPackageJson(source);
  return transformText(source);
}
