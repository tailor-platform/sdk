import * as path from "pathe";
import {
  arrayElements,
  entryKey,
  excerptOf,
  followingComma,
  lineOf,
  lineStart,
  objectEntries,
  ownLineIndent,
  ownLineRange,
  pairValue,
} from "../../../../src/ast-grep-helpers";
import { findDefineConfigCalls, type ManualMigration } from "../../../../src/define-config";
import { sourceStringContent } from "../../../../src/source-strings";
import type { LlmReviewFinding } from "../../../../src/types";
import type { Edit, SgNode } from "@ast-grep/napi";

/** Services keyed by namespace, each namespace holding its own `files`. */
const NAMESPACED_SERVICES: ReadonlySet<string> = new Set(["db", "resolver"]);
const SINGLE_SERVICES: ReadonlySet<string> = new Set(["executor", "workflow", "httpAdapter"]);
const TEST_FILE_SUFFIXES = [".test.ts", ".spec.ts"];

type Analysis = { edits: Edit[]; findings: ManualMigration[] };

function isStringLiteral(element: SgNode): boolean {
  return element.kind() === "string" || element.kind() === "template_string";
}

function isNegation(element: SgNode): boolean {
  return isStringLiteral(element) && element.text()[1] === "!";
}

function testFileSuffixOf(element: SgNode): string | undefined {
  if (!isStringLiteral(element)) return undefined;
  const withoutClosingQuote = element.text().slice(0, -1);
  return TEST_FILE_SUFFIXES.find((suffix) => withoutClosingQuote.endsWith(suffix));
}

function isTestFilePattern(element: SgNode): boolean {
  return testFileSuffixOf(element) !== undefined;
}

/** The `patterns` of the `!` elements that directly follow `elements[index]`. */
function negationsAfter(
  elements: SgNode[],
  patterns: (string | null)[],
  index: number,
): Set<string | null> {
  const end = elements.findIndex((element, i) => i > index && !isNegation(element));
  return new Set(patterns.slice(index + 1, end === -1 ? undefined : end));
}

/** Whether a `files` entry can match files outside the config's own directory. */
function mayEscapeConfigDir(content: string | null): boolean {
  if (content === null) return true;
  const pattern = path.normalize(content);
  return pattern.startsWith("/") || pattern.startsWith("../") || /^[A-Za-z]:[\\/]/u.test(pattern);
}

/** `element` with `!` inserted after its opening quote, keeping its escapes. */
function negated(element: SgNode): string {
  const text = element.text();
  return `${text[0]}!${text.slice(1)}`;
}

/** The edit that removes `entry` and its separating comma from its object, keeping comments. */
function entryRemoval(source: string, entries: SgNode[], entry: SgNode): Edit {
  const line = ownLineRange(source, entry);
  if (line) return { startPos: line.start, endPos: line.end, insertedText: "" };
  const comma = followingComma(entry);
  if (comma) {
    let end = comma.range().end.index;
    while (source[end] === " " || source[end] === "\t") end += 1;
    return { startPos: entry.range().start.index, endPos: end, insertedText: "" };
  }
  const previous = entries[entries.indexOf(entry) - 1];
  return {
    startPos: previous ? previous.range().end.index : entry.range().start.index,
    endPos: entry.range().end.index,
    insertedText: "",
  };
}

/** Edits that append `texts` as the last elements of `array`. */
function appendElements(source: string, array: SgNode, texts: string[]): Edit[] {
  const last = arrayElements(array).at(-1)!;
  const closingBracket = array.children().at(-1)!;
  const elementIndent = ownLineIndent(source, last);
  const end = last.range().end.index;
  if (ownLineIndent(source, closingBracket) === null || elementIndent === null) {
    return [{ startPos: end, endPos: end, insertedText: `, ${texts.join(", ")}` }];
  }
  const insertAt = lineStart(source, closingBracket.range().start.index);
  return [
    ...(followingComma(last) ? [] : [{ startPos: end, endPos: end, insertedText: "," }]),
    {
      startPos: insertAt,
      endPos: insertAt,
      insertedText: texts.map((text) => `${elementIndent}${text},\n`).join(""),
    },
  ];
}

