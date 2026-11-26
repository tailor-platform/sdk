import * as fs from "node:fs";
import * as url from "node:url";
import { parse, Lang } from "@ast-grep/napi";
import { color, renderFor, type StyleFn } from "@tailor-platform/shared/color";
import { structuredPatch } from "diff";
import * as path from "pathe";
import picomatch from "picomatch";
import { takesSeparateGlobalValue } from "./command-line-pattern";
import { lineOfIndex, movedIndex, prefixLengths } from "./moved-text";
import { sourceArrayElements, sourceStaticStringContent } from "./source-strings";
import { TAILOR_CLI_VALUE_FLAG_SET } from "./tailor-cli-tokens";
import { shouldSkipDirectory, SOURCE_EXTENSIONS, walkFiles } from "./walk-files";
import type {
  CodemodPackage,
  CodemodPattern,
  CodemodPatternGroup,
  LlmReview,
  LlmReviewFinding,
  ProjectChanges,
  ProjectFiles,
  ProjectTransformFn,
  ReviewFindingsFn,
} from "./types";
import type { SgNode } from "@ast-grep/napi";

/**
 * A transform function that receives source text, its absolute file path, and
 * the absolute project directory being transformed, and returns modified
 * source or null if no changes are needed.
 *
 * For AST-based transforms, parse with ast-grep:
 * ```typescript
 * import { parse, Lang } from "@ast-grep/napi";
 * export default function transform(source: string): string | null {
 *   const root = parse(Lang.TypeScript, source).root();
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
  targetPath: string,
) => Promise<string | null> | string | null;

/** Result of running codemods on a project. */
export interface CodemodRunResult {
  changed: boolean;
  /** Absolute paths of the files the codemods changed or created. */
  filesModified: string[];
  /** Absolute paths of the files the codemods deleted. */
  filesDeleted: string[];
  warnings: string[];
  /** IDs of codemods that actually produced changes in at least one file. */
  appliedCodemodIds: Set<string>;
  /** Files flagged for LLM-assisted review, grouped by codemod. */
  llmReviews: LlmReview[];
}

/** Default file patterns for TypeScript files. */
const DEFAULT_FILE_PATTERNS = ["**/*.{ts,tsx,mts,cts}"];

