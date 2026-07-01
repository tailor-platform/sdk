import * as fs from "node:fs";
import * as url from "node:url";
import { parse, Lang } from "@ast-grep/napi";
import chalk from "chalk";
import { structuredPatch } from "diff";
import * as path from "pathe";
import picomatch from "picomatch";
import type {
  CodemodPackage,
  CodemodPattern,
  CodemodPatternGroup,
  LlmReview,
  LlmReviewFinding,
  ReviewFindingsFn,
} from "./types";
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
const SOURCE_STRING_FRAGMENT_SEPARATOR = "\0";
const MASKED_SOURCE_NODE_KINDS: ReadonlySet<ReturnType<SgNode["kind"]>> = new Set([
  "comment",
  "string",
  "regex",
  "string_fragment",
  "jsx_text",
]);
const SOURCE_VALUE_FLAGS = new Set([
  "--env-file-if-exists",
  "--env-file",
  "--profile",
  "--config",
  "--workspace-id",
  "--arg",
  "--query",
  "--file",
  "--name",
  "--namespace",
  "--dir",
  "-e",
  "-p",
  "-c",
  "-w",
  "-a",
  "-q",
  "-f",
  "-n",
]);
const SOURCE_CLI_BINARY_RE =
  /^(?:(?:.*[\\/])?tailor(?:\.(?:cmd|ps1|exe))?|(?:.*[\\/])?tailor-sdk(?:@[^\s'"`;|&)]+)?(?:\.(?:cmd|ps1|exe))?|@tailor-platform\/sdk(?:@[^\s'"`;|&)]+)?)$/;

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
 * @returns The transform function and optional review detector
 */
async function loadTransformModule(
  scriptPath: string,
): Promise<{ transform: TransformFn; reviewFindings?: ReviewFindingsFn }> {
  const mod = await import(url.pathToFileURL(scriptPath).href);
  if (typeof mod.default !== "function") {
    throw new Error(`Transform at ${scriptPath} does not have a default export function`);
  }
  return {
    transform: mod.default as TransformFn,
    reviewFindings:
      typeof mod.reviewFindings === "function"
        ? (mod.reviewFindings as ReviewFindingsFn)
        : undefined,
  };
}

/** A loaded transform with its file matcher. */
interface LoadedTransform {
  id: string;
  /** Undefined for codemod-less ("manual") entries that ship only guidance. */
  transform?: TransformFn;
  reviewFindings?: ReviewFindingsFn;
  matches: (relativePath: string) => boolean;
  legacyPatterns: CodemodPatternGroup[];
  sourceStringLegacyPatterns: CodemodPatternGroup[];
  sourceTextLegacyPatterns: CodemodPatternGroup[];
  suspiciousPatterns: CodemodPatternGroup[];
  sourceStringSuspiciousPatterns: CodemodPatternGroup[];
  prompt?: string;
  reviewSupersededBy: string[];
}

function contentForResidualMatching(relative: string, content: string): string {
  const ext = path.extname(relative).toLowerCase();
  return SOURCE_EXTENSIONS.has(ext) ? maskSourceNonCode(relative, content) : content;
}

function sourceStringFragmentGapForResidualMatching(gap: string): string {
  if (/^\\["']$/.test(gap)) return gap.slice(1);
  return /^(?:\\(?:[nrtvf]|\r\n|\r|\n)|\s)+$/.test(gap) ? " " : SOURCE_STRING_FRAGMENT_SEPARATOR;
}

function sourceStringNodeContentForResidualMatching(node: SgNode, content: string): string | null {
  const parts: string[] = [];
  let previousFragmentEnd: number | null = null;

  for (const child of node.children()) {
    if (child.kind() !== "string_fragment") continue;

    const range = child.range();
    if (previousFragmentEnd != null && range.start.index > previousFragmentEnd) {
      parts.push(
        sourceStringFragmentGapForResidualMatching(
          content.slice(previousFragmentEnd, range.start.index),
        ),
      );
    }
    parts.push(child.text());
    previousFragmentEnd = range.end.index;
  }

  return parts.length === 0 ? null : parts.join("");
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
  const visit = (node: SgNode): void => {
    if (node.kind() === "arguments") {
      const value = sourceArgumentsCommandContent(node, content);
      if (value != null) sourceStrings.push(value);
    }
    if (node.kind() === "array") {
      const value = sourceArrayCommandContent(node, content);
      if (value != null) sourceStrings.push(value);
    }
    const kind = node.kind();
    if (kind === "string" || kind === "template_string") {
      if (isSourceTailorSdkValueArgument(node, content)) return;
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

function isConstVariableDeclarator(node: SgNode): boolean {
  return (
    node
      .parent()
      ?.children()
      .some((child) => child.kind() === "const") ?? false
  );
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
  const executable = args[0] == null ? null : sourceStringLikeNodeContent(args[0]!, source);
  const argv = args[1];
  if (executable == null || argv?.kind() !== "array") return null;

  const values = sourceArrayCommandValues(argv, source);
  return values.length === 0 ? null : [executable, ...values].join(" ");
}

function sourceArrayCommandContent(node: SgNode, source: string): string | null {
  const values = sourceArrayCommandValues(node, source);
  return values.length < 2 ? null : values.join(" ");
}

function sourceArrayCommandValues(node: SgNode, source: string): string[] {
  const values: string[] = [];
  for (const element of sourceArrayElements(node)) {
    if (isSourceValueArgument(element, source)) continue;
    const value = sourceStringLikeNodeContent(element, source);
    if (value != null) values.push(value);
  }
  return values;
}

function isSourceTailorSdkValueArgument(fragment: SgNode, source: string): boolean {
  const text =
    fragment.kind() === "string_fragment"
      ? fragment.text()
      : sourceStringLikeNodeContent(fragment, source);
  return text != null && text.includes("tailor-sdk") && isSourceValueArgument(fragment, source);
}

function isSyntaxOnlyNode(node: SgNode): boolean {
  const kind = node.kind();
  return (
    kind === "[" ||
    kind === "]" ||
    kind === "(" ||
    kind === ")" ||
    kind === "," ||
    kind === "comment"
  );
}

function sourceArrayElements(node: SgNode): SgNode[] {
  return node.children().filter((child: SgNode) => !isSyntaxOnlyNode(child));
}

function nodeRangeKey(node: SgNode): string {
  const range = node.range();
  return `${range.start.index}:${range.end.index}`;
}

function sourceStringLikeNodeContent(node: SgNode, source: string): string | null {
  const directValue = sourceStringNodeContent(node, source);
  if (directValue != null) return directValue;
  return node.kind() === "identifier" ? sourceScopedStringVariableContent(node, source) : null;
}

function sourceScopedStringVariableContent(identifier: SgNode, source: string): string | null {
  const name = identifier.text();
  const before = identifier.range().start.index;
  let current = identifier.parent();
  while (current != null) {
    if (isSourceScopeNode(current)) {
      const value = findSourceStringVariableInScope(current, name, before, source);
      if (value != null) return value;
    }
    current = current.parent();
  }
  return null;
}

function findSourceStringVariableInScope(
  scope: SgNode,
  name: string,
  before: number,
  source: string,
): string | null {
  let value: string | null = null;
  const visit = (node: SgNode): void => {
    if (node !== scope && isSourceScopeNode(node)) return;
    if (node.kind() === "variable_declarator" && node.range().end.index < before) {
      const declarationValue = sourceStringVariableDeclarationValue(node, name, source);
      if (declarationValue != null) value = declarationValue;
      return;
    }
    for (const child of node.children()) {
      visit(child);
    }
  };
  visit(scope);
  return value;
}

function sourceStringVariableDeclarationValue(
  node: SgNode,
  name: string,
  source: string,
): string | null {
  if (!isConstVariableDeclarator(node)) return null;
  const children = node.children();
  const identifier = children.find((child) => child.kind() === "identifier");
  if (identifier?.text() !== name) return null;
  const initializer = children.findLast(
    (child) => sourceConstInitializerContent(child, source) != null,
  );
  return initializer == null ? null : sourceConstInitializerContent(initializer, source);
}

function sourceConstInitializerContent(node: SgNode, source: string): string | null {
  const directValue = sourceStringNodeContent(node, source);
  if (directValue != null) return directValue;
  if (
    node.kind() !== "as_expression" &&
    node.kind() !== "satisfies_expression" &&
    node.kind() !== "parenthesized_expression"
  ) {
    return null;
  }
  for (const child of node.children()) {
    const childValue = sourceConstInitializerContent(child, source);
    if (childValue != null) return childValue;
  }
  return null;
}

function isSourceScopeNode(node: SgNode): boolean {
  const kind = node.kind();
  return (
    kind === "program" ||
    kind === "statement_block" ||
    kind === "function_declaration" ||
    kind === "arrow_function" ||
    kind === "method_definition"
  );
}

function sourceStringNodeContent(node: SgNode, source: string): string | null {
  const kind = node.kind();
  if (kind !== "string" && kind !== "template_string") return null;
  if (
    kind === "template_string" &&
    node.children().some((child: SgNode) => child.kind() === "template_substitution")
  ) {
    return null;
  }
  const range = node.range();
  return source.slice(range.start.index + 1, range.end.index - 1);
}

function isSourceValueArgument(fragment: SgNode, source: string): boolean {
  const stringNode = fragment.kind() === "string_fragment" ? fragment.parent() : fragment;
  if (stringNode == null) return false;
  const parent = stringNode.parent();
  if (parent?.kind() !== "array") return false;

  const elements = sourceArrayElements(parent);
  const index = elements.findIndex((element) => nodeRangeKey(element) === nodeRangeKey(stringNode));
  if (index <= 0) return false;
  if (!isTailorCliArgumentArray(parent, index, source)) return false;

  const previous = sourceStringLikeNodeContent(elements[index - 1]!, source);
  return (
    previous != null &&
    SOURCE_VALUE_FLAGS.has(previous.split("=", 1)[0]!) &&
    !previous.includes("=")
  );
}

function isTailorCliArgumentArray(arrayNode: SgNode, index: number, source: string): boolean {
  const argumentsNode = arrayNode.parent();
  if (argumentsNode?.kind() === "arguments") {
    const callArgs = sourceArrayElements(argumentsNode);
    const executable =
      callArgs[0] == null ? null : sourceStringLikeNodeContent(callArgs[0]!, source);
    if (executable != null && SOURCE_CLI_BINARY_RE.test(executable)) return true;
  }

  const elements = sourceArrayElements(arrayNode);
  return elements.slice(0, index).some((element) => {
    const value = sourceStringLikeNodeContent(element, source);
    return value != null && SOURCE_CLI_BINARY_RE.test(value);
  });
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

function compareReviewFindings(a: LlmReviewFinding, b: LlmReviewFinding): number {
  return (
    a.file.localeCompare(b.file) ||
    a.line - b.line ||
    a.message.localeCompare(b.message) ||
    a.excerpt.localeCompare(b.excerpt)
  );
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
    const loadedModule = scriptPath ? await loadTransformModule(scriptPath) : undefined;
    loaded.push({
      id: codemod.id,
      transform: loadedModule?.transform,
      reviewFindings: loadedModule?.reviewFindings,
      matches: picomatch(patterns, { dot: true }),
      legacyPatterns: codemod.legacyPatterns ?? [],
      sourceStringLegacyPatterns: codemod.sourceStringLegacyPatterns ?? [],
      sourceTextLegacyPatterns: codemod.sourceTextLegacyPatterns ?? [],
      suspiciousPatterns: codemod.suspiciousPatterns ?? [],
      sourceStringSuspiciousPatterns: codemod.sourceStringSuspiciousPatterns ?? [],
      prompt: codemod.prompt,
      reviewSupersededBy: codemod.reviewSupersededBy ?? [],
    });
  }

  const filesModified: string[] = [];
  const warnings: string[] = [];
  const appliedCodemodIds = new Set<string>();
  const seen = new Set<string>();
  const suspiciousByCodemod = new Map<string, Set<string>>();
  const findingsByCodemod = new Map<string, LlmReviewFinding[]>();

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
    const sourceTextContent = sourceTextContentForResidualMatching(relative, current);
    warnings.push(
      ...legacyPatternWarnings(
        relative,
        residualContent,
        sourceStringContent,
        sourceTextContent,
        matchedTransforms,
      ),
    );

    for (const lt of matchedTransforms) {
      if (!lt.prompt) continue;
      const filesForReview = (): Set<string> => {
        let files = suspiciousByCodemod.get(lt.id);
        if (!files) {
          files = new Set<string>();
          suspiciousByCodemod.set(lt.id, files);
        }
        return files;
      };
      if (lt.reviewFindings) {
        const findings = await lt.reviewFindings(current, absolute, relative);
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
      const matchesSource =
        lt.suspiciousPatterns.some((p) => matchResidualPattern(residualContent, p) !== null) ||
        (sourceStringContent != null &&
          lt.sourceStringSuspiciousPatterns.some(
            (p) => matchResidualPattern(sourceStringContent, p) !== null,
          ));
      if (matchesSource) {
        filesForReview().add(relative);
      }
    }
  }

  const llmReviews: LlmReview[] = [];
  const loadedIds = new Set(loaded.map((lt) => lt.id));
  for (const lt of loaded) {
    if (!lt.prompt) continue;
    if (lt.reviewSupersededBy.some((id) => loadedIds.has(id))) continue;
    if (
      lt.suspiciousPatterns.length > 0 ||
      lt.sourceStringSuspiciousPatterns.length > 0 ||
      lt.reviewFindings
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
    changed: filesModified.length > 0,
    filesModified,
    warnings,
    appliedCodemodIds,
    llmReviews,
  };
}
