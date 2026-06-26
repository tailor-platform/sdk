import * as path from "pathe";

// `npx tailor-sdk@...` must become `npx @tailor-platform/sdk@...` — rewriting
// to `npx tailor@...` would resolve the unrelated npm `tailor` package.
const NPX_RE = /\bnpx\s+tailor-sdk(?![\w-])(@[^\s'"`;|&)]+)?/g;

// Match the `tailor-sdk` binary, optionally with a version pin (`@latest`,
// `@2.0.0`, etc.). Lookbehind excludes `.tailor-sdk` (preceded by `.`) and
// `create-tailor-sdk` (preceded by `-`). Lookahead excludes trailing `-word`
// (e.g. `tailor-sdk-skills`) to avoid partial-match rewrites.
const TAILOR_SDK_RE = /(?<![.\w-])tailor-sdk(?![\w-])(@[^\s'"`;|&)]+)?/g;

function renameBinary(value: string): string {
  const withNpx = value.replace(NPX_RE, (_, version?: string) =>
    version ? `npx @tailor-platform/sdk${version}` : "npx @tailor-platform/sdk",
  );
  return withNpx.replace(TAILOR_SDK_RE, (_match, version?: string) =>
    version ? `tailor${version}` : "tailor",
  );
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
      if (!value.includes("tailor-sdk")) continue;
      const updated = renameBinary(value);
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
 * Rename `tailor-sdk` binary references to `tailor`.
 *
 * Handles optional `@version` pins:
 * - `npx tailor-sdk@latest` → `npx @tailor-platform/sdk@latest` (package-manager form)
 * - `tailor-sdk@latest` elsewhere → `tailor@latest`
 * Does not rewrite `.tailor-sdk` directory paths or `create-tailor-sdk`.
 * @param source - File contents
 * @param filePath - Absolute path to the file (used to dispatch package.json vs text)
 * @returns Transformed source or null when nothing matched.
 */
export default function transform(source: string, filePath: string): string | null {
  if (!source.includes("tailor-sdk")) return null;

  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".json") return transformPackageJson(source);

  const updated = renameBinary(source);
  return updated === source ? null : updated;
}
