import { describe, test, expect } from "vitest";
import { renderTable } from "./ascii-table";

function expectedTable(...lines: string[]): string {
  return [...lines, ""].join("\n");
}

describe("renderTable", () => {
  test("renders a simple table with single-line borders", () => {
    const result = renderTable([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(result).toBe(
      expectedTable("┌───┬───┐", "│ a │ b │", "├───┼───┤", "│ c │ d │", "└───┴───┘"),
    );
  });

  test("aligns columns containing full-width characters", () => {
    const result = renderTable([
      ["名前", "value"],
      ["a", "日本語のテスト"],
    ]);
    expect(result).toBe(
      expectedTable(
        "┌──────┬────────────────┐",
        "│ 名前 │ value          │",
        "├──────┼────────────────┤",
        "│ a    │ 日本語のテスト │",
        "└──────┴────────────────┘",
      ),
    );
  });

  test("ignores ANSI escape codes when measuring column width", () => {
    const bold = (text: string): string => `\x1b[1m${text}\x1b[22m`;
    const result = renderTable([
      ["short", bold("x")],
      ["longer-value", "y"],
    ]);
    expect(result).toBe(
      expectedTable(
        "┌──────────────┬───┐",
        `│ short        │ ${bold("x")} │`,
        "├──────────────┼───┤",
        "│ longer-value │ y │",
        "└──────────────┴───┘",
      ),
    );
  });

  test("expands row height for embedded newlines", () => {
    const result = renderTable([["key", "line1\nline2"]]);
    expect(result).toBe(
      expectedTable("┌─────┬───────┐", "│ key │ line1 │", "│     │ line2 │", "└─────┴───────┘"),
    );
  });

  test("normalizes Windows-style and lone carriage returns to newlines", () => {
    const expected = expectedTable(
      "┌─────┬───────┐",
      "│ key │ line1 │",
      "│     │ line2 │",
      "└─────┴───────┘",
    );
    expect(renderTable([["key", "line1\r\nline2"]])).toBe(expected);
    expect(renderTable([["key", "line1\rline2"]])).toBe(expected);
  });

  test("singleLine suppresses inner horizontal lines", () => {
    const result = renderTable(
      [
        ["a", "b"],
        ["c", "d"],
      ],
      { singleLine: true },
    );
    expect(result).toBe(expectedTable("┌───┬───┐", "│ a │ b │", "│ c │ d │", "└───┴───┘"));
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
    expect(result).toBe(
      expectedTable(
        "┌────┬────┐",
        "│ h1 │ h2 │",
        "├────┼────┤",
        "│ a  │ b  │",
        "│ c  │ d  │",
        "└────┴────┘",
      ),
    );
  });

  test("drawHorizontalLine gates the outer border too, not just inner separators", () => {
    const result = renderTable(
      [
        ["a", "b"],
        ["c", "d"],
      ],
      { drawHorizontalLine: (lineIndex, rowCount) => lineIndex > 0 && lineIndex < rowCount },
    );
    expect(result).toBe(expectedTable("│ a │ b │", "├───┼───┤", "│ c │ d │"));
  });

  test("draws every horizontal line by default", () => {
    const result = renderTable([
      ["a", "b"],
      ["c", "d"],
      ["e", "f"],
    ]);
    expect(result).toBe(
      expectedTable(
        "┌───┬───┐",
        "│ a │ b │",
        "├───┼───┤",
        "│ c │ d │",
        "├───┼───┤",
        "│ e │ f │",
        "└───┴───┘",
      ),
    );
  });

  test("produces the exact expected layout for a simple ASCII table", () => {
    const result = renderTable([
      ["a", "bb"],
      ["ccc", "d"],
    ]);
    expect(result).toBe(
      expectedTable("┌─────┬────┐", "│ a   │ bb │", "├─────┼────┤", "│ ccc │ d  │", "└─────┴────┘"),
    );
  });

  test("pads shorter cells when row heights differ within a row", () => {
    const result = renderTable([["one\ntwo\nthree", "x"]]);
    expect(result).toBe(
      expectedTable(
        "┌───────┬───┐",
        "│ one   │ x │",
        "│ two   │   │",
        "│ three │   │",
        "└───────┴───┘",
      ),
    );
  });

  test("handles an empty line within a multi-line cell", () => {
    const result = renderTable([["a\n\nb", "x"]]);
    expect(result).toBe(
      expectedTable("┌───┬───┐", "│ a │ x │", "│   │   │", "│ b │   │", "└───┴───┘"),
    );
  });

  test("coerces non-string cell values", () => {
    const result = renderTable([
      ["number", "boolean", "null", "undefined"],
      [42, false, null, undefined],
    ]);
    expect(result).toBe(
      expectedTable(
        "┌────────┬─────────┬──────┬───────────┐",
        "│ number │ boolean │ null │ undefined │",
        "├────────┼─────────┼──────┼───────────┤",
        "│ 42     │ false   │      │           │",
        "└────────┴─────────┴──────┴───────────┘",
      ),
    );
  });

  test("computes independent widths per column across multiple rows", () => {
    const result = renderTable([
      ["short", "this-is-a-much-longer-value"],
      ["this-is-a-much-longer-value", "short"],
    ]);
    expect(result).toBe(
      expectedTable(
        "┌─────────────────────────────┬─────────────────────────────┐",
        "│ short                       │ this-is-a-much-longer-value │",
        "├─────────────────────────────┼─────────────────────────────┤",
        "│ this-is-a-much-longer-value │ short                       │",
        "└─────────────────────────────┴─────────────────────────────┘",
      ),
    );
  });

  test("combines ANSI styling and full-width characters in the same cell", () => {
    const highlight = (text: string): string => `\x1b[33m${text}\x1b[39m`;
    const result = renderTable([
      ["status", highlight("有効")],
      ["longer-status-label", "no"],
    ]);
    expect(result).toBe(
      expectedTable(
        "┌─────────────────────┬──────┐",
        `│ status              │ ${highlight("有効")} │`,
        "├─────────────────────┼──────┤",
        "│ longer-status-label │ no   │",
        "└─────────────────────┴──────┘",
      ),
    );
  });

  test("returns an empty string for an empty data array", () => {
    expect(renderTable([])).toBe("");
  });

  test("throws when rows have an inconsistent number of columns", () => {
    expect(() =>
      renderTable([
        ["a", "b", "c"],
        ["d", "e"],
      ]),
    ).toThrow(/same number of columns/);
  });

  test("expands tabs to 8 spaces", () => {
    const red = (text: string): string => `\x1b[31m${text}\x1b[39m`;
    const result = renderTable([["a\tb", red("red")]]);
    expect(result).toBe(
      expectedTable(
        "┌────────────┬─────┐",
        `│ a        b │ ${red("red")} │`,
        "└────────────┴─────┘",
      ),
    );
  });

  test("strips other stray control characters but preserves ANSI escapes", () => {
    const result = renderTable([["a\bb", "x"]]);
    expect(result).toBe(expectedTable("┌────┬───┐", "│ ab │ x │", "└────┴───┘"));
  });

  test("measures ZWJ emoji sequences and combining marks as a single grapheme cluster", () => {
    // man + ZWJ + woman + ZWJ + girl
    const family = String.fromCodePoint(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467);
    // "e" + combining acute accent (decomposed, not the precomposed "e-acute")
    const combining = `e${String.fromCodePoint(0x0301)}`;
    const result = renderTable([
      ["family", family],
      ["combining", combining],
      ["longer-label-row", "x"],
    ]);
    expect(result).toBe(
      expectedTable(
        "┌──────────────────┬────┐",
        `│ family           │ ${family} │`,
        "├──────────────────┼────┤",
        `│ combining        │ ${combining}  │`,
        "├──────────────────┼────┤",
        "│ longer-label-row │ x  │",
        "└──────────────────┴────┘",
      ),
    );
  });

  test("measures each line of a multi-line cell independently, even across a grapheme-cluster boundary", () => {
    // A cell whose first line is full-width text and whose second line is a
    // ZWJ emoji sequence: verifies newlines are split before grapheme
    // segmentation runs, so the two lines are measured independently rather
    // than merging across the "\n" boundary.
    const family = String.fromCodePoint(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467);
    const result = renderTable([["key", `日本語\n${family}`]]);
    expect(result).toBe(
      expectedTable(
        "┌─────┬────────┐",
        "│ key │ 日本語 │",
        `│     │ ${family}     │`,
        "└─────┴────────┘",
      ),
    );
  });

  test("handles a single-column table", () => {
    const result = renderTable([["a"], ["bb"], ["ccc"]]);
    expect(result).toBe(
      expectedTable("┌─────┐", "│ a   │", "├─────┤", "│ bb  │", "├─────┤", "│ ccc │", "└─────┘"),
    );
  });
});
