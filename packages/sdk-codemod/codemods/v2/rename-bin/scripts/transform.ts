import { parse, Lang } from "@ast-grep/napi";
import * as path from "pathe";
import type { SgNode } from "@ast-grep/napi";

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
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const TAILOR_CLI_COMMANDS = [
  "api",
  "apply",
  "authconnection",
  "completion",
  "crash-report",
  "crashreport",
  "deploy",
  "executor",
  "function",
  "generate",
  "init",
  "login",
  "logout",
  "machineuser",
  "oauth2client",
  "open",
  "organization",
  "profile",
  "query",
  "remove",
  "secret",
  "setup",
  "show",
  "skills",
  "staticwebsite",
  "tailordb",
  "upgrade",
  "user",
  "workflow",
  "workspace",
] as const;
const TAILOR_CLI_COMMAND_PATTERN = `(?:${TAILOR_CLI_COMMANDS.join("|")})`;
const SOURCE_PKG_RUNNER_RE = new RegExp(
  `\\b((?:npx|pnpm\\s+dlx|yarn\\s+dlx|bunx)(?:\\s+(?:-\\w+|--\\w[\\w-]*))*)\\s+tailor-sdk(?![\\w-])(@[^\\s'"\`;|&)]+)?(?=\\s+${TAILOR_CLI_COMMAND_PATTERN}\\b)`,
  "g",
);
const SOURCE_TAILOR_SDK_RE = new RegExp(
  `(?<![.\\w-])tailor-sdk(?![\\w-])(@[^\\s'"\`;|&)]+)?(?=\\s+${TAILOR_CLI_COMMAND_PATTERN}\\b)`,
  "g",
);

function renameBinary(value: string): string {
  const withRunners = value.replace(PKG_RUNNER_RE, (_, runner: string, version?: string) =>
    version ? `${runner} @tailor-platform/sdk${version}` : `${runner} @tailor-platform/sdk`,
  );
  return withRunners.replace(TAILOR_SDK_RE, (_match, version?: string) =>
    version ? `@tailor-platform/sdk${version}` : "tailor",
  );
}

function renameSourceCommandText(value: string): string {
  const withRunners = value.replace(SOURCE_PKG_RUNNER_RE, (_, runner: string, version?: string) =>
    version ? `${runner} @tailor-platform/sdk${version}` : `${runner} @tailor-platform/sdk`,
  );
  return withRunners.replace(SOURCE_TAILOR_SDK_RE, (_match, version?: string) =>
    version ? `@tailor-platform/sdk${version}` : "tailor",
  );
}

function sourceLang(filePath: string): Lang {
  const ext = path.extname(filePath).toLowerCase();
  return ext === ".tsx" || ext === ".jsx" || ext === ".js" ? Lang.Tsx : Lang.TypeScript;
}

function pushSourceTextEdit(
  edits: Array<[number, number, string]>,
  source: string,
  start: number,
  end: number,
): void {
  const text = source.slice(start, end);
  const replacement = renameSourceCommandText(text);
  if (replacement !== text) {
    edits.push([start, end, replacement]);
  }
}

function transformSourceFile(source: string, filePath: string): string | null {
  let root: SgNode;
  try {
    root = parse(sourceLang(filePath), source).root();
  } catch {
    return null;
  }

  const edits: Array<[number, number, string]> = [];
  const visit = (node: SgNode): void => {
    const kind = node.kind();
    const range = node.range();

    if (kind === "comment" || kind === "jsx_text" || kind === "string_fragment") {
      pushSourceTextEdit(edits, source, range.start.index, range.end.index);
      return;
    }

    if (kind === "string") {
      pushSourceTextEdit(edits, source, range.start.index + 1, range.end.index - 1);
      return;
    }

    if (kind === "template_string") {
      const hasSubstitution = node
        .children()
        .some((child: SgNode) => child.kind() === "template_substitution");
      if (!hasSubstitution) {
        pushSourceTextEdit(edits, source, range.start.index + 1, range.end.index - 1);
        return;
      }
    }

    for (const child of node.children()) {
      visit(child);
    }
  };
  visit(root);

  if (edits.length === 0) return null;
  let updated = source;
  for (const [start, end, replacement] of edits.toSorted(([a], [b]) => b - a)) {
    updated = `${updated.slice(0, start)}${replacement}${updated.slice(end)}`;
  }
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
  if (SOURCE_EXTENSIONS.has(ext)) return transformSourceFile(source, filePath);

  const updated = renameBinary(source);
  return updated === source ? null : updated;
}
