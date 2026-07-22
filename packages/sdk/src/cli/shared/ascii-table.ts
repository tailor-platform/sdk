import { eastAsianWidth } from "get-east-asian-width";

// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_PATTERN = /\x1b\[[0-9;]*m/g;
const CARRIAGE_RETURN_PATTERN = /\r\n?/g;

export interface AsciiTableConfig {
  /** Suppress horizontal lines between rows, keeping only the outer border. */
  singleLine?: boolean;
  /** Decide whether to draw the horizontal line at `lineIndex` (range `[0, rowCount]` inclusive). */
  drawHorizontalLine?: (lineIndex: number, rowCount: number) => boolean;
}

function displayWidth(value: string): number {
  let width = 0;
  for (const char of value.replace(ANSI_ESCAPE_PATTERN, "")) {
    const codePoint = char.codePointAt(0);
    width += codePoint === undefined ? 0 : eastAsianWidth(codePoint);
  }
  return width;
}

function padCell(value: string, width: number): string {
  return value + " ".repeat(Math.max(0, width - displayWidth(value)));
}

function renderBorder(left: string, join: string, right: string, columnWidths: number[]): string {
  return left + columnWidths.map((width) => "─".repeat(width + 2)).join(join) + right;
}

/**
 * Renders a 2D array of values as an ASCII table with single-line box-drawing borders.
 * Column widths account for East Asian wide characters and strip ANSI codes before measuring.
 * Use this instead of importing a table-rendering package directly.
 * @param data - Table rows; each cell is stringified, may contain embedded newlines, and has `\r`/`\r\n` normalized to `\n`
 * @param config - Rendering options
 * @returns The rendered table, terminated with a trailing newline
 */
export function renderTable(data: unknown[][], config: AsciiTableConfig = {}): string {
  const rows = data.map((row) =>
    row.map((cell) => String(cell ?? "").replace(CARRIAGE_RETURN_PATTERN, "\n")),
  );
  const rowCount = rows.length;
  const columnCount = Math.max(0, ...rows.map((row) => row.length));
  const columnWidths = Array.from({ length: columnCount }, (_, col) =>
    Math.max(
      0,
      ...rows.map((row) => Math.max(0, ...(row[col] ?? "").split("\n").map(displayWidth))),
    ),
  );

  const shouldDrawLine = (lineIndex: number): boolean =>
    config.singleLine
      ? lineIndex === 0 || lineIndex === rowCount
      : (config.drawHorizontalLine ?? (() => true))(lineIndex, rowCount);

  const lines: string[] = [];
  if (shouldDrawLine(0)) {
    lines.push(renderBorder("┌", "┬", "┐", columnWidths));
  }

  rows.forEach((row, rowIndex) => {
    const cellLines = Array.from({ length: columnCount }, (_, col) => (row[col] ?? "").split("\n"));
    const rowHeight = Math.max(1, ...cellLines.map((cell) => cell.length));
    for (let line = 0; line < rowHeight; line++) {
      const cells = cellLines.map((cell, col) => padCell(cell[line] ?? "", columnWidths[col] ?? 0));
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