/** Edits that insert `texts` as elements right after the element at `index` of `array`. */
function insertElementsAfter(
  source: string,
  array: SgNode,
  index: number,
  texts: string[],
): Edit[] {
  const next = arrayElements(array)[index + 1];
  if (!next) return appendElements(source, array, texts);
  const nextIndent = ownLineIndent(source, next);
  if (nextIndent === null) {
    const start = next.range().start.index;
    return [{ startPos: start, endPos: start, insertedText: `${texts.join(", ")}, ` }];
  }
  const insertAt = lineStart(source, next.range().start.index);
  return [
    {
      startPos: insertAt,
      endPos: insertAt,
      insertedText: texts.map((text) => `${nextIndent}${text},\n`).join(""),
    },
  ];
}

function quoteOf(elements: SgNode[]): string {
  const quoted = elements.findLast((element) => element.kind() === "string");
  return quoted?.text()[0] ?? '"';
}

function analyzeService(source: string, service: SgNode, label: string): Analysis {
  const entries = objectEntries(service);
  if (entries.some((entry) => entryKey(entry) === null)) {
    return {
      edits: [],
      findings: [{ reason: `${label} has a spread or computed key`, node: service }],
    };
  }
  const filesEntry = entries.find((entry) => entryKey(entry) === "files");
  const ignoresEntry = entries.find((entry) => entryKey(entry) === "ignores");
  if (!filesEntry) {
    return ignoresEntry
      ? {
          edits: [],
          findings: [{ reason: `${label} has \`ignores\` but no \`files\``, node: service }],
        }
      : { edits: [], findings: [] };
  }
  const files = filesEntry.kind() === "pair" ? pairValue(filesEntry) : null;
  if (files?.kind() !== "array") {
    return {
      edits: [],
      findings: [{ reason: `${label}.files is not an array literal`, node: filesEntry }],
    };
  }

  const elements = arrayElements(files);
  const patterns = elements.map((element) => sourceStringContent(element, source));
  const lastPositive = elements.findLastIndex((element) => !isNegation(element));
  if (lastPositive === -1) {
    return ignoresEntry
      ? { edits: [entryRemoval(source, entries, ignoresEntry)], findings: [] }
      : { edits: [], findings: [] };
  }
  if (!ignoresEntry) {
    const lastNonTestPositive = elements.findLastIndex(
      (element) => !isNegation(element) && !isTestFilePattern(element),
    );
    if (lastNonTestPositive === -1) return { edits: [], findings: [] };
    const existing = negationsAfter(elements, patterns, lastNonTestPositive);
    const quote = quoteOf(elements);
    const missingSuffixes = TEST_FILE_SUFFIXES.filter((suffix) => !existing.has(`!**/*${suffix}`));
    const missing = missingSuffixes.map((suffix) => `${quote}!**/*${suffix}${quote}`);
    const positivesUpToInsertion = elements
      .slice(0, lastNonTestPositive + 1)
      .flatMap((element, index) =>
        isNegation(element) ? [] : [{ element, pattern: patterns[index] }],
      );
    const findings: ManualMigration[] = [];
    if (
      positivesUpToInsertion.some(({ element, pattern }) => {
        const suffix = testFileSuffixOf(element);
        return (
          suffix !== undefined &&
          missingSuffixes.includes(suffix) &&
          (pattern === null || !mayEscapeConfigDir(pattern))
        );
      })
    ) {
      findings.push({
        reason: `${label}.files has a pattern ending in \`.test.ts\` or \`.spec.ts\` before another pattern, so the explicit test-file exclusion inserted after the other pattern excludes the test files the earlier pattern includes`,
        node: filesEntry,
      });
    }
    if (
      positivesUpToInsertion.some(
        ({ element, pattern }) => !isTestFilePattern(element) && mayEscapeConfigDir(pattern),
      )
    ) {
      findings.push({
        reason: `${label}.files can match files outside this config's directory, where the explicit test-file exclusion does not apply`,
        node: filesEntry,
      });
    }
    return {
      edits:
        missing.length > 0 ? insertElementsAfter(source, files, lastNonTestPositive, missing) : [],
      findings,
    };
  }
  const trailingNegations = new Set(patterns.slice(lastPositive + 1));

  const ignores = ignoresEntry.kind() === "pair" ? pairValue(ignoresEntry) : null;
  const ignoreElements =
    ignores?.kind() === "array"
      ? arrayElements(ignores).map((element) => ({
          element,
          pattern: sourceStringContent(element, source),
        }))
      : null;
  if (!ignoreElements || ignoreElements.some(({ pattern }) => pattern === null)) {
    return {
      edits: [],
      findings: [
        { reason: `${label}.ignores is not an array of string literals`, node: ignoresEntry },
      ],
    };
  }
  const missing = ignoreElements
    .filter(({ pattern }) => !trailingNegations.has(`!${pattern}`))
    .map(({ element }) => negated(element));
  return {
    edits: [
      entryRemoval(source, entries, ignoresEntry),
      ...(missing.length > 0 ? appendElements(source, files, missing) : []),
    ],
    findings: [],
  };
}

