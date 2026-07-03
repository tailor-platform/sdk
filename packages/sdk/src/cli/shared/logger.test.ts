import { describe, test, expect } from "vitest";
import { CIPromptError, formatLogLine } from "./logger";

describe("logger", () => {
  describe("CIPromptError", () => {
    test("has correct name and message", () => {
      const error = new CIPromptError();
      expect(error.name).toBe("CIPromptError");
      expect(error.message).toContain("CI environments");
      expect(error.message).toContain("--yes flag");
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
});
