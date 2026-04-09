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
    test("formats default mode without indent", () => {
      const result = formatLogLine({
        mode: "default",
        indent: 0,
        type: "info",
        message: "test message",
      });
      expect(result).toMatch(/^ℹ test message\n$/);
    });

    test("formats default mode with 2-space indent", () => {
      const result = formatLogLine({
        mode: "default",
        indent: 2,
        type: "info",
        message: "test message",
      });
      expect(result).toMatch(/^ {2}ℹ test message\n$/);
    });

    test("formats default mode with 4-space indent", () => {
      const result = formatLogLine({
        mode: "default",
        indent: 4,
        type: "info",
        message: "test message",
      });
      expect(result).toMatch(/^ {4}ℹ test message\n$/);
    });

    test("formats success messages with indent", () => {
      const result = formatLogLine({
        mode: "default",
        indent: 2,
        type: "success",
        message: "success message",
      });
      expect(result).toMatch(/^ {2}✔ success message\n$/);
    });

    test("formats warn messages with indent", () => {
      const result = formatLogLine({
        mode: "default",
        indent: 2,
        type: "warn",
        message: "warn message",
      });
      expect(result).toMatch(/^ {2}⚠ warn message\n$/);
    });

    test("formats error messages with indent", () => {
      const result = formatLogLine({
        mode: "default",
        indent: 2,
        type: "error",
        message: "error message",
      });
      expect(result).toMatch(/^ {2}✖ error message\n$/);
    });

    test("formats plain mode with indent (no icon)", () => {
      const result = formatLogLine({
        mode: "plain",
        indent: 2,
        type: "info",
        message: "plain message",
      });
      expect(result).toMatch(/^ {2}plain message\n$/);
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

    test("treats indent 0 as no indent", () => {
      const result = formatLogLine({
        mode: "default",
        indent: 0,
        type: "info",
        message: "test message",
      });
      expect(result).toMatch(/^ℹ test message\n$/);
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
