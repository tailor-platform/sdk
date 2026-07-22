import { eastAsianWidth } from "get-east-asian-width";
import { describe, test, expect } from "vitest";
import { renderTable } from "./ascii-table";

// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_PATTERN = /\x1b\[[0-9;]*m/g;

function visualWidth(line: string): number {
  let width = 0;
  for (const char of line.replace(ANSI_ESCAPE_PATTERN, "")) {
    width += eastAsianWidth(char.codePointAt(0) ?? 0);
  }
  return width;
}

describe("renderTable", () => {
  test("renders a simple table with single-line borders", () => {
    const result = renderTable([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(result).toContain("┌");
    expect(result).toContain("└");
    expect(result).toContain("│");
    expect(result).toContain("a");
    expect(result).toContain("d");
  });

  test("aligns columns containing full-width characters", () => {
    const result = renderTable([
      ["名前", "value"],
      ["a", "日本語のテスト"],
    ]);
    const lines = result.split("\n").filter((line) => line.includes("│"));
    const widths = new Set(lines.map(visualWidth));
    expect(widths.size).toBe(1);
  });

  test("ignores ANSI escape codes when measuring column width", () => {
    const bold = (text: string): string => `\x1b[1m${text}\x1b[22m`;
    const result = renderTable([
      ["short", bold("x")],
      ["longer-value", "y"],
    ]);
    const lines = result.split("\n").filter((line) => line.includes("│"));
    const widths = new Set(lines.map(visualWidth));
    expect(widths.size).toBe(1);
  });

  test("expands row height for embedded newlines", () => {
    const result = renderTable([["key", "line1\nline2"]]);
    expect(result).toContain("line1");
    expect(result).toContain("line2");
  });

  test("normalizes Windows-style and lone carriage returns to newlines", () => {
    const crlf = renderTable([["key", "line1\r\nline2"]]);
    const lines = crlf.split("\n").filter((line) => line.includes("│"));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("line1");
    expect(lines[1]).toContain("line2");
    expect(crlf).not.toContain("\r");

    const lonelyCr = renderTable([["key", "line1\rline2"]]);
    expect(lonelyCr).not.toContain("\r");
    expect(lonelyCr.split("\n").filter((line) => line.includes("│"))).toHaveLength(2);
  });

  test("singleLine suppresses inner horizontal lines", () => {
    const result = renderTable(
      [
        ["a", "b"],
        ["c", "d"],
      ],
      { singleLine: true },
    );
    const lines = result.trim().split("\n");
    expect(lines[0]).toContain("┌");
    expect(lines[lines.length - 1]).toContain("└");
    expect(result).not.toContain("├");
  });

  test("drawHorizontalLine controls which separators are drawn", () => {
    const result = renderTable(
      [
        ["h1", "h2"],
        ["a", "b"],
        ["c", "d"],
      ],
      {
        drawHorizontalLine: (lineIndex, rowCount) =>
          lineIndex === 0 || lineIndex === 1 || lineIndex === rowCount,
      },
    );
    expect(result.match(/├/g)?.length).toBe(1);
  });

  test("drawHorizontalLine gates the outer border too, not just inner separators", () => {
    const result = renderTable(
      [
        ["a", "b"],
        ["c", "d"],
      ],
      { drawHorizontalLine: (lineIndex, rowCount) => lineIndex > 0 && lineIndex < rowCount },
    );
    expect(result).not.toContain("┌");
    expect(result).not.toContain("└");
    expect(result).not.toContain("┐");
    expect(result).not.toContain("┘");
  });

  test("draws every horizontal line by default", () => {
    const result = renderTable([
      ["a", "b"],
      ["c", "d"],
      ["e", "f"],
    ]);
    expect(result.match(/├/g)?.length).toBe(2);
  });

  test("produces the exact expected layout for a simple ASCII table", () => {
    const result = renderTable([
      ["a", "bb"],
      ["ccc", "d"],
    ]);
    expect(result).toBe(
      ["┌─────┬────┐", "│ a   │ bb │", "├─────┼────┤", "│ ccc │ d  │", "└─────┴────┘", ""].join(
        "\n",
      ),
    );
  });

  test("pads shorter cells when row heights differ within a row", () => {
    const result = renderTable([["one\ntwo\nthree", "x"]]);
    const lines = result.split("\n").filter((line) => line.includes("│"));
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("one");
    expect(lines[1]).toContain("two");
    expect(lines[2]).toContain("three");
    // shorter cell's blank lines are padded, not left ragged
    expect(lines[1]).toMatch(/│ x?\s+│$/);
  });

  test("handles an empty line within a multi-line cell", () => {
    const result = renderTable([["a\n\nb", "x"]]);
    const lines = result.split("\n").filter((line) => line.includes("│"));
    expect(lines).toHaveLength(3);
    expect(lines[1]).toMatch(/^│\s+│\s+│$/);
  });

  test("coerces non-string cell values", () => {
    const result = renderTable([
      ["number", "boolean", "null", "undefined"],
      [42, false, null, undefined],
    ]);
    expect(result).toContain("42");
    expect(result).toContain("false");
    const lines = result.split("\n").filter((line) => line.includes("│"));
    // null and undefined render as blank (padded) cells, not the strings "null"/"undefined"
    expect(lines[1]).toMatch(/│\s+│\s+│$/);
  });

  test("computes independent widths per column across multiple rows", () => {
    const result = renderTable([
      ["short", "this-is-a-much-longer-value"],
      ["this-is-a-much-longer-value", "short"],
    ]);
    const lines = result.split("\n").filter((line) => line.includes("│"));
    const widths = new Set(lines.map(visualWidth));
    expect(widths.size).toBe(1);
  });

  test("combines ANSI styling and full-width characters in the same cell", () => {
    const highlight = (text: string): string => `\x1b[33m${text}\x1b[39m`;
    const result = renderTable([
      ["status", highlight("有効")],
      ["longer-status-label", "no"],
    ]);
    const lines = result.split("\n").filter((line) => line.includes("│"));
    const widths = new Set(lines.map(visualWidth));
    expect(widths.size).toBe(1);
    expect(result).toContain("\x1b[33m有効\x1b[39m");
  });

  test("does not throw on an empty data array", () => {
    expect(() => renderTable([])).not.toThrow();
  });

  test("handles a single-column table", () => {
    const result = renderTable([["a"], ["bb"], ["ccc"]]);
    expect(result).toContain("┌");
    expect(result).toContain("└");
    expect(result).not.toContain("┬");
    expect(result).not.toContain("┴");
  });
});
