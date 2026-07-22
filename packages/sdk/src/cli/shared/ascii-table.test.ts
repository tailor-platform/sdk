import { eastAsianWidth } from "get-east-asian-width";
import { describe, test, expect } from "vitest";
import { renderTable } from "./ascii-table";

function expectedTable(...lines: string[]): string {
  return [...lines, ""].join("\n");
}

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

// Not used to build expected strings (those must stay literal so a reader can
// eyeball them). Only used to check the "every line is the same visual
// width" invariant for content that can't be eyeballed at all -- e.g. a ZWJ
// emoji sequence, which renders differently across terminals/fonts.
function visualWidth(line: string): number {
  let width = 0;
  for (const { segment } of graphemeSegmenter.segment(line)) {
    const codePoint = segment.codePointAt(0);
    width += codePoint === undefined ? 0 : eastAsianWidth(codePoint);
  }
  return width;
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

  test("pads each line of a multi-line cell to the widest line in that column", () => {
    const result = renderTable([["key", "short\na-much-longer-line\nmid"]]);
    expect(result).toBe(
      expectedTable(
        "┌─────┬────────────────────┐",
        "│ key │ short              │",
        "│     │ a-much-longer-line │",
        "│     │ mid                │",
        "└─────┴────────────────────┘",
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
    // man + ZWJ + woman + ZWJ + girl: a single grapheme cluster that must be
    // measured as one wide (2-column) glyph, not as five separately-measured
    // code points (which would overcount it as roughly 7 columns wide).
    const family = String.fromCodePoint(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467);
    const familyDisplayWidth = 2;

    // "日本語" is 3 full-width characters => display width 6. That's wider
    // than the emoji line, so it drives the column width; verifies newlines
    // are split before grapheme segmentation runs, so each line is measured
    // independently rather than merging across the "\n" boundary.
    const columnWidth = 6;
    const familyLinePadding = " ".repeat(columnWidth - familyDisplayWidth);

    const result = renderTable([["key", `日本語\n${family}`]]);
    expect(result).toBe(
      expectedTable(
        "┌─────┬────────┐",
        "│ key │ 日本語 │",
        `│     │ ${family}${familyLinePadding} │`,
        "└─────┴────────┘",
      ),
    );
  });

  test("keeps every rendered line the same visual width even with a ZWJ emoji sequence", () => {
    // Exact string comparison isn't meaningfully eyeballable here: a ZWJ
    // emoji sequence renders differently across terminals/fonts (one
    // combined glyph vs. several separate ones), so instead we check the
    // property a reader can actually verify by reading this test: every
    // line the renderer produces has the same computed visual width.
    const family = String.fromCodePoint(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467);
    const result = renderTable([
      ["family", family],
      ["longer-label-row", "x"],
    ]);
    const lines = result.split("\n").filter((line) => line.includes("│"));
    const widths = new Set(lines.map(visualWidth));
    expect(widths.size).toBe(1);
  });

  test("handles a single-column table", () => {
    const result = renderTable([["a"], ["bb"], ["ccc"]]);
    expect(result).toBe(
      expectedTable("┌─────┐", "│ a   │", "├─────┤", "│ bb  │", "├─────┤", "│ ccc │", "└─────┘"),
    );
  });
});
