import {
  arrayElements,
  entryKey,
  excerptOf,
  lineOf,
  objectEntries,
  ownLineIndent,
  ownLineRange,
  pairValue,
} from "../../../../src/ast-grep-helpers";
import { findDefineConfigCalls, type ManualMigration } from "../../../../src/define-config";
import type { LlmReviewFinding } from "../../../../src/types";
import type { Edit, SgNode } from "@ast-grep/napi";

const IDP_KEY = "idp";

function reindent(text: string, fromIndent: string, toIndent: string): string {
  return text
    .split("\n")
    .map((line, index) =>
      index > 0 && line.startsWith(fromIndent) ? toIndent + line.slice(fromIndent.length) : line,
    )
    .join("\n");
}

function isExternalDeclaration(element: SgNode): boolean {
  return (
    element.kind() === "object" &&
    objectEntries(element).some((entry) => entryKey(entry) === "external")
  );
}

type Analysis = { edits: Edit[] } | ManualMigration | null;

function isLocalArray(config: SgNode, name: string): boolean {
  return config
    .getRoot()
    .root()
    .findAll({ rule: { kind: "variable_declarator" } })
    .some((declarator) => {
      const [binding] = declarator.children();
      return (
        binding?.kind() === "identifier" &&
        binding.text() === name &&
        declarator.children().at(-1)?.kind() === "array"
      );
    });
}

function analyzeConfig(source: string, config: SgNode): Analysis {
  const entries = objectEntries(config);
  const entry = entries.find((candidate) => entryKey(candidate) === IDP_KEY);
  if (!entry) {
    return entries.some((candidate) => entryKey(candidate) === null)
      ? { reason: "a spread or computed key may carry an idp array", node: config }
      : null;
  }
  const value = entry.kind() === "pair" ? pairValue(entry) : null;
  const referenced =
    entry.kind() === "shorthand_property_identifier"
      ? entry.text()
      : value?.kind() === "identifier"
        ? value.text()
        : null;
  if (referenced !== null) {
    return isLocalArray(config, referenced)
      ? { reason: `idp refers to ${referenced}, which is declared as an array`, node: entry }
      : null;
  }
  const array = value;
  if (array?.kind() !== "array") return null;

  if (array.children().some((child) => child.kind() === "comment")) {
    return { reason: "the array contains a comment", node: entry };
  }
  const elements = arrayElements(array);
  if (elements.some((element) => element.kind() === "spread_element")) {
    return { reason: "the array is built with a spread", node: entry };
  }
  if (elements.length === 0) {
    const range = ownLineRange(source, entry);
    return range
      ? { edits: [{ startPos: range.start, endPos: range.end, insertedText: "" }] }
      : { reason: "the empty array shares its line with other code", node: entry };
  }
  if (elements.length > 1) {
    const external = elements.some(isExternalDeclaration)
      ? ", and an external declaration cannot sit next to another IdP in a single value. If the external declaration only exists so that an executor can subscribe to that IdP, remove it and name the IdP in the idp option of the trigger"
      : "";
    return {
      reason: `the array declares ${elements.length} IdPs, but v3 accepts a single IdP per config${external}`,
      node: entry,
    };
  }

  const [only] = elements as [SgNode];
  const text = reindent(
    only.text(),
    ownLineIndent(source, only) ?? "",
    ownLineIndent(source, entry) ?? "",
  );
  return {
    edits: [
      { startPos: array.range().start.index, endPos: array.range().end.index, insertedText: text },
    ],
  };
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
 * Write the single IdP of a one-element `idp` array of `defineConfig()` as the
 * `idp` value itself, and drop an empty array.
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
 * Report `defineConfig()` calls whose `idp` array this transform cannot safely
 * turn into a single IdP.
 * @param source - File contents
 * @param filePath - Path to the file being reviewed
 * @param relativePath - Repository-relative path reported to the user
 * @returns Findings for configs needing a manual change
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
            message: `Write a single IdP in idp by hand: ${result.reason}.`,
            excerpt: excerptOf(result.node),
          },
        ]
      : [],
  );
}
