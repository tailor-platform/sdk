import { describe, test, expect, vi } from "vitest";
import { CIPromptError, formatLogLine, logger } from "./logger";

function captureStdout(fn: () => void): string {
  using stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  fn();
  return stdoutSpy.mock.calls.map((call) => String(call[0])).join("");
}

describe("logger", () => {
  describe("CIPromptError", () => {
    test("has correct name and message", () => {
      const error = new CIPromptError();
      expect(error.name).toBe("CIPromptError");
      expect(error.message).toContain("not available in this environment");
      expect(error.message).toContain("required options explicitly");
    });

    test("accepts custom message", () => {
      const customMessage = "Custom CI error message";
      const error = new CIPromptError(customMessage);
      expect(error.message).toBe(customMessage);
    });
  });

  describe("formatLogLine", () => {
    const cases = [
      {
        name: "default mode without indent",
        mode: "default",
        indent: 0,
        type: "info",
        expected: /^ℹ MSG\n$/,
      },
      {
        name: "default mode with 2-space indent",
        mode: "default",
        indent: 2,
        type: "info",
        expected: /^ {2}ℹ MSG\n$/,
      },
      {
        name: "default mode with 4-space indent",
        mode: "default",
        indent: 4,
        type: "info",
        expected: /^ {4}ℹ MSG\n$/,
      },
      {
        name: "success messages with indent",
        mode: "default",
        indent: 2,
        type: "success",
        expected: /^ {2}✔ MSG\n$/,
      },
      {
        name: "warn messages with indent",
        mode: "default",
        indent: 2,
        type: "warn",
        expected: /^ {2}⚠ MSG\n$/,
      },
      {
        name: "error messages with indent",
        mode: "default",
        indent: 2,
        type: "error",
        expected: /^ {2}✖ MSG\n$/,
      },
      {
        name: "plain mode with indent (no icon)",
        mode: "plain",
        indent: 2,
        type: "info",
        expected: /^ {2}MSG\n$/,
      },
      {
        name: "indent 0 treated as no indent",
        mode: "default",
        indent: 0,
        type: "info",
        expected: /^ℹ MSG\n$/,
      },
    ] as const;

    test.each(cases)("formats $name", ({ mode, indent, type, expected }) => {
      const result = formatLogLine({ mode, indent, type, message: "MSG" });
      expect(result).toMatch(expected);
    });

    test("formats stream mode with timestamp and indent", () => {
      const result = formatLogLine({
        mode: "stream",
        indent: 2,
        type: "info",
        message: "stream message",
        timestamp: "10:30:00 ",
      });
      expect(result).toMatch(/^ {2}10:30:00 ℹ stream message\n$/);
    });

    test("handles unknown log type", () => {
      const result = formatLogLine({
        mode: "default",
        indent: 0,
        type: "unknown",
        message: "test message",
      });
      expect(result).toBe("test message\n");
    });
  });

  describe("out", () => {
    test("writes a plain string as-is, adding a trailing newline only when missing", () => {
      expect(captureStdout(() => logger.out("hello"))).toBe("hello\n");
      expect(captureStdout(() => logger.out("hello\n"))).toBe("hello\n");
    });

    test("renders an object as a key-value table with a separator between every row", () => {
      const output = captureStdout(() => logger.out({ id: "abc", status: "ok" }));
      expect(output).toContain("id");
      expect(output).toContain("abc");
      expect(output).toContain("status");
      expect(output).toContain("ok");
      expect(output.match(/├/g)?.length).toBe(1);
    });

    test("renders an array of objects as a table with a header row", () => {
      const output = captureStdout(() =>
        logger.out([
          { name: "alice", role: "admin" },
          { name: "bob", role: "member" },
        ]),
      );
      expect(output).toContain("name");
      expect(output).toContain("role");
      expect(output).toContain("alice");
      expect(output).toContain("bob");
      // only one separator: right after the header row
      expect(output.match(/├/g)?.length).toBe(1);
    });

    test("writes nothing for an empty array", () => {
      const output = captureStdout(() => logger.out([]));
      expect(output).toBe("");
    });

    test("writes nothing when every item has no displayable fields", () => {
      const emptyItems = captureStdout(() => logger.out([{}, {}]));
      expect(emptyItems).toBe("");

      const allFieldsExcluded = captureStdout(() =>
        logger.out([{ secret: "x" }], { display: { secret: null } }),
      );
      expect(allFieldsExcluded).toBe("");
    });

    test("formats null, undefined, Date, and nested object values", () => {
      const output = captureStdout(() =>
        logger.out({
          missing: null,
          absent: undefined,
          createdAt: new Date(Date.now() - 5 * 60 * 1000),
          meta: { nested: "value" },
        }),
      );
      expect(output).toContain("N/A");
      expect(output).toContain("ago");
      expect(output).toContain('"nested"');
    });

    test("showNull renders null as the literal string NULL", () => {
      const output = captureStdout(() => logger.out({ field: null }, { showNull: true }));
      expect(output).toContain("NULL");
      expect(output).not.toContain("N/A");
    });

    test("display: null excludes a field entirely", () => {
      const output = captureStdout(() =>
        logger.out({ id: "abc", secret: "hidden" }, { display: { secret: null } }),
      );
      expect(output).toContain("id");
      expect(output).not.toContain("secret");
      expect(output).not.toContain("hidden");
    });
  });
});