const SOURCE_STRING_FRAGMENT_SEPARATOR = "\0";
const MASKED_SOURCE_NODE_KINDS: ReadonlySet<ReturnType<SgNode["kind"]>> = new Set([
  "comment",
  "string",
  "regex",
  "string_fragment",
  "jsx_text",
]);
const SOURCE_CLI_BINARY_RE =
  /^(?:(?:.*[\\/])?tailor(?:\.(?:cmd|ps1|exe))?|(?:.*[\\/])?tailor-sdk(?:@[^\s'"`;|&)]+)?(?:\.(?:cmd|ps1|exe))?|@tailor-platform\/sdk(?:@[^\s'"`;|&)]+)?)$/;

/**
 * Matches the target-relative paths of the files `runCodemods` applies `codemod` to.
 * @param codemod - Codemod whose file patterns decide
 * @returns Whether a target-relative path is one of those files
 */
export function codemodFileMatcher(codemod: CodemodPackage): (relativePath: string) => boolean {
  const matches = picomatch(codemod.filePatterns ?? DEFAULT_FILE_PATTERNS, { dot: true });
  return (relativePath) =>
    !relativePath.split("/").slice(0, -1).some(shouldSkipDirectory) && matches(relativePath);
}

function writeDiffLine(line: string, style?: StyleFn): void {
  process.stderr.write(renderFor(process.stderr, `${style ? style(line) : line}\n`));
}

/**
 * Print a colorized unified diff for a single file to stderr.
 * @param filePath - Absolute path to the file
 * @param before - Original content
 * @param after - Transformed content
 */
function printDiff(filePath: string, before: string | null, after: string | null): void {
  const patch = structuredPatch(filePath, filePath, before ?? "", after ?? "", "", "", {
    context: 3,
  });
  if (patch.hunks.length === 0) return;

  writeDiffLine("");
  writeDiffLine(`--- ${before === null ? "/dev/null" : filePath}`, color.bold);
  writeDiffLine(`+++ ${after === null ? "/dev/null" : filePath}`, color.bold);

  for (const hunk of patch.hunks) {
    writeDiffLine(
      `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
      color.cyan,
    );
    for (const line of hunk.lines) {
      if (line.startsWith("+")) {
        writeDiffLine(line, color.green);
      } else if (line.startsWith("-")) {
        writeDiffLine(line, color.red);
      } else {
        writeDiffLine(line);
      }
    }
  }
}

/**
 * Load a transform module from a TypeScript file path.
 * Expects the module to export a per-file TransformFn as its default export, a
 * ProjectTransformFn as `transformProject`, or both.
 * @param scriptPath - Absolute path to the transform script
 * @returns The transform functions and optional review detectors
 */
async function loadTransformModule(scriptPath: string): Promise<{
  transform?: TransformFn;
  transformProject?: ProjectTransformFn;
  reviewFindings?: ReviewFindingsFn;
  reviewFindingsBeforeTransform?: ReviewFindingsFn;
}> {
  const mod = await import(url.pathToFileURL(scriptPath).href);
  const transform = typeof mod.default === "function" ? (mod.default as TransformFn) : undefined;
  const transformProject =
    typeof mod.transformProject === "function"
      ? (mod.transformProject as ProjectTransformFn)
      : undefined;
  if (!transform && !transformProject) {
    throw new Error(
      `Transform at ${scriptPath} exports neither a default transform function nor transformProject`,
    );
  }
  return {
    transform,
    transformProject,
    reviewFindings:
      typeof mod.reviewFindings === "function"
        ? (mod.reviewFindings as ReviewFindingsFn)
        : undefined,
    reviewFindingsBeforeTransform:
      typeof mod.reviewFindingsBeforeTransform === "function"
        ? (mod.reviewFindingsBeforeTransform as ReviewFindingsFn)
        : undefined,
  };
}

/** A loaded transform with its file matcher. */
interface LoadedTransform {
  id: string;
  /** Undefined for codemod-less ("manual") entries that ship only guidance. */
  transform?: TransformFn;
  transformProject?: ProjectTransformFn;
  reviewFindings?: ReviewFindingsFn;
  reviewFindingsBeforeTransform?: ReviewFindingsFn;
  matches: (relativePath: string) => boolean;
  legacyPatterns: CodemodPatternGroup[];
  sourceStringLegacyPatterns: CodemodPatternGroup[];
  sourceTextLegacyPatterns: CodemodPatternGroup[];
  suspiciousPatterns: CodemodPatternGroup[];
  sourceStringSuspiciousPatterns: CodemodPatternGroup[];
  jsonStringSuspiciousPatterns: CodemodPatternGroup[];
  prompt?: string;
  reviewSupersededBy: string[];
}

function contentForResidualMatching(relative: string, content: string): string {
  const ext = path.extname(relative).toLowerCase();
  return SOURCE_EXTENSIONS.has(ext) ? maskSourceNonCode(relative, content) : content;
}

type ResidualEntry = {
  residual: string;
  sourceString: string | null;
  jsonStrings: string[] | null;
};

const SOURCE_STRING_OPAQUE_VALUE = "\u0001";

function sourceStringEscapeForResidualMatching(escape: string): string {
  if (/^\\[nr]$/.test(escape)) return "\n";
  if (/^\\(?:[tvf]|\r\n|\r|\n)$/.test(escape)) return " ";
  if (/^\\[\\"'`/]$/.test(escape)) return escape.slice(1);
  return SOURCE_STRING_OPAQUE_VALUE;
}

function sourceStringFragmentGapForResidualMatching(gap: string): string {
  return /^\s+$/.test(gap) ? " " : SOURCE_STRING_FRAGMENT_SEPARATOR;
}

function isRawTemplate(node: SgNode): boolean {
  const parent = node.parent();
  return parent?.kind() === "call_expression" && parent.field("function")?.text() === "String.raw";
}

function sourceStringNodeContentForResidualMatching(node: SgNode, content: string): string | null {
  const raw = isRawTemplate(node);
  const parts: string[] = [];
  let previousEnd: number | null = null;
  let pending = "";
  let hasFragment = false;

  for (const child of node.children()) {
    const kind = child.kind();
    if (
      kind !== "string_fragment" &&
      kind !== "escape_sequence" &&
      kind !== "template_substitution"
    ) {
      continue;
    }

    const range = child.range();
    if (previousEnd != null && range.start.index > previousEnd) {
      pending += sourceStringFragmentGapForResidualMatching(
        content.slice(previousEnd, range.start.index),
      );
    }
    previousEnd = range.end.index;

    if (kind === "string_fragment" || (raw && kind === "escape_sequence")) {
      if (hasFragment) parts.push(pending);
      pending = "";
      hasFragment = true;
      parts.push(child.text());
    } else if (kind === "escape_sequence") {
      pending += sourceStringEscapeForResidualMatching(child.text());
    } else {
      pending += SOURCE_STRING_OPAQUE_VALUE;
    }
  }

  return hasFragment ? parts.join("") : null;
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

  const sourceStrings: string[] = [];
  const valueArgumentIds = new Set<number>();
  const visit = (node: SgNode): void => {
    if (node.kind() === "arguments") {
      const value = sourceArgumentsCommandContent(node, content);
      if (value != null) sourceStrings.push(value);
    }
    if (node.kind() === "array") {
      const command = sourceArrayCommand(node, content);
      for (const id of command.valueArgumentIds) valueArgumentIds.add(id);
      if (command.values.length >= 2) sourceStrings.push(command.values.join(" "));
    }
    const kind = node.kind();
    if (kind === "string" || kind === "template_string") {
      if (
        valueArgumentIds.has(node.id()) &&
        sourceStaticStringContent(node, content)?.includes("tailor-sdk")
      ) {
        return;
      }
      const sourceString = sourceStringNodeContentForResidualMatching(node, content);
      if (sourceString != null) sourceStrings.push(sourceString);
    }
    for (const child of node.children()) {
      if (child.kind() === "string_fragment") continue;
      visit(child);
    }
  };
  visit(root);
  return sourceStrings.join(SOURCE_STRING_FRAGMENT_SEPARATOR);
}

function jsonStringValuesForResidualMatching(relative: string, content: string): string[] | null {
  if (path.extname(relative).toLowerCase() !== ".json") return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(content.replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }

  const strings: string[] = [];
  const pending: unknown[] = [parsed];
  while (pending.length > 0) {
    const value = pending.pop();
    if (typeof value === "string") {
      strings.push(value);
    } else if (value !== null && typeof value === "object") {
      const children = Object.values(value);
      for (let index = children.length - 1; index >= 0; index--) pending.push(children[index]);
    }
  }
  return strings;
}

function sourceTextContentForResidualMatching(relative: string, content: string): string | null {
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
    if (node.kind() === "comment" || node.kind() === "jsx_text") {
      fragments.push(node.text());
      return;
    }
    for (const child of node.children()) {
      visit(child);
    }
  };
  visit(root);
  return fragments.join(SOURCE_STRING_FRAGMENT_SEPARATOR);
}

function sourceArgumentsCommandContent(node: SgNode, source: string): string | null {
  const args = sourceArrayElements(node);
  const executable = args[0] == null ? null : sourceStaticStringContent(args[0]!, source);
  const argv = args[1];
  if (executable == null || argv?.kind() !== "array") return null;

  const { values } = sourceArrayCommand(argv, source);
  return values.length === 0 ? null : [executable, ...values].join(" ");
}

function sourceArrayCommand(
  node: SgNode,
  source: string,
): { values: string[]; valueArgumentIds: number[] } {
  const values: string[] = [];
  const valueArgumentIds: number[] = [];
  let tailorCli = hasTailorCliExecutable(node, source);
  let previous: string | null = null;
  for (const element of sourceArrayElements(node)) {
    const value = sourceStaticStringContent(element, source);
    if (tailorCli && isSourceCliValueFlag(previous)) {
      valueArgumentIds.push(element.id());
    } else if (value != null) {
      values.push(value);
    }
    tailorCli ||= isSourceCliBinary(value);
    previous = value;
  }
  return { values, valueArgumentIds };
}

function hasTailorCliExecutable(arrayNode: SgNode, source: string): boolean {
  const argumentsNode = arrayNode.parent();
  if (argumentsNode?.kind() !== "arguments") return false;
  const executable = sourceArrayElements(argumentsNode)[0];
  return executable != null && isSourceCliBinary(sourceStaticStringContent(executable, source));
}

function isSourceCliBinary(value: string | null): boolean {
  return value != null && SOURCE_CLI_BINARY_RE.test(value);
}

function isSourceCliValueFlag(value: string | null): boolean {
  return value != null && (TAILOR_CLI_VALUE_FLAG_SET.has(value) || takesSeparateGlobalValue(value));
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

function matchResidualPatternFragment(
  content: string,
  pattern: CodemodPatternGroup,
): string | null {
  for (const fragment of content.split(SOURCE_STRING_FRAGMENT_SEPARATOR)) {
    const label = matchResidualPattern(fragment, pattern);
    if (label != null) return label;
  }
  return null;
}

function legacyPatternWarnings(
  relative: string,
  content: string,
  sourceStringContent: string | null,
  sourceTextContent: string | null,
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
        const label = matchResidualPatternFragment(sourceStringContent, pattern);
        if (label != null) found.add(label);
      }
    }
    if (sourceTextContent != null) {
      for (const pattern of lt.sourceTextLegacyPatterns) {
        const label = matchResidualPatternFragment(sourceTextContent, pattern);
        if (label != null) found.add(label);
      }
    }
    if (found.size === 0) return [];
    return [
      `${relative}: contains ${Array.from(found).join(", ")} but was not migrated automatically (rule: ${lt.id}). Manual migration may be needed.`,
    ];
  });
}