function objectValue(entry: SgNode): SgNode | null {
  const value = entry.kind() === "pair" ? pairValue(entry) : null;
  return value?.kind() === "object" ? value : null;
}

/** How a finding names a namespace: `.name`, or `[expression]` for a computed key. */
function namespaceLabel(entry: SgNode): string | null {
  const name = entryKey(entry);
  if (name !== null) return `.${name}`;
  const key = entry.kind() === "pair" ? entry.children()[0] : undefined;
  return key?.kind() === "computed_property_name" ? key.text() : null;
}

function mergeInto(target: Analysis, result: Analysis): void {
  target.edits.push(...result.edits);
  target.findings.push(...result.findings);
}

function analyzeConfig(source: string, config: SgNode): Analysis {
  const analysis: Analysis = { edits: [], findings: [] };
  const entries = objectEntries(config);
  if (entries.some((entry) => entryKey(entry) === null)) {
    analysis.findings.push({
      reason: "the config has a spread or computed key that may hold service files",
      node: config,
    });
  }
  for (const entry of entries) {
    const key = entryKey(entry);
    if (key === null || (!NAMESPACED_SERVICES.has(key) && !SINGLE_SERVICES.has(key))) continue;
    const value = objectValue(entry);
    if (!value) {
      analysis.findings.push({ reason: `\`${key}\` is not an object literal`, node: entry });
      continue;
    }
    if (SINGLE_SERVICES.has(key)) {
      mergeInto(analysis, analyzeService(source, value, key));
      continue;
    }
    for (const namespaceEntry of objectEntries(value)) {
      const label = namespaceLabel(namespaceEntry);
      const namespaceConfig = label === null ? null : objectValue(namespaceEntry);
      if (label === null || !namespaceConfig) {
        analysis.findings.push({
          reason: `a \`${key}\` namespace is not written as an object literal`,
          node: namespaceEntry,
        });
        continue;
      }
      mergeInto(analysis, analyzeService(source, namespaceConfig, `${key}${label}`));
    }
  }
  return analysis;
}

function analyzeFile(
  source: string,
  filePath: string,
): { root: SgNode; analysis: Analysis } | null {
  const found = findDefineConfigCalls(source, filePath);
  if (!found) return null;
  const analysis: Analysis = { edits: [], findings: [] };
  for (const call of found.calls) {
    if ("reason" in call) {
      analysis.findings.push(call);
      continue;
    }
    mergeInto(analysis, analyzeConfig(source, call.config));
  }
  return { root: found.root, analysis };
}

/**
 * Move each service's deprecated `ignores` into `files` as `!` patterns, and
 * write out the test-file exclusion v3 no longer applies implicitly.
 * @param source - File contents
 * @param filePath - Path to the file being transformed
 * @returns Transformed source, or null when nothing matched
 */
export default function transform(source: string, filePath = ""): string | null {
  const result = analyzeFile(source, filePath);
  if (!result || result.analysis.edits.length === 0) return null;
  return result.root.commitEdits(result.analysis.edits);
}

/**
 * Report service configs whose `ignores` this transform cannot move into
 * `files`, or whose test-file exclusion it cannot fully carry over.
 * @param source - File contents
 * @param filePath - Path to the file being reviewed
 * @param relativePath - Repository-relative path reported to the user
 * @returns Findings for configs needing a manual migration
 */
export function reviewFindings(
  source: string,
  filePath: string,
  relativePath: string,
): LlmReviewFinding[] {
  const result = analyzeFile(source, filePath);
  if (!result) return [];
  return result.analysis.findings.map((finding) => ({
    file: relativePath,
    line: lineOf(finding.node),
    message: `Migrate \`ignores\` and the default test-file exclusion into \`files\` by hand: ${finding.reason}.`,
    excerpt: excerptOf(finding.node),
  }));
}
