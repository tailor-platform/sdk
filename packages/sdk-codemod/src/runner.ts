import * as fs from "node:fs";
import * as url from "node:url";
import { parse, Lang } from "@ast-grep/napi";
import chalk from "chalk";
import { structuredPatch } from "diff";
import * as path from "pathe";
import picomatch from "picomatch";
import type { CodemodPackage, CodemodPattern, CodemodPatternGroup, LlmReview } from "./types";
import type { SgNode } from "@ast-grep/napi";

/**
 * A transform function that receives source text and file path,
 * and returns modified source or null if no changes are needed.
 *
 * For AST-based transforms, use `parseTS`/`parseTSX` from helpers:
 * ```typescript
 * import { parseTS } from "@tailor-platform/sdk-codemod/helpers";
 * export default function transform(source: string): string | null {
 *   const root = parseTS(source);
 *   // ... findAll, replace, commitEdits
 * }
 * ```
 *
 * For text-based transforms (e.g., JSON):
 * ```typescript
 * export default function transform(source: string, filePath: string): string | null {
 *   const json = JSON.parse(source);
 *   json.key = "newValue";
 *   return JSON.stringify(json, null, 2);
 * }
 * ```
 */
export type TransformFn = (
  source: string,
  filePath: string,
) => Promise<string | null> | string | null;

/** Result of running codemods on a project. */
export interface CodemodRunResult {
  changed: boolean;
  filesModified: string[];
  warnings: string[];
  /** IDs of codemods that actually produced changes in at least one file. */
  appliedCodemodIds: Set<string>;
  /** Files flagged for LLM-assisted review, grouped by codemod. */
  llmReviews: LlmReview[];
}

/** Default file patterns for TypeScript files. */
const DEFAULT_FILE_PATTERNS = ["**/*.{ts,tsx,mts,cts}"];

/** Directory names always excluded from file scanning. */
const EXCLUDE_DIRS = new Set(["node_modules", "dist", ".git"]);
const ALLOWED_DOT_DIRS = new Set([".github", ".circleci"]);
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const MASKED_SOURCE_NODE_KINDS: ReadonlySet<ReturnType<SgNode["kind"]>> = new Set([
  "comment",
  "string",
  "regex",
  "string_fragment",
  "jsx_text",
]);

function shouldSkipDirectory(name: string): boolean {
  return EXCLUDE_DIRS.has(name) || (name.startsWith(".") && !ALLOWED_DOT_DIRS.has(name));
}

async function* walkFiles(root: string, relativeDir = ""): AsyncGenerator<string> {
  const absoluteDir = path.join(root, relativeDir);
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(absoluteDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const relative = relativeDir ? path.join(relativeDir, entry.name) : entry.name;
    if (entry.isDirectory()) {
      if (shouldSkipDirectory(entry.name)) continue;
      yield* walkFiles(root, relative);
      continue;
    }
    if (entry.isFile()) {
      yield relative;
    }
  }
}

/**
 * Print a colorized unified diff for a single file to stderr.
 * @param filePath - Absolute path to the file
 * @param before - Original content
 * @param after - Transformed content
 */