function movedLine(prior: string | null, finding: LlmReviewFinding, content: string): number {
  const source = prior ?? "";
  const lines = source.split("\n");
  const line = lines[finding.line - 1] ?? "";
  const column =
    prefixLengths(finding.excerpt)
      .map((size) => line.indexOf(finding.excerpt.slice(0, size)))
      .find((index) => index !== -1) ?? -1;
  const at =
    column === -1
      ? content.indexOf(finding.excerpt)
      : movedIndex(
          source,
          lines.slice(0, finding.line - 1).reduce((sum, text) => sum + text.length + 1, column),
          line.length - column,
          content,
        );
  return at === -1 ? 1 : lineOfIndex(content, at);
}

function lineRemapper(before: string, after: string): (line: number) => number {
  const hunks = structuredPatch("", "", before, after, "", "", { context: 0 }).hunks;
  const lastLine = Math.max(1, after.split("\n").length - (after.endsWith("\n") ? 1 : 0));
  const map = (line: number): number => {
    let offset = 0;
    for (const hunk of hunks) {
      if (line < hunk.oldStart) break;
      if (hunk.oldLines === 0) {
        offset += hunk.newLines;
        continue;
      }
      if (line < hunk.oldStart + hunk.oldLines) {
        if (hunk.newLines === 0) return hunk.newStart;
        return Math.min(hunk.newStart + (line - hunk.oldStart), hunk.newStart + hunk.newLines - 1);
      }
      offset += hunk.newLines - hunk.oldLines;
    }
    return line + offset;
  };
  return (line: number): number => Math.min(lastLine, Math.max(1, map(line)));
}

