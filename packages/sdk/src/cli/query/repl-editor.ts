import { GraphQLError, Lexer, Source, TokenKind } from "graphql";
import { getSegments } from "sql-highlight";
import { assertDefined } from "#src/utils/assert";
import type { TransformEvent, TransformState } from "@toiroakr/read-multiline";

// ANSI colour sequences. Kept inline (rather than going through `node:util`
// styleText) so that tests running outside a TTY still produce deterministic
// escape sequences regardless of detected colour support.
const RESET = "\x1b[0m";
const BLUE = "\x1b[34m";
const MAGENTA = "\x1b[35m";
const YELLOW = "\x1b[33m";
const BRIGHT_GREEN = "\x1b[92m";
const CYAN = "\x1b[36m";
const BRIGHT_BLUE = "\x1b[94m";
const BOLD_CYAN = "\x1b[1;36m";
const BOLD_MAGENTA = "\x1b[1;35m";
const ITALIC_YELLOW = "\x1b[3;33m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[90m";
const DIM_YELLOW = "\x1b[2;33m";

const SQL_STYLE_MAP: Record<string, string> = {
  keyword: BLUE,
  function: MAGENTA,
  identifier: YELLOW,
  string: BRIGHT_GREEN,
  number: CYAN,
  bracket: DIM_YELLOW,
  special: DIM,
};

/**
 * Highlight a single SQL line using the `sql-highlight` tokenizer.
 * @param line - SQL text for a single editor line
 * @returns ANSI-decorated line safe for terminal output
 */
export function highlightSqlLine(line: string): string {
  const segments = getSegments(line);
  let result = "";
  for (const seg of segments) {
    const style = SQL_STYLE_MAP[seg.name];
    result += style ? style + seg.content + RESET : seg.content;
  }
  return result;
}

const GQL_KEYWORDS = new Set([
  "query",
  "mutation",
  "subscription",
  "fragment",
  "on",
  "type",
  "input",
  "enum",
  "interface",
  "union",
  "scalar",
  "extend",
  "schema",
  "directive",
  "implements",
]);

// Keywords that introduce a definition name (next NAME token is the def).
const GQL_DEF_KEYWORDS = new Set(["query", "mutation", "subscription", "fragment"]);

const GQL_BUILTINS = new Set(["true", "false", "null"]);

/**
 * Highlight a single GraphQL line using the official `graphql` Lexer. Tracks
 * paren depth and the previous token to provide semantic-level colouring
 * (field names vs argument names vs types).
 * @param line - GraphQL text for a single editor line
 * @returns ANSI-decorated line, or the input unchanged when the lexer rejects it
 */
export function highlightGraphqlLine(line: string): string {
  if (line.trimStart().startsWith("#")) {
    return `${DIM}${line}${RESET}`;
  }

  try {
    const source = new Source(line);
    const lexer = new Lexer(source);
    let result = "";
    let pos = 0;

    let parenDepth = 0;
    let prevKind: string = "";
    let prevText = "";
    let afterColon = false;

    let token = lexer.advance();
    while (token.kind !== TokenKind.EOF) {
      if (token.start > pos) {
        result += line.slice(pos, token.start);
      }

      const text = line.slice(token.start, token.end);
      switch (token.kind) {
        case TokenKind.NAME: {
          if (prevKind === TokenKind.DOLLAR) {
            result += `${MAGENTA}${text}${RESET}`;
          } else if (prevKind === TokenKind.AT) {
            result += `${BOLD_MAGENTA}${text}${RESET}`;
          } else if (GQL_BUILTINS.has(text) || GQL_KEYWORDS.has(text)) {
            result += `${BLUE}${text}${RESET}`;
          } else if (GQL_DEF_KEYWORDS.has(prevText)) {
            result += `${BOLD_CYAN}${text}${RESET}`;
          } else if (afterColon) {
            result += `${CYAN}${text}${RESET}`;
          } else if (parenDepth > 0) {
            result += `${ITALIC_YELLOW}${text}${RESET}`;
          } else {
            result += `${BRIGHT_BLUE}${text}${RESET}`;
          }
          afterColon = false;
          break;
        }
        case TokenKind.INT:
        case TokenKind.FLOAT:
          result += `${BLUE}${text}${RESET}`;
          afterColon = false;
          break;
        case TokenKind.STRING:
        case TokenKind.BLOCK_STRING:
          result += `${GREEN}${text}${RESET}`;
          afterColon = false;
          break;
        case TokenKind.DOLLAR:
          result += `${MAGENTA}${text}${RESET}`;
          afterColon = false;
          break;
        case TokenKind.AT:
          result += `${BOLD_MAGENTA}${text}${RESET}`;
          afterColon = false;
          break;
        case TokenKind.BRACE_L:
        case TokenKind.BRACE_R:
          result += `${YELLOW}${text}${RESET}`;
          afterColon = false;
          break;
        case TokenKind.PAREN_L:
          parenDepth += 1;
          result += `${DIM_YELLOW}${text}${RESET}`;
          afterColon = false;
          break;
        case TokenKind.PAREN_R:
          parenDepth = Math.max(0, parenDepth - 1);
          result += `${DIM_YELLOW}${text}${RESET}`;
          afterColon = false;
          break;
        case TokenKind.BRACKET_L:
        case TokenKind.BRACKET_R:
          result += `${DIM_YELLOW}${text}${RESET}`;
          afterColon = false;
          break;
        case TokenKind.COLON:
          result += `${DIM}${text}${RESET}`;
          afterColon = true;
          break;
        case TokenKind.BANG:
        case TokenKind.EQUALS:
        case TokenKind.PIPE:
        case TokenKind.AMP:
        case TokenKind.SPREAD:
          result += `${DIM}${text}${RESET}`;
          afterColon = false;
          break;
        default:
          result += text;
          afterColon = false;
      }

      prevKind = token.kind;
      prevText = text;
      pos = token.end;
      token = lexer.advance();
    }

    if (pos < line.length) {
      result += line.slice(pos);
    }
    return result;
  } catch (error) {
    // The lexer throws GraphQLError on partial or invalid input (e.g. an
    // unterminated string while the user is still typing). Fall back to the
    // raw line so the editor keeps rendering without colour until the input
    // is valid. Any other error is a real bug and should surface.
    if (error instanceof GraphQLError) {
      return line;
    }
    throw error;
  }
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
      return { lines: lines.with(row, baseIndent + currentLine), row, col: baseIndent.length };
    }
  }

  return undefined;
}
