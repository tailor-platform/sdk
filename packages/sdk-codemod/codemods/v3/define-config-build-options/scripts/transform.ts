import {
  entryKey,
  excerptOf,
  lineOf,
  lineStart,
  objectEntries,
  ownLineIndent,
  ownLineRange,
  pairValue,
} from "../../../../src/ast-grep-helpers";
import { findDefineConfigCalls, type ManualMigration } from "../../../../src/define-config";
import type { LlmReviewFinding } from "../../../../src/types";
import type { Edit, SgNode } from "@ast-grep/napi";

const GROUP_KEY = "buildOptions";
const MOVED_KEYS: ReadonlySet<string> = new Set(["inlineSourcemap", "logLevel"]);
const NESTED_INDENT = "  ";

function reindent(text: string, fromIndent: string, toIndent: string): string {
  return text
    .split("\n")
    .map((line, index) =>
      index > 0 && line.startsWith(fromIndent) ? toIndent + line.slice(fromIndent.length) : line,
    )
    .join("\n");
}

function movedEntryLines(source: string, entries: SgNode[], toIndent: string): string {
  return entries
    .map((entry) => {
      const fromIndent = ownLineIndent(source, entry) ?? "";
      return `${toIndent}${reindent(entry.text(), fromIndent, toIndent)},\n`;
    })
    .join("");
}

type Analysis = { edits: Edit[] } | ManualMigration | null;

function analyzeConfig(source: string, config: SgNode): Analysis {
  const entries = objectEntries(config);
  const legacy = entries.filter((entry) => MOVED_KEYS.has(entryKey(entry) ?? ""));
  if (legacy.length === 0) {
    return entries.some((entry) => entryKey(entry) === null)
      ? { reason: "a spread or computed key may hide inlineSourcemap or logLevel", node: config }
      : null;
  }
  if (entries.some((entry) => entryKey(entry) === null)) {
    return { reason: "the config also has a spread or computed key", node: config };
  }

  const ranges = legacy.map((entry) => ownLineRange(source, entry));
  if (ranges.some((range) => range === null)) {
    return { reason: "inlineSourcemap or logLevel shares its line with other code", node: config };
  }
  const deletions = ranges.map((range) => ({
    startPos: range!.start,
    endPos: range!.end,
    insertedText: "",
  }));

  const group = entries.find((entry) => entryKey(entry) === GROUP_KEY);
  if (!group) {
    const indent = ownLineIndent(source, legacy[0]!)!;
    const created =
      `${indent}${GROUP_KEY}: {\n` +
      movedEntryLines(source, legacy, indent + NESTED_INDENT) +
      `${indent}},\n`;
    return { edits: [{ ...deletions[0]!, insertedText: created }, ...deletions.slice(1)] };
  }

  const groupObject = group.kind() === "pair" ? pairValue(group) : null;
  if (groupObject?.kind() !== "object") {
    return { reason: "buildOptions is not written as an object literal", node: group };
  }
  const groupEntries = objectEntries(groupObject);
  if (groupEntries.some((entry) => entryKey(entry) === null)) {
    return { reason: "buildOptions has a spread or computed key", node: group };
  }
  const movedKeys = new Set(legacy.map(entryKey));
  if (groupEntries.some((entry) => movedKeys.has(entryKey(entry)))) {
    return {
      reason: "the same option is set both at the top level and in buildOptions",
      node: group,
    };
  }
  const closingBrace = groupObject.children().at(-1)!;
  const closingIndent = ownLineIndent(source, closingBrace);
  const lastGroupEntry = groupEntries.at(-1);
  const innerIndent = lastGroupEntry
    ? ownLineIndent(source, lastGroupEntry)
    : closingIndent === null
      ? null
      : closingIndent + NESTED_INDENT;
  if (closingIndent === null || innerIndent === null) {
    return { reason: "buildOptions is written on a single line", node: group };
  }

  const edits: Edit[] = [...deletions];
  if (lastGroupEntry) {
    const afterLast = source.slice(lastGroupEntry.range().end.index).trimStart();
    if (!afterLast.startsWith(",")) {
      const end = lastGroupEntry.range().end.index;
      edits.push({ startPos: end, endPos: end, insertedText: "," });
    }
  }
  const insertAt = lineStart(source, closingBrace.range().start.index);
  edits.push({
    startPos: insertAt,
    endPos: insertAt,
    insertedText: movedEntryLines(source, legacy, innerIndent),
  });
  return { edits };
}

function analyzeFile(
  source: string,
  filePath: string,
): { root: SgNode; results: Exclude<Analysis, null>[] } | null {
  const found = findDefineConfigCalls(source, filePath);
  if (!found) return null;
  const results = found.calls.flatMap((call) => {
    if ("reason" in call) return [call];
    const result = analyzeConfig(source, call.config);
    return result ? [result] : [];
  });
  return { root: found.root, results };
}

/**
 * Move the deprecated top-level `inlineSourcemap` and `logLevel` of
 * `defineConfig()` into `buildOptions`.
 * @param source - File contents
 * @param filePath - Path to the file being transformed
 * @returns Transformed source, or null when nothing matched
 */
export default function transform(source: string, filePath = ""): string | null {
  const analysis = analyzeFile(source, filePath);
  if (!analysis) return null;
  const edits = analysis.results.flatMap((result) => ("edits" in result ? result.edits : []));
  return edits.length > 0 ? analysis.root.commitEdits(edits) : null;
}

/**
 * Report `defineConfig()` calls whose top-level `inlineSourcemap` or
 * `logLevel` this transform cannot safely move into `buildOptions`.
 * @param source - File contents
 * @param filePath - Path to the file being reviewed
 * @param relativePath - Repository-relative path reported to the user
 * @returns Findings for configs needing a manual move
 */
export function reviewFindings(
  source: string,
  filePath: string,
  relativePath: string,
): LlmReviewFinding[] {
  const analysis = analyzeFile(source, filePath);
  if (!analysis) return [];
  return analysis.results.flatMap((result) =>
    "reason" in result
      ? [
          {
            file: relativePath,
            line: lineOf(result.node),
            message: `Move inlineSourcemap and logLevel into buildOptions by hand: ${result.reason}.`,
            excerpt: excerptOf(result.node),
          },
        ]
      : [],
  );
}
