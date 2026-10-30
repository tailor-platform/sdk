import { highlightGraphqlLines as renderGraphqlLines } from "@enlumine/graphql/editor";
import graphqlStyles from "@enlumine/graphql/themes/ansi";
import { highlightSqlLines as renderSqlLines } from "@enlumine/sql/editor";
import sqlStyles from "@enlumine/sql/themes/ansi";
import { assertDefined } from "#/utils/assert";
import type { TransformEvent, TransformState } from "@toiroakr/read-multiline";

/**
 * Highlight SQL lines, tracking block comments that span lines.
 * @param lines - SQL text split into editor lines
 * @returns ANSI-decorated lines, one per input line
 */
export function highlightSqlLines(lines: readonly string[]): string[] {
  return renderSqlLines(lines, sqlStyles);
}

/**
 * Highlight GraphQL lines, tracking block strings that span lines.
 * @param lines - GraphQL text split into editor lines
 * @returns ANSI-decorated lines, one per input line
 */
export function highlightGraphqlLines(lines: readonly string[]): string[] {
  return renderGraphqlLines(lines, graphqlStyles);
}

const BRACKET_PAIRS: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
const CLOSE_BRACKETS = new Set(Object.values(BRACKET_PAIRS));

/**
 * Apply auto-close brackets and auto-indent on newline. Works for both SQL
 * and GraphQL because both languages share the `()`, `[]`, `{}` bracket set.
 * @param state - Editor state after the last edit
 * @param event - Event describing the edit that just occurred
 * @returns A new editor state to apply, or `undefined` to leave the state unchanged
 */
export function replTransform(
  state: TransformState,
  event: TransformEvent,
): TransformState | undefined {
  const { lines, row, col } = state;

  if (event.type === "insert" && event.char in BRACKET_PAIRS) {
    const close = BRACKET_PAIRS[event.char];
    const line = assertDefined(lines[row], `line at row ${row} missing`);
    const newLine = line.slice(0, col) + close + line.slice(col);
    return { lines: lines.with(row, newLine), row, col };
  }

  if (event.type === "insert" && CLOSE_BRACKETS.has(event.char)) {
    const line = assertDefined(lines[row], `line at row ${row} missing`);
    if (line[col] === event.char) {
      const newLine = line.slice(0, col) + line.slice(col + 1);
      return { lines: lines.with(row, newLine), row, col };
    }
  }

  if (event.type === "backspace") {
    const line = assertDefined(lines[row], `line at row ${row} missing`);
    const beforeCursor = line.slice(0, col);
    if (beforeCursor.length >= 1 && /^ +$/.test(beforeCursor)) {
      const newIndent = beforeCursor.slice(0, -1);
      const newLine = newIndent + line.slice(col);
      return { lines: lines.with(row, newLine), row, col: newIndent.length };
    }
  }

  if (event.type === "newline" && row > 0) {
    const prevLine = assertDefined(lines[row - 1], `line at row ${row - 1} missing`);
    const baseIndent = prevLine.match(/^(\s*)/)?.[1] ?? "";
    const endsWithOpen = /[{([]$/.test(prevLine.trimEnd());
    const currentLine = assertDefined(lines[row], `line at row ${row} missing`);
    const startsWithClose = /^[}\])]/.test(currentLine.trimStart());

    if (endsWithOpen && startsWithClose) {
      // Bracket expansion: the cursor sits between a matching open/close
      // pair (e.g. `{|}`). Expand into a three-line block with the cursor
      // on an indented middle line.
      const innerIndent = baseIndent + "  ";
      const newLines = lines
        .with(row, innerIndent)
        .toSpliced(row + 1, 0, baseIndent + currentLine.trimStart());
      return { lines: newLines, row, col: innerIndent.length };
    }
    if (endsWithOpen) {
      // A lone open bracket on the previous line: drop an extra indent for
      // the new line and auto-insert the matching closing bracket below.
      const openChar = prevLine.trimEnd().slice(-1);
      const closeChar = BRACKET_PAIRS[openChar] ?? "}";
      const indent = baseIndent + "  ";
      const newLines = lines
        .with(row, indent + currentLine)
        .toSpliced(row + 1, 0, baseIndent + closeChar);
      return { lines: newLines, row, col: indent.length };
    }
    if (baseIndent && col === 0) {
      return {
        lines: lines.with(row, baseIndent + currentLine),
        row,
        col: baseIndent.length,
      };
    }
  }

  return undefined;
}
