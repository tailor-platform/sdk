import { describe, test, expect, vi, beforeEach } from "vitest";
import { CIPromptError, parseLogTag, buildLogTag, formatLogLine } from "./logger";

describe("logger", () => {
  describe("prompt in CI environment", () => {
    beforeEach(() => {
      vi.resetModules();
    });

    test("throws CIPromptError when isCI is true", async () => {
      // Mock std-env with isCI: true before importing logger
      vi.doMock("std-env", () => ({
        isCI: true,
      }));

      // Import logger after mocking - this gets the mocked version
      const { logger: ciLogger, CIPromptError: CIError } = await import("./logger");

      expect(() => ciLogger.prompt("test", { type: "confirm" })).toThrow(CIError);
      expect(() => ciLogger.prompt("test", { type: "confirm" })).toThrow(
        /Interactive prompts are not available in CI environments/,
      );
    });

    test("CIPromptError has correct name and message", () => {
      const error = new CIPromptError();
      expect(error.name).toBe("CIPromptError");
      expect(error.message).toContain("CI environments");
      expect(error.message).toContain("--yes flag");
    });

    test("CIPromptError accepts custom message", () => {
      const customMessage = "Custom CI error message";
      const error = new CIPromptError(customMessage);
      expect(error.message).toBe(customMessage);
    });
  });

  describe("parseLogTag", () => {
    test("parses default tag with no indent", () => {
      const result = parseLogTag("default:0");
      expect(result).toEqual({ mode: "default", indent: 0 });
    });

    test("parses tag with indent", () => {
      const result = parseLogTag("default:4");
      expect(result).toEqual({ mode: "default", indent: 4 });
    });

    test("parses stream mode with indent", () => {
      const result = parseLogTag("stream:2");
      expect(result).toEqual({ mode: "stream", indent: 2 });
    });

    test("parses plain mode with indent", () => {
      const result = parseLogTag("plain:3");
      expect(result).toEqual({ mode: "plain", indent: 3 });
    });

    test("handles undefined tag", () => {
      const result = parseLogTag(undefined);
      expect(result).toEqual({ mode: "default", indent: 0 });
    });

    test("handles tag without indent part", () => {
      const result = parseLogTag("default");
      expect(result).toEqual({ mode: "default", indent: 0 });
    });

    test("handles invalid indent as 0", () => {
      const result = parseLogTag("default:abc");
      expect(result).toEqual({ mode: "default", indent: 0 });
    });
  });

  describe("buildLogTag", () => {
    test("builds default tag with no options", () => {
      const result = buildLogTag();
      expect(result).toBe("default:0");
    });

    test("builds tag with mode only", () => {
      const result = buildLogTag({ mode: "stream" });
      expect(result).toBe("stream:0");
    });

    test("builds tag with indent only", () => {
      const result = buildLogTag({ indent: 4 });
      expect(result).toBe("default:4");
    });

    test("builds tag with both mode and indent", () => {
      const result = buildLogTag({ mode: "plain", indent: 2 });
      expect(result).toBe("plain:2");
    });

    test("builds tag with empty options", () => {
      const result = buildLogTag({});
      expect(result).toBe("default:0");
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