function compareReviewFindings(a: LlmReviewFinding, b: LlmReviewFinding): number {
  return (
    a.file.localeCompare(b.file) ||
    a.line - b.line ||
    a.message.localeCompare(b.message) ||
    a.excerpt.localeCompare(b.excerpt)
  );
}

function readDiskFile(absolute: string): string | null {
  try {
    return fs.statSync(absolute).isFile() ? fs.readFileSync(absolute, "utf-8") : null;
  } catch {
    return null;
  }
}

/** The project's files as the codemods have changed them so far, before anything is written. */
class ProjectOverlay {
  private readonly originals = new Map<string, string | null>();
  private readonly contents = new Map<string, string | null>();

  constructor(private readonly root: string) {}

  set(absolute: string, original: string | null, content: string | null): void {
    if (!this.originals.has(absolute)) this.originals.set(absolute, original);
    this.contents.set(absolute, content);
  }

  original(absolute: string): string | null {
    return this.originals.has(absolute) ? this.originals.get(absolute)! : readDiskFile(absolute);
  }

  current(absolute: string): string | null {
    return this.contents.has(absolute) ? this.contents.get(absolute)! : readDiskFile(absolute);
  }

  snapshot(): Map<string, string | null> {
    return new Map(this.contents);
  }

  view(paths: ReadonlySet<string>): ProjectFiles {
    return {
      root: this.root,
      paths: [...paths],
      read: (relativePath) => this.current(path.resolve(this.root, relativePath)) ?? undefined,
      exists: (relativePath) => {
        const absolute = path.resolve(this.root, relativePath);
        if (this.contents.has(absolute)) return this.contents.get(absolute) !== null;
        const prefix = `${absolute}/`;
        for (const [file, content] of this.contents) {
          if (content !== null && file.startsWith(prefix)) return true;
        }
        return fs.existsSync(absolute);
      },
    };
  }

