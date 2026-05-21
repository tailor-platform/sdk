import * as path from "pathe";

// Match `tailor-sdk apply` plus the optional `@version` suffix that
// package-manager run commands can add (`npx tailor-sdk@latest apply`,
// `pnpm dlx tailor-sdk@1.45.2 apply`). The version pin is preserved because
// `apply` and `deploy` are the same subcommand on the same binary.
// `(?![-\w])` excludes both word continuation (`applyConfig`) and dash-suffixed
// names (`apply-foo`) so a hypothetical sibling subcommand is not rewritten.
const APPLY_PATTERN = /\btailor-sdk(@[^\s'"`]+)?(\s+)apply(?![-\w])/g;

function replaceApply(value: string): string {
  return value.replace(
    APPLY_PATTERN,
    (_match, ver: string | undefined, sep: string) => `tailor-sdk${ver ?? ""}${sep}deploy`,
  );
}

function transformText(source: string): string | null {
  if (!APPLY_PATTERN.test(source)) return null;
  APPLY_PATTERN.lastIndex = 0;
  const updated = replaceApply(source);
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
      if (!value.includes("tailor-sdk")) continue;
      const updated = replaceApply(value);
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
 * Replace `tailor-sdk apply` invocations with `tailor-sdk deploy`.
 *
 * `deploy` is a v1 alias of `apply` and the recommended name going forward.
 * @param source - File contents
 * @param filePath - Absolute path to the file (used to dispatch package.json vs text)
 * @returns Transformed source or null when nothing matched.
 */
export default function transform(source: string, filePath: string): string | null {
  if (!source.includes("tailor-sdk")) return null;

  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".json") return transformPackageJson(source);
  return transformText(source);
}
