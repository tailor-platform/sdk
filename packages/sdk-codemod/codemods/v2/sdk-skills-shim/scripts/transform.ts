import * as path from "pathe";

// Match the deprecated binary plus the optional `@version` suffix that
// package-manager run commands can add (`npx tailor-sdk-skills@latest`,
// `pnpm dlx tailor-sdk-skills@1.2.3`) and the optional ` install` subcommand,
// so the rewrite drops the version pin and avoids leaving `@latest` attached
// to the new subcommand. `[ \t]+` (not `\s+`) prevents the optional-install
// alternative from greedily reaching across newlines into the next command.
const SHIM_PATTERN = /\btailor-sdk-skills(?:@[^\s'"`]+)?(?:[ \t]+install)?\b(?!-)/g;
const REPLACEMENT = "tailor-sdk skills install";

function replaceShim(value: string): string {
  return value.replace(SHIM_PATTERN, REPLACEMENT);
}

function transformText(source: string): string | null {
  if (!SHIM_PATTERN.test(source)) return null;
  SHIM_PATTERN.lastIndex = 0;
  const updated = replaceShim(source);
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
      if (!value.includes("tailor-sdk-skills")) continue;
      const updated = replaceShim(value);
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
 * Replace `tailor-sdk-skills` invocations with `tailor-sdk skills install`.
 *
 * The standalone `tailor-sdk-skills` binary is removed in v2; users must call
 * the subcommand on the main `tailor-sdk` CLI instead.
 * @param source - File contents
 * @param filePath - Absolute path to the file (used to dispatch package.json vs text)
 * @returns Transformed source or null when nothing matched.
 */
export default function transform(source: string, filePath: string): string | null {
  if (!source.includes("tailor-sdk-skills")) return null;

  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".json") return transformPackageJson(source);
  return transformText(source);
}