  /**
   * Record a project transform's changes.
   * @param changes - The transform's changes
   * @param paths - Project-relative paths of the existing files, kept in step with the changes
   * @returns Whether anything changed
   */
  apply(changes: ProjectChanges, paths: Set<string>): boolean {
    let changed = false;
    for (const [relativePath, content] of Object.entries(changes.writes ?? {})) {
      const absolute = path.resolve(this.root, relativePath);
      if (this.current(absolute) === content) continue;
      this.set(absolute, readDiskFile(absolute), content);
      this.track(absolute, paths, true);
      changed = true;
    }
    for (const relativePath of changes.deletes ?? []) {
      const absolute = path.resolve(this.root, relativePath);
      if (this.current(absolute) === null) continue;
      this.set(absolute, readDiskFile(absolute), null);
      this.track(absolute, paths, false);
      changed = true;
    }
    return changed;
  }

  private track(absolute: string, paths: Set<string>, present: boolean): void {
    const relative = path.relative(this.root, absolute);
    if (relative.startsWith("../")) return;
    if (present) paths.add(relative);
    else paths.delete(relative);
  }

  /**
   * Write the changes, every written file before any deletion, or print them as diffs in a dry run.
   * @param dryRun - Whether to print instead of writing
   * @returns The absolute paths of the changed or created files and of the deleted files
   */
  async commit(dryRun: boolean): Promise<{ filesModified: string[]; filesDeleted: string[] }> {
    const changed = [...this.contents].filter(
      ([absolute, content]) => content !== (this.originals.get(absolute) ?? null),
    );
    const filesModified = changed.flatMap(([absolute, content]) =>
      content === null ? [] : [absolute],
    );
    const filesDeleted = changed.flatMap(([absolute, content]) =>
      content === null ? [absolute] : [],
    );
    for (const [absolute, content] of changed) {
      if (dryRun) printDiff(absolute, this.originals.get(absolute) ?? null, content);
    }
    if (dryRun) return { filesModified, filesDeleted };
    for (const [absolute, content] of changed) {
      if (content === null) continue;
      await fs.promises.mkdir(path.dirname(absolute), { recursive: true });
      await fs.promises.writeFile(absolute, content, "utf-8");
    }
    for (const absolute of filesDeleted) await fs.promises.rm(absolute, { force: true });
    return { filesModified, filesDeleted };
  }
}