function printDiff(filePath: string, before: string, after: string): void {
  const patch = structuredPatch(filePath, filePath, before, after, "", "", { context: 3 });
  if (patch.hunks.length === 0) return;

  process.stderr.write(`\n${chalk.bold(`--- ${filePath}`)}\n`);
  process.stderr.write(`${chalk.bold(`+++ ${filePath}`)}\n`);

  for (const hunk of patch.hunks) {
    process.stderr.write(
      chalk.cyan(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n`),
    );
    for (const line of hunk.lines) {
      if (line.startsWith("+")) {
        process.stderr.write(`${chalk.green(line)}\n`);
      } else if (line.startsWith("-")) {
        process.stderr.write(`${chalk.red(line)}\n`);
      } else {
        process.stderr.write(`${line}\n`);
      }
    }
  }
}

/**
 * Load a transform module from a TypeScript file path.
 * Expects the module to have a default export that is a TransformFn.
 * @param scriptPath - Absolute path to the transform script
 * @returns The transform function
 */
async function loadTransform(scriptPath: string): Promise<TransformFn> {
  const mod = await import(url.pathToFileURL(scriptPath).href);
  if (typeof mod.default !== "function") {
    throw new Error(`Transform at ${scriptPath} does not have a default export function`);
  }
  return mod.default as TransformFn;
}

/** A loaded transform with its file matcher. */
interface LoadedTransform {
  id: string;
  /** Undefined for codemod-less ("manual") entries that ship only guidance. */
  transform?: TransformFn;
  matches: (relativePath: string) => boolean;
  legacyPatterns: CodemodPatternGroup[];
  sourceStringLegacyPatterns: CodemodPatternGroup[];
  suspiciousPatterns: CodemodPatternGroup[];
  prompt?: string;
}

function contentForResidualMatching(relative: string, content: string): string {
  const ext = path.extname(relative).toLowerCase();
  return SOURCE_EXTENSIONS.has(ext) ? maskSourceNonCode(relative, content) : content;
}

function sourceStringContentForResidualMatching(relative: string, content: string): string | null {
  const ext = path.extname(relative).toLowerCase();
  if (!SOURCE_EXTENSIONS.has(ext)) return null;

  let root: SgNode;
  try {
    root = parse(sourceLang(relative), content).root();
  } catch {
    return null;
  }

  const fragments: string[] = [];
  const visit = (node: SgNode): void => {
    if (node.kind() === "string_fragment") {
      fragments.push(node.text());
      return;
    }
    for (const child of node.children()) {
      visit(child);
    }
  };
  visit(root);
  return fragments.join("\n");
}

function sourceLang(relative: string): Lang {
  const ext = path.extname(relative).toLowerCase();
  return ext === ".tsx" || ext === ".jsx" || ext === ".js" ? Lang.Tsx : Lang.TypeScript;
}

function isProcessEnvSubscriptKey(node: SgNode): boolean {
  const stringNode = node.kind() === "string_fragment" ? node.parent() : node;
  if (stringNode == null) return false;
  const stringNodeKind = stringNode.kind();
  if (stringNodeKind !== "string" && stringNodeKind !== "template_string") {
    return false;
  }
  const parent = stringNode.parent();
  return parent?.kind() === "subscript_expression" && /^process\.env\s*\[/.test(parent.text());
}

function collectMaskedRanges(root: SgNode): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const visit = (node: SgNode): void => {
    if (MASKED_SOURCE_NODE_KINDS.has(node.kind())) {
      if (isProcessEnvSubscriptKey(node)) return;
      const range = node.range();
      ranges.push([range.start.index, range.end.index]);
      return;
    }
    for (const child of node.children()) {
      visit(child);
    }
  };
  visit(root);
  return ranges;
}

function maskSourceNonCode(relative: string, content: string): string {
  let ranges: Array<[number, number]>;
  try {
    const root = parse(sourceLang(relative), content).root();
    ranges = collectMaskedRanges(root);
  } catch {
    return content;
  }

  ranges = ranges.toSorted(([a], [b]) => a - b);
  const chars = content.split("");
  for (const [start, end] of ranges) {
    for (let i = start; i < end && i < chars.length; i++) {
      if (chars[i] !== "\n" && chars[i] !== "\r") chars[i] = " ";
    }
  }
  return chars.join("");
}

function isIdentifierChar(char: string | undefined): boolean {
  return char != null && /^[A-Za-z0-9_$]$/.test(char);
}

function matchesPattern(content: string, pattern: CodemodPattern): boolean {
  if (typeof pattern === "string") {
    const checkLeft = isIdentifierChar(pattern[0]);
    const checkRight = isIdentifierChar(pattern.at(-1));
    let index = content.indexOf(pattern);
    while (index !== -1) {
      const before = index > 0 ? content[index - 1] : undefined;
      const after = content[index + pattern.length];
      if ((!checkLeft || !isIdentifierChar(before)) && (!checkRight || !isIdentifierChar(after))) {
        return true;
      }
      index = content.indexOf(pattern, index + 1);
    }
    return false;
  }
  pattern.lastIndex = 0;
  return pattern.test(content);
}

function patternLabel(pattern: CodemodPattern): string {
  return typeof pattern === "string" ? pattern : pattern.toString();
}

/** Resolve a residual pattern against content, returning its label when matched. */
function matchResidualPattern(content: string, pattern: CodemodPatternGroup): string | null {
  if (!Array.isArray(pattern)) {
    return matchesPattern(content, pattern) ? patternLabel(pattern) : null;
  }
  return pattern.every((p) => matchesPattern(content, p))
    ? pattern.map((p) => patternLabel(p)).join(" + ")
    : null;
}

function legacyPatternWarnings(
  relative: string,
  content: string,
  sourceStringContent: string | null,
  transforms: LoadedTransform[],
): string[] {
  return transforms.flatMap((lt) => {
    const found = new Set(
      lt.legacyPatterns
        .map((p) => matchResidualPattern(content, p))
        .filter((label): label is string => label !== null),
    );
    if (sourceStringContent != null) {
      for (const pattern of lt.sourceStringLegacyPatterns) {
        const label = matchResidualPattern(sourceStringContent, pattern);
        if (label != null) found.add(label);
      }
    }
    if (found.size === 0) return [];
    return [
      `${relative}: contains ${Array.from(found).join(", ")} but was not migrated automatically (rule: ${lt.id}). Manual migration may be needed.`,
    ];
  });
}

/**
 * Run multiple codemods on a project directory using in-memory chaining.
 * Each file is processed through all transforms whose filePatterns match it.
 * Later transforms see earlier transforms' output — even in dry-run mode.
 *
 * In dry-run mode, colorized diffs are printed to stderr.
 * @param codemods - Codemod packages to run (with resolved script paths)
 * @param targetPath - Project directory to transform
 * @param dryRun - Whether to preview changes without writing
 * @returns Combined result of all codemod executions
 */
export async function runCodemods(
  codemods: Array<{ codemod: CodemodPackage; scriptPath?: string }>,
  targetPath: string,
  dryRun: boolean,
): Promise<CodemodRunResult> {
  // Load all transform functions with their file matchers
  const loaded: LoadedTransform[] = [];
  for (const { codemod, scriptPath } of codemods) {
    const patterns = codemod.filePatterns ?? DEFAULT_FILE_PATTERNS;
    loaded.push({
      id: codemod.id,
      transform: scriptPath ? await loadTransform(scriptPath) : undefined,
      matches: picomatch(patterns, { dot: true }),
      legacyPatterns: codemod.legacyPatterns ?? [],
      sourceStringLegacyPatterns: codemod.sourceStringLegacyPatterns ?? [],
      suspiciousPatterns: codemod.suspiciousPatterns ?? [],
      prompt: codemod.prompt,
    });
  }

  const filesModified: string[] = [];
  const warnings: string[] = [];
  const appliedCodemodIds = new Set<string>();
  const seen = new Set<string>();
  // codemod id -> files flagged for LLM-assisted review
  const suspiciousByCodemod = new Map<string, string[]>();

  for await (const relative of walkFiles(targetPath)) {
    const absolute = path.resolve(targetPath, relative);
    if (seen.has(absolute)) continue;
    seen.add(absolute);

    const matchedTransforms = loaded.filter((lt) => lt.matches(relative));
    if (matchedTransforms.length === 0) continue;

    let original: string;
    try {
      original = await fs.promises.readFile(absolute, "utf-8");
    } catch {
      continue;
    }

    let current = original;
    for (const lt of matchedTransforms) {
      if (!lt.transform) continue;
      const result = await lt.transform(current, absolute);
      if (result != null) {
        current = result;
        appliedCodemodIds.add(lt.id);
      }
    }

    if (current !== original) {
      filesModified.push(absolute);
      if (dryRun) {
        printDiff(absolute, original, current);
      } else {
        await fs.promises.writeFile(absolute, current, "utf-8");
      }
    }

    const residualContent = contentForResidualMatching(relative, current);
    const sourceStringContent = sourceStringContentForResidualMatching(relative, current);
    warnings.push(
      ...legacyPatternWarnings(relative, residualContent, sourceStringContent, matchedTransforms),
    );

    for (const lt of matchedTransforms) {
      if (!lt.prompt || lt.suspiciousPatterns.length === 0) continue;
      if (lt.suspiciousPatterns.some((p) => matchResidualPattern(residualContent, p) !== null)) {
        const files = suspiciousByCodemod.get(lt.id) ?? [];
        files.push(relative);
        suspiciousByCodemod.set(lt.id, files);
      }
    }
  }

  const llmReviews: LlmReview[] = [];
  for (const lt of loaded) {
    if (!lt.prompt) continue;
    if (lt.suspiciousPatterns.length > 0) {
      // File-scoped: only surface when a suspicious pattern actually matched.
      const files = suspiciousByCodemod.get(lt.id);
      // Sort for deterministic output regardless of filesystem traversal order.
      if (files) llmReviews.push({ codemodId: lt.id, prompt: lt.prompt, files: files.toSorted() });
    } else if (lt.legacyPatterns.length === 0) {
      // Codemod-less manual change with no pattern to scope by: surface as
      // project-wide guidance (legacyPattern-only entries warn instead).
      llmReviews.push({ codemodId: lt.id, prompt: lt.prompt, files: [] });
    }
  }

  return {
    changed: filesModified.length > 0,
    filesModified,
    warnings,
    appliedCodemodIds,
    llmReviews,
  };
}
