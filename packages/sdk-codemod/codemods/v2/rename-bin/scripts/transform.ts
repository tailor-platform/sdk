import * as path from "pathe";

// Package-runner forms (`npx`, `pnpm dlx`, `yarn dlx`, `bunx`) resolve npm package
// names, so `tailor-sdk@...` must become `@tailor-platform/sdk@...` — rewriting
// to `tailor@...` would download the unrelated CSS Sprites Generator instead.
// Optional flags (e.g. `-y`, `--yes`) between the runner and the package name are
// captured as part of the runner group so the replacement preserves them.
const PKG_RUNNER_RE =
  /\b((?:npx|pnpm\s+dlx|yarn\s+dlx|bunx)(?:\s+(?:-\w+|--\w[\w-]*))*)\s+tailor-sdk(?![\w-])(@[^\s'"`;|&)]+)?/g;

// Match the `tailor-sdk` binary, optionally with a version pin (`@latest`,
// `@2.0.0`, etc.). Lookbehind excludes `.tailor-sdk` (preceded by `.`) and
// `create-tailor-sdk` (preceded by `-`). Lookahead excludes trailing `-word`
// (e.g. `tailor-sdk-skills`) to avoid partial-match rewrites.
const TAILOR_SDK_RE = /(?<![.\w-])tailor-sdk(?![\w-])(@[^\s'"`;|&)]+)?/g;

function renameBinary(value: string): string {
  const withRunners = value.replace(PKG_RUNNER_RE, (_, runner: string, version?: string) =>
    version ? `${runner} @tailor-platform/sdk${version}` : `${runner} @tailor-platform/sdk`,
  );
  return withRunners.replace(TAILOR_SDK_RE, (_match, version?: string) =>
    version ? `@tailor-platform/sdk${version}` : "tailor",
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
 * - `npx tailor-sdk@latest` → `npx @tailor-platform/sdk@latest` (package-runner form)
 * - `npx -y tailor-sdk login` → `npx -y @tailor-platform/sdk login` (runner flags preserved)
 * - `pnpm dlx tailor-sdk@latest` → `pnpm dlx @tailor-platform/sdk@latest` (package-runner form)
 * - `tailor-sdk@latest` elsewhere → `@tailor-platform/sdk@latest`
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
