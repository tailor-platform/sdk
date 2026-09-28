import { parse, Lang } from "@ast-grep/napi";
import {
  findImportStatements,
  importBindings,
  stringValue,
} from "../../../../src/ast-grep-helpers";
import type { LlmReviewFinding } from "../../../../src/types";
import type { Edit, SgNode } from "@ast-grep/napi";

const SDK_MODULE = "@tailor-platform/sdk";
const DEFINE_CONFIG = "defineConfig";
const GROUP_KEY = "buildOptions";
const MOVED_KEYS: ReadonlySet<string> = new Set(["inlineSourcemap", "logLevel"]);
const NESTED_INDENT = "  ";
const ARGUMENT_PUNCTUATION: ReadonlySet<string> = new Set(["(", ")", ",", "comment"]);
const OBJECT_PUNCTUATION: ReadonlySet<string> = new Set(["{", "}", ",", "comment"]);

function sourceLang(filePath: string, source: string): Lang {
  const lowerPath = filePath.toLowerCase();
  if (/\.(?:ts|mts|cts)$/u.test(lowerPath)) return Lang.TypeScript;
  if (/\.(?:tsx|jsx|js)$/u.test(lowerPath)) return Lang.Tsx;
  return source.includes("</") ? Lang.Tsx : Lang.TypeScript;
}

function parseRoot(source: string, filePath: string): SgNode | null {
  try {
    return parse(sourceLang(filePath, source), source).root();
  } catch {
    return null;
  }
}

function defineConfigNames(root: SgNode): Set<string> {
  const names = new Set<string>();
  for (const statement of findImportStatements(root)) {
    for (const binding of importBindings(statement)) {
      if (binding.source === SDK_MODULE && binding.importedName === DEFINE_CONFIG) {
        names.add(binding.localName);
      }
    }
  }
  return names;
}

function isDefineConfigCall(call: SgNode, names: ReadonlySet<string>): boolean {
  const callee = call.children()[0];
  return callee?.kind() === "identifier" && names.has(callee.text());
}

function callArgument(call: SgNode): SgNode | null {
  const args = call.children().find((child) => child.kind() === "arguments");
  const values =
    args?.children().filter((child) => !ARGUMENT_PUNCTUATION.has(String(child.kind()))) ?? [];
  return values.length === 1 ? values[0]! : null;
}

function objectEntries(object: SgNode): SgNode[] {
  return object.children().filter((child) => !OBJECT_PUNCTUATION.has(String(child.kind())));
}

function entryKey(entry: SgNode): string | null {
  if (entry.kind() === "shorthand_property_identifier") return entry.text();
  if (entry.kind() !== "pair") return null;
  const key = entry.children()[0];
  if (key?.kind() !== "property_identifier" && key?.kind() !== "string") return null;
  return stringValue(key);
}

function pairValue(pair: SgNode): SgNode | null {
  const children = pair.children();
  const colonIndex = children.findIndex((child) => child.kind() === ":");
  if (colonIndex === -1) return null;
  return children.slice(colonIndex + 1).find((child) => child.kind() !== "comment") ?? null;
}

function lineStart(source: string, index: number): number {
  return source.lastIndexOf("\n", index - 1) + 1;
}

function ownLineIndent(source: string, node: SgNode): string | null {
  const start = node.range().start.index;
  const indent = source.slice(lineStart(source, start), start);
  return /^[ \t]*$/u.test(indent) ? indent : null;
}

/** The source range covering `entry`'s whole line(s), including its trailing comma and newline. */
function ownLineRange(source: string, entry: SgNode): { start: number; end: number } | null {
  if (ownLineIndent(source, entry) === null) return null;
  let end = entry.range().end.index;
  while (source[end] === " " || source[end] === "\t") end += 1;
  if (source[end] === ",") end += 1;
  while (source[end] === " " || source[end] === "\t") end += 1;
  if (source[end] === "\r") end += 1;
  if (source[end] !== "\n") return null;
  return { start: lineStart(source, entry.range().start.index), end: end + 1 };
}

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

type Analysis = { edits: Edit[] } | { reason: string; node: SgNode } | null;

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
  if (!source.includes(DEFINE_CONFIG)) return null;
  const root = parseRoot(source, filePath);
  if (!root) return null;
  const names = defineConfigNames(root);
  if (names.size === 0) return null;

  const results: Exclude<Analysis, null>[] = [];
  for (const call of root.findAll({ rule: { kind: "call_expression" } })) {
    if (!isDefineConfigCall(call, names)) continue;
    const config = callArgument(call);
    if (!config) continue;
    if (config.kind() !== "object") {
      results.push({ reason: "the defineConfig() argument is not an object literal", node: call });
      continue;
    }
    const result = analyzeConfig(source, config);
    if (result) results.push(result);
  }
  return { root, results };
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
            line: result.node.range().start.line + 1,
            message: `Move inlineSourcemap and logLevel into buildOptions by hand: ${result.reason}.`,
            excerpt: result.node.text().split("\n", 1)[0]!.trim(),
          },
        ]
      : [],
  );
}
