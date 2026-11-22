import * as path from "pathe";
import { objectEntries } from "../ast-grep-helpers";
import type { SgNode } from "@ast-grep/napi";

/** A replacement of `[start, end)` of a source text. */
export type TextEdit = { start: number; end: number; text: string };

/**
 * Apply edits to a source text.
 * @param source - The text
 * @param edits - Non-overlapping edits, by offsets into `source`
 * @param offset - Offset of `source` in the text the edits' offsets refer to
 * @returns The edited text
 */
export function applyEdits(source: string, edits: readonly TextEdit[], offset = 0): string {
  const sorted = edits.toSorted((a, b) => a.start - b.start);
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index]!.start < sorted[index - 1]!.end) {
      throw new Error("Overlapping edits");
    }
  }
  let result = "";
  let cursor = 0;
  for (const edit of sorted) {
    result += source.slice(cursor, edit.start - offset) + edit.text;
    cursor = edit.end - offset;
  }
  return result + source.slice(cursor);
}

/**
 * The text of a node with edits that fall inside it applied.
 * @param node - The node
 * @param edits - Edits by offsets into the node's file
 * @returns The edited text
 */
export function editedText(node: SgNode, edits: readonly TextEdit[]): string {
  const { start, end } = node.range();
  return applyEdits(
    node.text(),
    edits.filter((edit) => edit.start >= start.index && edit.end <= end.index),
    start.index,
  );
}

/**
 * Replace a node.
 * @param node - The node
 * @param text - Its replacement
 * @returns The edit
 */
export function replaceNode(node: SgNode, text: string): TextEdit {
  return { start: node.range().start.index, end: node.range().end.index, text };
}

function templateRanges(node: SgNode): Array<{ start: number; end: number }> {
  const offset = node.range().start.index;
  return node.findAll({ rule: { kind: "template_string" } }).map((literal) => ({
    start: literal.range().start.index - offset,
    end: literal.range().end.index - offset,
  }));
}

/**
 * Move a multi-line text from one indentation to another, leaving template literal lines as they are.
 * @param text - The text, whose first line is not indented
 * @param fromIndent - Indentation of the line the text starts on
 * @param toIndent - Indentation of the line it moves to
 * @param node - The node the text was taken from, to find its template literals
 * @returns The re-indented text
 */
export function reindent(
  text: string,
  fromIndent: string,
  toIndent: string,
  node?: SgNode,
): string {
  if (fromIndent === toIndent || !text.includes("\n")) return text;
  const literals = node ? templateRanges(node) : [];
  let offset = 0;
  return text
    .split("\n")
    .map((line, index) => {
      const lineStart = offset;
      offset += line.length + 1;
      if (
        index === 0 ||
        literals.some((literal) => literal.start < lineStart && lineStart < literal.end)
      ) {
        return line;
      }
      if (line.startsWith(fromIndent)) return toIndent + line.slice(fromIndent.length);
      return line.trim() === "" ? line : toIndent + line.trimStart();
    })
    .join("\n");
}

/**
 * The indentation of the line a node starts on.
 * @param source - The node's file
 * @param node - The node
 * @returns The leading whitespace of that line
 */
export function lineIndent(source: string, node: SgNode): string {
  const start = node.range().start.index;
  const lineStart = source.lastIndexOf("\n", start - 1) + 1;
  return /^[ \t]*/u.exec(source.slice(lineStart))![0];
}

/**
 * Add a property to an object literal.
 * @param source - The object's file
 * @param object - The object literal
 * @param property - The property, such as `machineUser: "admin"`
 * @returns The edit
 */
export function addProperty(source: string, object: SgNode, property: string): TextEdit {
  const entries = objectEntries(object);
  const close = object.children().at(-1)!;
  if (entries.length === 0) {
    return replaceNode(object, `{ ${property} }`);
  }
  const last = entries.at(-1)!;
  const multiline = object.text().includes("\n");
  const afterLast = source.slice(last.range().end.index, close.range().start.index);
  const trailingComma = afterLast.trimStart().startsWith(",");
  if (!multiline) {
    const insertAt = last.range().end.index + (trailingComma ? afterLast.indexOf(",") + 1 : 0);
    return { start: insertAt, end: insertAt, text: `${trailingComma ? "" : ","} ${property}` };
  }
  const indent = lineIndent(source, last);
  const insertAt = trailingComma
    ? last.range().end.index + afterLast.indexOf(",") + 1
    : last.range().end.index;
  return {
    start: insertAt,
    end: insertAt,
    text: `${trailingComma ? "" : ","}\n${indent}${property}${trailingComma ? "," : ""}`,
  };
}

const GLOB_CHARACTERS = /[*?[\]{}()!]/u;

/**
 * Whether files patterns written relative to `dir` can be rewritten relative to another directory.
 * @param dir - Project-relative directory
 * @returns False when the directory name holds glob syntax
 */
export function canRebaseFrom(dir: string): boolean {
  return !GLOB_CHARACTERS.test(dir);
}

/**
 * Rewrite a path or glob pattern written relative to one directory so that it names the same
 * files relative to another.
 * @param pattern - The pattern, optionally `!`-prefixed
 * @param fromDir - Project-relative directory it was relative to
 * @param toDir - Project-relative directory it becomes relative to
 * @returns The rewritten pattern
 */
export function rebasePattern(pattern: string, fromDir: string, toDir: string): string {
  const negated = pattern.startsWith("!");
  const body = negated ? pattern.slice(1) : pattern;
  if (fromDir === toDir || path.isAbsolute(body)) return pattern;
  const relative = path.relative(`/${toDir}`, path.join(`/${fromDir}`, body));
  const rebased = relative.startsWith("../") || !body.startsWith("./") ? relative : `./${relative}`;
  return `${negated ? "!" : ""}${rebased}`;
}
