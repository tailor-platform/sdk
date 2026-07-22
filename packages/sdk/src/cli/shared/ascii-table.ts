import { eastAsianWidth } from "get-east-asian-width";

// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_PATTERN = /\x1b\[[0-9;]*m/g;
const CARRIAGE_RETURN_PATTERN = /\r\n?/g;

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export interface AsciiTableConfig {
  /** Suppress horizontal lines between rows, keeping only the outer border. */
  singleLine?: boolean;
  /** Decide whether to draw the horizontal line at `lineIndex` (range `[0, rowCount]` inclusive). */
  drawHorizontalLine?: (lineIndex: number, rowCount: number) => boolean;
}

interface CellLine {
  text: string;
  width: number;
}

function maxOf(values: number[], fallback = 0): number {
  return values.reduce((max, value) => (value > max ? value : max), fallback);
}

const TAB_WIDTH = 8;

function isStrippableControlCharacter(char: string): boolean {
  const codePoint = char.codePointAt(0) ?? 0;
  if (char === "\n") {
    return false;
  }
  return codePoint <= 0x1f || codePoint === 0x7f;
}

// Only SGR (color/style) escape sequences are meant to survive; a bare ESC
// that isn't part of a recognized SGR sequence (e.g. a screen-clear CSI
// sequence, or a BEL-terminated OSC sequence) is treated like any other
// control character below and stripped, rather than passed through to the
// terminal or left with its terminator removed.
function normalizeControlCharacters(value: string): string {
  const sgrSequences = value.match(ANSI_ESCAPE_PATTERN) ?? [];
  return value
    .split(ANSI_ESCAPE_PATTERN)
    .map((segment) => {
      const chars: string[] = [];
      for (const char of segment) {
        if (char === "\t") {
          chars.push(" ".repeat(TAB_WIDTH));
        } else if (!isStrippableControlCharacter(char)) {
          chars.push(char);
        }
      }
      return chars.join("");
    })
    .reduce((result, segment, i) => result + segment + (sgrSequences[i] ?? ""), "");
}

function sanitizeCell(cell: unknown): string {
  return normalizeControlCharacters(String(cell ?? "").replace(CARRIAGE_RETURN_PATTERN, "\n"));
}

const REGIONAL_INDICATOR_MIN = 0x1f1e6;
const REGIONAL_INDICATOR_MAX = 0x1f1ff;
const VARIATION_SELECTOR_16 = 0xfe0f;
const COMBINING_ENCLOSING_KEYCAP = 0x20e3;

function isRegionalIndicator(codePoint: number): boolean {
  return codePoint >= REGIONAL_INDICATOR_MIN && codePoint <= REGIONAL_INDICATOR_MAX;
}

// Flag pairs, keycap sequences (digit/#/* + optional VS16 + enclosing keycap),
// and VS16-forced emoji presentation all render as 2 columns in terminals even
// though their first code point alone would measure as narrow/neutral.
function isWideEmojiSequence(codePoints: number[]): boolean {
  if (codePoints.length === 2 && codePoints.every(isRegionalIndicator)) {
    return true;
  }
  return (
    codePoints.includes(VARIATION_SELECTOR_16) || codePoints.includes(COMBINING_ENCLOSING_KEYCAP)
  );
}

function displayWidth(value: string): number {
  let width = 0;
  for (const { segment } of graphemeSegmenter.segment(value.replace(ANSI_ESCAPE_PATTERN, ""))) {
    const codePoints = Array.from(segment, (char) => char.codePointAt(0) ?? 0);
    const firstCodePoint = codePoints[0];
    width +=
      firstCodePoint === undefined
        ? 0
        : isWideEmojiSequence(codePoints)
          ? 2
          : eastAsianWidth(firstCodePoint);
  }
  return width;
}

function toCellLines(cell: string): CellLine[] {
  return cell.split("\n").map((text) => ({ text, width: displayWidth(text) }));
}

function padCell(cellLine: CellLine, width: number): string {
  return cellLine.text + " ".repeat(Math.max(0, width - cellLine.width));
}

function renderBorder(left: string, join: string, right: string, columnWidths: number[]): string {
  return left + columnWidths.map((width) => "─".repeat(width + 2)).join(join) + right;
}

function validateConsistentColumnCount(rows: string[][]): void {
  const columnCount = rows[0]?.length;
  if (columnCount === undefined) {
    return;
  }
  rows.forEach((row, index) => {
    if (row.length !== columnCount) {
      throw new Error(
        `renderTable: all rows must have the same number of columns (expected ${columnCount}, row ${index} has ${row.length}).`,
      );
    }
  });
}

/**
 * Renders a 2D array of values as a table using single-line Unicode box-drawing borders.
 * Column widths account for East Asian wide characters (measured per grapheme cluster,
 * so combining marks and ZWJ emoji sequences aren't overcounted, and flags, keycaps, and
 * VS16-forced emoji presentation are measured as 2 columns) and strip ANSI SGR (color/style)
 * escape codes before measuring. Use this instead of importing a table-rendering package
 * directly.
 * @param data - Table rows; every row must have the same number of columns. Each cell is
 * stringified (`null`/`undefined` become an empty string rather than the literal text
 * "null"/"undefined"), may contain embedded newlines, has `\r`/`\r\n` normalized to `\n`,
 * has tabs expanded to spaces, and has other control characters stripped.
 * @param config - Rendering options
 * @returns The rendered table terminated with a trailing newline, or `""` when there are no
 * rows or no columns to display
 */
export function renderTable(data: unknown[][], config: AsciiTableConfig = {}): string {
  const rows = data.map((row) => row.map(sanitizeCell));
  validateConsistentColumnCount(rows);

  const rowCount = rows.length;
  const columnCount = rows[0]?.length ?? 0;
  if (rowCount === 0 || columnCount === 0) {
    return "";
  }

  const rowsCellLines = rows.map((row) =>
    Array.from({ length: columnCount }, (_, col) => toCellLines(row[col] ?? "")),
  );
  const columnWidths = Array.from({ length: columnCount }, (_, col) =>
    maxOf(rowsCellLines.map((row) => maxOf((row[col] ?? []).map((line) => line.width)))),
  );

  const shouldDrawLine = (lineIndex: number): boolean =>
    config.singleLine
      ? lineIndex === 0 || lineIndex === rowCount
      : (config.drawHorizontalLine ?? (() => true))(lineIndex, rowCount);

  const lines: string[] = [];
  if (shouldDrawLine(0)) {
    lines.push(renderBorder("┌", "┬", "┐", columnWidths));
  }

  rowsCellLines.forEach((cellLines, rowIndex) => {
    const rowHeight = maxOf(
      cellLines.map((columnLines) => columnLines.length),
      1,
    );
    for (let line = 0; line < rowHeight; line++) {
      const cells = cellLines.map((columnLines, col) =>
        padCell(columnLines[line] ?? { text: "", width: 0 }, columnWidths[col] ?? 0),
      );
      lines.push(`│ ${cells.join(" │ ")} │`);
    }
    if (rowIndex < rowCount - 1 && shouldDrawLine(rowIndex + 1)) {
      lines.push(renderBorder("├", "┼", "┤", columnWidths));
    }
  });

  if (shouldDrawLine(rowCount)) {
    lines.push(renderBorder("└", "┴", "┘", columnWidths));
  }

  return `${lines.join("\n")}\n`;
}
