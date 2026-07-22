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

const ESCAPE_CODE_POINT = 0x1b;

function isStrippableControlCharacter(char: string): boolean {
  const codePoint = char.codePointAt(0) ?? 0;
  if (char === "\n" || codePoint === ESCAPE_CODE_POINT) {
    return false;
  }
  return codePoint <= 0x1f || codePoint === 0x7f;
}

function stripControlCharacters(value: string): string {
  const chars: string[] = [];
  for (const char of value) {
    if (!isStrippableControlCharacter(char)) {
      chars.push(char);
    }
  }
  return chars.join("");
}

function sanitizeCell(cell: unknown): string {
  return stripControlCharacters(String(cell ?? "").replace(CARRIAGE_RETURN_PATTERN, "\n"));
}

function displayWidth(value: string): number {
  let width = 0;
  for (const { segment } of graphemeSegmenter.segment(value.replace(ANSI_ESCAPE_PATTERN, ""))) {
    const codePoint = segment.codePointAt(0);
    width += codePoint === undefined ? 0 : eastAsianWidth(codePoint);
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
 * so combining marks and ZWJ emoji sequences aren't overcounted) and strip ANSI codes
 * before measuring. Use this instead of importing a table-rendering package directly.
 * @param data - Table rows; every row must have the same number of columns. Each cell is
 * stringified, may contain embedded newlines, has `\r`/`\r\n` normalized to `\n`, and has
 * other control characters stripped.
 * @param config - Rendering options
 * @returns The rendered table terminated with a trailing newline, or `""` for empty input
 */
export function renderTable(data: unknown[][], config: AsciiTableConfig = {}): string {
  const rows = data.map((row) => row.map(sanitizeCell));
  validateConsistentColumnCount(rows);

  const rowCount = rows.length;
  if (rowCount === 0) {
    return "";
  }
  const columnCount = rows[0]?.length ?? 0;

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
