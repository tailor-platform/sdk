import * as fs from "node:fs";
import * as url from "node:url";
import { parse, Lang } from "@ast-grep/napi";
import { color, renderFor, type StyleFn } from "@tailor-platform/shared/color";
import { structuredPatch } from "diff";
import * as path from "pathe";
import picomatch from "picomatch";
import { nodeRangeKey, sourceArrayElements, sourceStaticStringContent } from "./source-strings";
import { TAILOR_CLI_VALUE_FLAG_SET } from "./tailor-cli-tokens";
import { shouldSkipDirectory, SOURCE_EXTENSIONS, walkFiles } from "./walk-files";
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
  filesModified: string[];
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
function printDiff(filePath: string, before: string, after: string): void {
  const patch = structuredPatch(filePath, filePath, before, after, "", "", { context: 3 });
  if (patch.hunks.length === 0) return;

  writeDiffLine("");
  writeDiffLine(`--- ${filePath}`, color.bold);
  writeDiffLine(`+++ ${filePath}`, color.bold);

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
 * Expects the module to have a default export that is a TransformFn.
 * @param scriptPath - Absolute path to the transform script
 * @returns The transform function and optional review detectors
 */
async function loadTransformModule(scriptPath: string): Promise<{
  transform: TransformFn;
  reviewFindings?: ReviewFindingsFn;
  reviewFindingsBeforeTransform?: ReviewFindingsFn;
}> {
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
  reviewFindings?: ReviewFindingsFn;
  reviewFindingsBeforeTransform?: ReviewFindingsFn;
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

const SOURCE_STRING_OPAQUE_VALUE = "_";

function sourceStringEscapeForResidualMatching(escape: string): string {
  if (/^\\(?:[nrtvf]|\r\n|\r|\n)$/.test(escape)) return " ";
  if (/^\\[\\"'`$/]$/.test(escape)) return escape.slice(1);
  return SOURCE_STRING_OPAQUE_VALUE;
}

function sourceStringFragmentGapForResidualMatching(gap: string): string {
  return /^\s+$/.test(gap) ? " " : SOURCE_STRING_FRAGMENT_SEPARATOR;
}

function sourceStringNodeContentForResidualMatching(node: SgNode, content: string): string | null {
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

    if (kind === "string_fragment") {
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
    const value = sourceStaticStringContent(element, source);
    if (value != null) values.push(value);
  }
  return values;
}

function isSourceTailorSdkValueArgument(fragment: SgNode, source: string): boolean {
  const text =
    fragment.kind() === "string_fragment"
      ? fragment.text()
      : sourceStaticStringContent(fragment, source);
  return text != null && text.includes("tailor-sdk") && isSourceValueArgument(fragment, source);
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

  const previous = sourceStaticStringContent(elements[index - 1]!, source);
  return (
    previous != null &&
    TAILOR_CLI_VALUE_FLAG_SET.has(previous.split("=", 1)[0]!) &&
    !previous.includes("=")
  );
}

function isTailorCliArgumentArray(arrayNode: SgNode, index: number, source: string): boolean {
  const argumentsNode = arrayNode.parent();
  if (argumentsNode?.kind() === "arguments") {
    const callArgs = sourceArrayElements(argumentsNode);
    const executable = callArgs[0] == null ? null : sourceStaticStringContent(callArgs[0]!, source);
    if (executable != null && SOURCE_CLI_BINARY_RE.test(executable)) return true;
  }

  const elements = sourceArrayElements(arrayNode);
  return elements.slice(0, index).some((element) => {
    const value = sourceStaticStringContent(element, source);
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

/**
 * Run multiple codemods on a project directory using in-memory chaining.
 * Each file is processed through all transforms whose filePatterns match it.
 * Later transforms see earlier transforms' output — even in dry-run mode.
 * Review detection (reviewFindings and suspicious patterns) runs against each
 * codemod's own position in the transform chain, so a later codemod's rewrite
 * cannot hide an earlier codemod's findings.
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
      reviewFindings: loadedModule?.reviewFindings,
      reviewFindingsBeforeTransform: loadedModule?.reviewFindingsBeforeTransform,
      matches: codemodFileMatcher(codemod),
      legacyPatterns: codemod.legacyPatterns ?? [],
      sourceStringLegacyPatterns: codemod.sourceStringLegacyPatterns ?? [],
      sourceTextLegacyPatterns: codemod.sourceTextLegacyPatterns ?? [],
      suspiciousPatterns: codemod.suspiciousPatterns ?? [],
      sourceStringSuspiciousPatterns: codemod.sourceStringSuspiciousPatterns ?? [],
      prompt: codemod.prompt,
      reviewSupersededBy: codemod.reviewSupersededBy ?? [],
    });
  }

  const absoluteTargetPath = path.resolve(targetPath);
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

    if (current !== original) {
      filesModified.push(absolute);
      if (dryRun) {
        printDiff(absolute, original, current);
      } else {
        await fs.promises.writeFile(absolute, current, "utf-8");
      }
    }

    const residualBySnapshot = new Map<string, { residual: string; sourceString: string | null }>();
    const residualFor = (content: string): { residual: string; sourceString: string | null } => {
      let entry = residualBySnapshot.get(content);
      if (!entry) {
        entry = {
          residual: contentForResidualMatching(relative, content),
          sourceString: sourceStringContentForResidualMatching(relative, content),
        };
        residualBySnapshot.set(content, entry);
      }
      return entry;
    };

    const { residual: residualContent, sourceString: sourceStringContent } = residualFor(current);
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
      if (lt.suspiciousPatterns.length === 0 && lt.sourceStringSuspiciousPatterns.length === 0) {
        continue;
      }
      const { residual, sourceString } = residualFor(snapshot);
      const matchesSource =
        lt.suspiciousPatterns.some((p) => matchResidualPattern(residual, p) !== null) ||
        (sourceString != null &&
          lt.sourceStringSuspiciousPatterns.some(
            (p) => matchResidualPattern(sourceString, p) !== null,
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
      lt.reviewFindings ||
      lt.reviewFindingsBeforeTransform
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
