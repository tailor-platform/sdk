import { describe, test, expect, vi, beforeEach } from "vitest";
import { CIPromptError } from "./logger";

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
      const { logger: ciLogger, CIPromptError: CIError } =
        await import("./logger");

      expect(() => ciLogger.prompt("test", { type: "confirm" })).toThrow(
        CIError,
      );
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
});