/**
 * Run multiple codemods on a project directory using in-memory chaining.
 * Each file is processed through all transforms whose filePatterns match it.
 * Later transforms see earlier transforms' output — even in dry-run mode.
 * Review detection (reviewFindings and suspicious patterns) runs against each
 * codemod's own position in the transform chain, so a later codemod's rewrite
 * cannot hide an earlier codemod's findings.
 *
 * Transforms exported as `transformProject` then run in order on the results, and may
 * create and delete files. Nothing is written until every transform has run.
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
    const loadedModule = scriptPath ? await loadTransformModule(scriptPath) : undefined;
    loaded.push({
      id: codemod.id,
      transform: loadedModule?.transform,
      transformProject: loadedModule?.transformProject,
      reviewFindings: loadedModule?.reviewFindings,
      reviewFindingsBeforeTransform: loadedModule?.reviewFindingsBeforeTransform,
      matches: codemodFileMatcher(codemod),
      legacyPatterns: codemod.legacyPatterns ?? [],
      sourceStringLegacyPatterns: codemod.sourceStringLegacyPatterns ?? [],
      sourceTextLegacyPatterns: codemod.sourceTextLegacyPatterns ?? [],
      suspiciousPatterns: codemod.suspiciousPatterns ?? [],
      sourceStringSuspiciousPatterns: codemod.sourceStringSuspiciousPatterns ?? [],
      jsonStringSuspiciousPatterns: codemod.jsonStringSuspiciousPatterns ?? [],
      prompt: codemod.prompt,
      reviewSupersededBy: codemod.reviewSupersededBy ?? [],
    });
  }

  const needsJsonStrings = loaded.some((lt) => lt.jsonStringSuspiciousPatterns.length > 0);

  const absoluteTargetPath = path.resolve(targetPath);
  const overlay = new ProjectOverlay(absoluteTargetPath);
  const warningsByFile = new Map<string, string[]>();
  const appliedCodemodIds = new Set<string>();
  const seen = new Set<string>();
  const walked: string[] = [];
  const suspiciousByCodemod = new Map<string, Set<string>>();
  const findingsByCodemod = new Map<string, LlmReviewFinding[]>();

  for await (const relative of walkFiles(targetPath)) {
    const absolute = path.resolve(targetPath, relative);
    if (seen.has(absolute)) continue;
    seen.add(absolute);
    walked.push(relative);

    const matchedTransforms = loaded.filter((lt) => lt.matches(relative));
    if (matchedTransforms.length === 0) continue;

    let original: string;
    try {
      original = await fs.promises.readFile(absolute, "utf-8");
    } catch {
      continue;
    }

    let current = original;
    const reviewTargets: Array<{ lt: LoadedTransform; input: string; snapshot: string }> = [];
    for (const lt of matchedTransforms) {
      const input = current;
      if (lt.transform) {
        const result = await lt.transform(current, absolute, absoluteTargetPath);
        if (result != null) {
          current = result;
          appliedCodemodIds.add(lt.id);
        }
      }
      if (lt.prompt) reviewTargets.push({ lt, input, snapshot: current });
    }

    if (current !== original) overlay.set(absolute, original, current);

    const residualBySnapshot = new Map<string, ResidualEntry>();
    const residualFor = (content: string): ResidualEntry => {
      let entry = residualBySnapshot.get(content);
      if (!entry) {
        entry = {
          residual: contentForResidualMatching(relative, content),
          sourceString: sourceStringContentForResidualMatching(relative, content),
          jsonStrings: needsJsonStrings
            ? jsonStringValuesForResidualMatching(relative, content)
            : null,
        };
        residualBySnapshot.set(content, entry);
      }
      return entry;
    };

    const { residual: residualContent, sourceString: sourceStringContent } = residualFor(current);
    const sourceTextContent = sourceTextContentForResidualMatching(relative, current);
    warningsByFile.set(
      relative,
      legacyPatternWarnings(
        relative,
        residualContent,
        sourceStringContent,
        sourceTextContent,
        matchedTransforms,
      ),
    );

    for (const { lt, input, snapshot } of reviewTargets) {
      const filesForReview = (): Set<string> => {
        let files = suspiciousByCodemod.get(lt.id);
        if (!files) {
          files = new Set<string>();
          suspiciousByCodemod.set(lt.id, files);
        }
        return files;
      };
      const detectors = [
        { detect: lt.reviewFindingsBeforeTransform, reviewed: input },
        { detect: lt.reviewFindings, reviewed: snapshot },
      ];
      for (const { detect, reviewed } of detectors) {
        if (!detect) continue;
        let findings = await detect(reviewed, absolute, relative, absoluteTargetPath);
        if (reviewed !== current && findings.length > 0) {
          const remap = lineRemapper(reviewed, current);
          findings = findings.map((finding) => ({ ...finding, line: remap(finding.line) }));
        }
        if (findings.length > 0) {
          const files = filesForReview();
          for (const finding of findings) {
            files.add(finding.file);
          }
          let existing = findingsByCodemod.get(lt.id);
          if (!existing) {
            existing = [];
            findingsByCodemod.set(lt.id, existing);
          }
          existing.push(...findings);
        }
      }
      if (
        lt.suspiciousPatterns.length === 0 &&
        lt.sourceStringSuspiciousPatterns.length === 0 &&
        lt.jsonStringSuspiciousPatterns.length === 0
      ) {
        continue;
      }
      const { residual, sourceString, jsonStrings } = residualFor(snapshot);
      const readsJsonStrings = jsonStrings != null && lt.jsonStringSuspiciousPatterns.length > 0;
      const matchesSource =
        (!readsJsonStrings &&
          lt.suspiciousPatterns.some((p) => matchResidualPattern(residual, p) !== null)) ||
        (sourceString != null &&
          lt.sourceStringSuspiciousPatterns.some(
            (p) => matchResidualPattern(sourceString, p) !== null,
          )) ||
        (jsonStrings != null &&
          jsonStrings.some((value) =>
            lt.jsonStringSuspiciousPatterns.some((p) => matchResidualPattern(value, p) !== null),
          ));
      if (matchesSource) {
        filesForReview().add(relative);
      }
    }
  }

  const projectWarnings: string[] = [];
  const projectTransforms = loaded.filter((lt) => lt.transformProject);
  if (projectTransforms.length > 0) {
    const afterPerFile = overlay.snapshot();
    const paths = new Set(walked);
    const mergedInto = new Map<string, string>();
    const projectFindings = new Map<string, LlmReviewFinding[]>();
    for (const lt of projectTransforms) {
      const changes = await lt.transformProject!(overlay.view(paths));
      if (overlay.apply(changes, paths)) appliedCodemodIds.add(lt.id);
      projectWarnings.push(...(changes.warnings ?? []));
      for (const [from, to] of Object.entries(changes.mergedInto ?? {})) mergedInto.set(from, to);
      if (changes.findings && changes.findings.length > 0) {
        projectFindings.set(lt.id, [...(projectFindings.get(lt.id) ?? []), ...changes.findings]);
      }
    }
    const isDeleted = (relative: string) =>
      overlay.current(path.resolve(absoluteTargetPath, relative)) === null;
    const relocate = (finding: LlmReviewFinding, fromPerFile: boolean): LlmReviewFinding[] => {
      const absolute = path.resolve(absoluteTargetPath, finding.file);
      const final = overlay.current(absolute);
      const prior = afterPerFile.get(absolute) ?? overlay.original(absolute);
      if (final === null) {
        const target = mergedInto.get(finding.file);
        const content = target && overlay.current(path.resolve(absoluteTargetPath, target));
        if (!target || !content) return [];
        return [{ ...finding, file: target, line: movedLine(prior, finding, content) }];
      }
      if (!fromPerFile || prior === null || prior === final) return [finding];
      return [{ ...finding, line: lineRemapper(prior, final)(finding.line) }];
    };
    for (const [codemodId, findings] of findingsByCodemod) {
      findingsByCodemod.set(
        codemodId,
        findings.flatMap((finding) => relocate(finding, true)),
      );
    }
    for (const [codemodId, findings] of projectFindings) {
      findingsByCodemod.set(codemodId, [
        ...(findingsByCodemod.get(codemodId) ?? []),
        ...findings.flatMap((finding) => relocate(finding, false)),
      ]);
      if (!suspiciousByCodemod.has(codemodId)) suspiciousByCodemod.set(codemodId, new Set());
    }
    for (const relative of walked) {
      if (isDeleted(relative) && !mergedInto.has(relative)) warningsByFile.delete(relative);
    }
    for (const [codemodId, files] of suspiciousByCodemod) {
      const relocated = new Set(
        [...files].flatMap((file) => (!isDeleted(file) ? [file] : (mergedInto.get(file) ?? []))),
      );
      for (const finding of findingsByCodemod.get(codemodId) ?? []) relocated.add(finding.file);
      if (relocated.size === 0) suspiciousByCodemod.delete(codemodId);
      else suspiciousByCodemod.set(codemodId, relocated);
    }
  }

  const { filesModified, filesDeleted } = await overlay.commit(dryRun);
  const warnings = [
    ...walked.flatMap((relative) => warningsByFile.get(relative) ?? []),
    ...projectWarnings,
  ];

  const llmReviews: LlmReview[] = [];
  const loadedIds = new Set(loaded.map((lt) => lt.id));
  for (const lt of loaded) {
    if (!lt.prompt) continue;
    if (lt.reviewSupersededBy.some((id) => loadedIds.has(id))) continue;
    if (
      lt.suspiciousPatterns.length > 0 ||
      lt.sourceStringSuspiciousPatterns.length > 0 ||
      lt.jsonStringSuspiciousPatterns.length > 0 ||
      lt.reviewFindings ||
      lt.reviewFindingsBeforeTransform ||
      lt.transformProject
    ) {
      // File-scoped: only surface when a suspicious pattern actually matched.
      const files = suspiciousByCodemod.get(lt.id);
      // Sort for deterministic output regardless of filesystem traversal order.
      if (files) {
        const findings = findingsByCodemod.get(lt.id)?.toSorted(compareReviewFindings);
        llmReviews.push({
          codemodId: lt.id,
          prompt: lt.prompt,
          files: Array.from(files).toSorted(),
          ...(findings && findings.length > 0 ? { findings } : {}),
        });
      }
    } else if (lt.legacyPatterns.length === 0) {
      // Codemod-less manual change with no pattern to scope by: surface as
      // project-wide guidance (legacyPattern-only entries warn instead).
      llmReviews.push({ codemodId: lt.id, prompt: lt.prompt, files: [] });
    }
  }

  return {
    changed: filesModified.length > 0 || filesDeleted.length > 0,
    filesModified,
    filesDeleted,
    warnings,
    appliedCodemodIds,
    llmReviews,
  };
}
