import * as path from "pathe";

// Map of v1 multi-word command names to their v2 single-word replacements.
const COMMAND_RENAMES: ReadonlyArray<readonly [string, string]> = [["crash-report", "crashreport"]];

const COMMAND_PATTERN = new RegExp(
  `\\btailor-sdk(@[^\\s'"\`]+)?(\\s+)(${COMMAND_RENAMES.map(([from]) => from).join("|")})\\b`,
  "g",
);

const COMMAND_MAP = new Map(COMMAND_RENAMES);

function replaceAll(value: string): string {
  return value.replace(
    COMMAND_PATTERN,
    (_match, ver: string | undefined, sep: string, cmd: string) =>
      `tailor-sdk${ver ?? ""}${sep}${COMMAND_MAP.get(cmd) ?? cmd}`,
  );
}

function transformText(source: string): string | null {
  if (!COMMAND_PATTERN.test(source)) return null;
  COMMAND_PATTERN.lastIndex = 0;
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
 * Apply v2 CLI naming conventions: multi-word commands collapse into a single
 * word (`crash-report` → `crashreport`). Optional `@version` pins on the binary
 * (`tailor-sdk@latest`) are preserved.
 *
 * Long options (`--executionId`, `--executorName`, `--jobId`) and the
 * positional argument keys with the same names are intentionally not rewritten:
 * those tokens are positional in the SDK CLI and never appear as long flags in
 * user scripts, so a transform here would have no real-world target.
 * @param source - File contents
 * @param filePath - Absolute path to the file (used to dispatch package.json vs text)
 * @returns Transformed source or null when nothing matched.
 */
export default function transform(source: string, filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".json") return transformPackageJson(source);
  return transformText(source);
}
