import { describe, expect, it } from "vitest";
import { findEscapingLinks, stripCode } from "./check-docs-paths.js";

// Fake roots for testing — no real filesystem access needed since
// findEscapingLinks only does path arithmetic, not file I/O.
const DOCS = "/repo/packages/sdk/docs";
const REPO = "/repo";

/** Shorthand: run findEscapingLinks for a file inside docs/services/. */
function check(content, filename = "test.md", subdir = "services") {
  return findEscapingLinks(`${DOCS}/${subdir}/${filename}`, content, DOCS, REPO);
}

// ---------------------------------------------------------------------------
// stripCode
// ---------------------------------------------------------------------------

describe("stripCode", () => {
  it("blanks fenced code blocks", () => {
    const input = "before\n```\n[link](../../escape.ts)\n```\nafter";
    const result = stripCode(input);
    expect(result).not.toContain("[link]");
    expect(result).toContain("before");
    expect(result).toContain("after");
  });

  it("blanks inline code", () => {
    const input = "see `[link](../../escape.ts)` here";
    const result = stripCode(input);
    expect(result).not.toContain("[link]");
    expect(result).toContain("see");
    expect(result).toContain("here");
  });

  it("preserves line count", () => {
    const input = "L1\n```\nL3\nL4\n```\nL6";
    const result = stripCode(input);
    expect(result.split("\n")).toHaveLength(input.split("\n").length);
  });

  it("leaves non-code content intact", () => {
    const input = "[real link](./foo.md)";
    expect(stripCode(input)).toBe(input);
  });

  it("handles multiple code blocks", () => {
    const input = "```\na\n```\ntext\n```\nb\n```";
    const result = stripCode(input);
    expect(result).not.toContain("a");
    expect(result).not.toContain("b");
    expect(result).toContain("text");
  });
});

// ---------------------------------------------------------------------------
// findEscapingLinks — detection
// ---------------------------------------------------------------------------

describe("findEscapingLinks — escaping links", () => {
  it("detects a relative link that escapes docs/", () => {
    const errors = check("[text](../../escape.ts)");
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(1);
    expect(errors[0].url).toMatch(/\.\.\/\.\.\/escape\.ts/);
  });

  it("detects deeply escaping path", () => {
    const errors = check("[x](../../../../example/foo.ts)");
    expect(errors).toHaveLength(1);
    expect(errors[0].resolved).toBe("example/foo.ts");
  });

  it("detects image links that escape", () => {
    const errors = check("![logo](../../assets/logo.png)");
    expect(errors).toHaveLength(1);
  });

  it("detects link with anchor that still escapes after stripping anchor", () => {
    const errors = check("[text](../../file.ts#L42)");
    expect(errors).toHaveLength(1);
    // url in the error preserves the original anchor
    expect(errors[0].url).toBe("../../file.ts#L42");
  });

  it("detects multiple escaping links with correct line numbers", () => {
    const content = "[a](../../a.ts)\nok line\n[b](../../b.ts)";
    const errors = check(content);
    expect(errors).toHaveLength(2);
    expect(errors[0].line).toBe(1);
    expect(errors[1].line).toBe(3);
  });

  it("reports paths relative to repo root", () => {
    const errors = check("[x](../../escape.ts)");
    expect(errors[0].file).toBe("packages/sdk/docs/services/test.md");
    expect(errors[0].resolved).toBe("packages/sdk/escape.ts");
  });
});

// ---------------------------------------------------------------------------
// findEscapingLinks — allowed links (should NOT be detected)
// ---------------------------------------------------------------------------

describe("findEscapingLinks — allowed links", () => {
  it("allows relative link within docs/", () => {
    expect(check("[text](../cli/auth.md)")).toHaveLength(0);
  });

  it("allows same-directory link", () => {
    expect(check("[text](./resolver.md)")).toHaveLength(0);
  });

  it("allows link to docs root file", () => {
    // services/test.md → ../cli-reference.md → docs/cli-reference.md
    expect(check("[text](../cli-reference.md)")).toHaveLength(0);
  });

  it("skips external https URL", () => {
    expect(check("[text](https://example.com/foo)")).toHaveLength(0);
  });

  it("skips mailto link", () => {
    expect(check("[text](mailto:a@b.com)")).toHaveLength(0);
  });

  it("skips anchor-only link", () => {
    expect(check("[text](#section)")).toHaveLength(0);
  });

  it("skips site-absolute path", () => {
    expect(check("[text](/some/page)")).toHaveLength(0);
  });

  it("skips link inside fenced code block", () => {
    expect(check("```\n[text](../../escape.ts)\n```")).toHaveLength(0);
  });

  it("skips link inside inline code", () => {
    expect(check("see `[text](../../escape.ts)` here")).toHaveLength(0);
  });

  it("detects link between inline code spans", () => {
    // The link itself is NOT inside code — it's between two code spans
    expect(check("`a` [escape](../../x.ts) `b`")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// findEscapingLinks — link syntax variants
// ---------------------------------------------------------------------------

describe("findEscapingLinks — link syntax", () => {
  it("handles link with title", () => {
    expect(check('[text](../../escape.ts "a title")')).toHaveLength(1);
  });

  it("handles link from a subdirectory deeper than services/", () => {
    const errors = findEscapingLinks(`${DOCS}/a/b/test.md`, "[x](../../../../x.ts)", DOCS, REPO);
    expect(errors).toHaveLength(1);
  });

  it("handles link from docs root", () => {
    const errors = findEscapingLinks(`${DOCS}/test.md`, "[x](../escape.ts)", DOCS, REPO);
    expect(errors).toHaveLength(1);
  });
});
