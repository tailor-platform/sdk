import { parse, Lang } from "@ast-grep/napi";
import * as path from "pathe";
import type { SgNode } from "@ast-grep/napi";

const ENV_RENAMES: ReadonlyArray<readonly [string, string]> = [
  ["TAILOR_PLATFORM_SDK_CONFIG_PATH", "TAILOR_CONFIG_PATH"],
  ["TAILOR_PLATFORM_SDK_DTS_PATH", "TAILOR_DTS_PATH"],
  ["TAILOR_PLATFORM_SDK_ALLOW_CI_ID_INJECTION", "TAILOR_CI_ALLOW_ID_INJECTION"],
  ["TAILOR_PLATFORM_SDK_BUILD_ONLY", "TAILOR_DEPLOY_BUILD_ONLY"],
  ["TAILOR_SDK_OUTPUT_DIR", "TAILOR_BUILD_OUTPUT_DIR"],
  ["TAILOR_SDK_SKILLS_SOURCE", "TAILOR_SKILLS_SOURCE"],
  ["TAILOR_SDK_VERSION", "TAILOR_TEMPLATE_SDK_VERSION"],
  ["TAILOR_ENABLE_INLINE_SOURCEMAP", "TAILOR_INLINE_SOURCEMAP"],
  ["TAILOR_PLATFORM_QUERY_NEWLINE_ON_ENTER", "TAILOR_QUERY_NEWLINE_ON_ENTER"],
  ["TAILOR_TOKEN", "TAILOR_PLATFORM_TOKEN"],
];

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const ENV_BOUNDARY = "[A-Za-z0-9_]";
const RENAME_PATTERNS = ENV_RENAMES.map(([from, to]) => ({
  pattern: new RegExp(`(?<!${ENV_BOUNDARY})${from}(?!${ENV_BOUNDARY})`, "g"),
  to,
}));

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceTextTokens(source: string): string {
  let updated = source;
  for (const { pattern, to } of RENAME_PATTERNS) {
    updated = updated.replace(pattern, to);
  }
  return updated;
}

function sourceLang(filePath: string): Lang {
  const ext = path.extname(filePath).toLowerCase();
  return ext === ".tsx" || ext === ".jsx" ? Lang.Tsx : Lang.TypeScript;
}

function collectStringFragmentEdits(root: SgNode, source: string): Array<[number, number, string]> {
  const edits: Array<[number, number, string]> = [];
  const visit = (node: SgNode): void => {
    if (node.kind() === "string_fragment") {
      const range = node.range();
      const text = source.slice(range.start.index, range.end.index);
      const replacement = replaceTextTokens(text);
      if (replacement !== text) edits.push([range.start.index, range.end.index, replacement]);
      return;
    }
    for (const child of node.children()) {
      visit(child);
    }
  };
  visit(root);
  return edits;
}

function replaceSourceStringFragments(source: string, filePath: string): string {
  let root: SgNode;
  try {
    root = parse(sourceLang(filePath), source).root();
  } catch {
    return source;
  }

  let updated = source;
  const edits = collectStringFragmentEdits(root, source).toSorted(([a], [b]) => b - a);
  for (const [start, end, replacement] of edits) {
    updated = `${updated.slice(0, start)}${replacement}${updated.slice(end)}`;
  }
  return updated;
}

function replaceSourceTokens(source: string, filePath: string): string {
  let updated = source;
  for (const [from, to] of ENV_RENAMES) {
    const escaped = escapeRegExp(from);
    updated = updated
      .replace(
        new RegExp(`\\bprocess\\.env\\.${escaped}(?![A-Za-z0-9_$])`, "g"),
        `process.env.${to}`,
      )
      .replace(
        new RegExp(`\\bprocess\\.env\\[(["'\`])${escaped}\\1\\]`, "g"),
        `process.env[$1${to}$1]`,
      )
      .replace(new RegExp(`([,{]\\s*)${escaped}(?=\\s*:)`, "g"), `$1${to}`);
  }
  return replaceSourceStringFragments(updated, filePath);
}

export default function transform(source: string, filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  const updated = SOURCE_EXTENSIONS.has(ext)
    ? replaceSourceTokens(source, filePath)
    : replaceTextTokens(source);
  return updated === source ? null : updated;
}
