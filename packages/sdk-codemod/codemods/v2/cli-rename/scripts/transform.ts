import * as path from "pathe";

// Map of v1 multi-word command names to their v2 single-word replacements.
const COMMAND_RENAMES: ReadonlyArray<readonly [string, string]> = [["crash-report", "crashreport"]];

// Map of v1 camelCase option names to their v2 kebab-case replacements.
const OPTION_RENAMES: ReadonlyArray<readonly [string, string]> = [
  ["executionId", "execution-id"],
  ["executorName", "executor-name"],
  ["jobId", "job-id"],
];

const COMMAND_PATTERN = new RegExp(
  `\\btailor-sdk(@[^\\s'"\`]+)?(\\s+)(${COMMAND_RENAMES.map(([from]) => from).join("|")})\\b`,
  "g",
);

// Lookahead `(?![-\w])` excludes camelCase or dash-suffixed extensions
// (`--executionIdExtra`, `--executionId-foo`) so unrelated long flags are not
// rewritten by accident.
const OPTION_PATTERN = new RegExp(
  `(--)(${OPTION_RENAMES.map(([from]) => from).join("|")})(?![-\\w])`,
  "g",
);

const COMMAND_MAP = new Map(COMMAND_RENAMES);
const OPTION_MAP = new Map(OPTION_RENAMES);

function replaceAll(value: string): string {
  const renamedCommands = value.replace(
    COMMAND_PATTERN,
    (_match, ver: string | undefined, sep: string, cmd: string) =>
      `tailor-sdk${ver ?? ""}${sep}${COMMAND_MAP.get(cmd) ?? cmd}`,
  );
  return renamedCommands.replace(
    OPTION_PATTERN,
    (_match, dashes: string, opt: string) => `${dashes}${OPTION_MAP.get(opt) ?? opt}`,
  );
}

function transformText(source: string): string | null {
  if (!COMMAND_PATTERN.test(source) && !OPTION_PATTERN.test(source)) return null;
  COMMAND_PATTERN.lastIndex = 0;
  OPTION_PATTERN.lastIndex = 0;
  const updated = replaceAll(source);
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
      const updated = replaceAll(value);
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
 * Apply v2 CLI naming conventions:
 * - Multi-word commands collapse into a single word (`crash-report` → `crashreport`).
 * - camelCase options become kebab-case (`--executionId` → `--execution-id`).
 *
 * Optional `@version` pins on the binary (`tailor-sdk@latest`) are preserved.
 * @param source - File contents
 * @param filePath - Absolute path to the file (used to dispatch package.json vs text)
 * @returns Transformed source or null when nothing matched.
 */
export default function transform(source: string, filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".json") return transformPackageJson(source);
  return transformText(source);
}
