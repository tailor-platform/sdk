import * as path from "pathe";

// Match `setup renovate` only as part of a tailor CLI invocation (`tailor`,
// the v1 `tailor-sdk` binary, or their Windows launcher forms) so prose that
// merely mentions the subcommand name is left alone. Tokens may be separated
// by backslash-newline shell continuations as well as spaces. The leading
// lookbehind keeps other binaries (e.g. `custom-tailor`) and the trailing
// lookahead keeps similarly named tokens (e.g. a `renovate.json` file path)
// from being rewritten.
const TOKEN_SEPARATOR = "(?:[ \\t]|\\\\\\r?\\n)+";
const COMMAND_PATTERN = new RegExp(
  `(?<![\\w.-])(tailor(?:-sdk)?(?:\\.(?:cmd|ps1|exe))?${TOKEN_SEPARATOR}setup${TOKEN_SEPARATOR})renovate(?![\\w.-])`,
  "g",
);

function replaceCommand(value: string): string {
  return value.replace(COMMAND_PATTERN, "$1deps");
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
 * Rename `tailor setup renovate` invocations to `tailor setup deps`.
 *
 * `renovate` remains as a deprecated alias until v3, where only `deps` is
 * recognized.
 * @param source - File contents
 * @param filePath - Absolute path to the file (used to dispatch package.json vs text)
 * @returns Transformed source or null when nothing matched.
 */
export default function transform(source: string, filePath: string): string | null {
  if (!source.includes("renovate")) return null;

  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".json") return transformPackageJson(source);
  return transformText(source);
}
