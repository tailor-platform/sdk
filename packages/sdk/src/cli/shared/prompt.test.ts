import { describe, test, expect, vi, beforeEach } from "vitest";

describe("prompt", () => {
  describe("CI environment", () => {
    beforeEach(() => {
      vi.resetModules();
    });

    test("confirm throws CIPromptError when isCI is true", async () => {
      vi.doMock("std-env", () => ({ isCI: true }));

      const { prompt } = await import("./prompt");
      const { CIPromptError } = await import("./logger");

      await expect(prompt.confirm({ message: "test" })).rejects.toThrow(CIPromptError);
      await expect(prompt.confirm({ message: "test" })).rejects.toThrow(
        /Interactive prompts are not available in CI environments/,
      );
    });

    test("text throws CIPromptError when isCI is true", async () => {
      vi.doMock("std-env", () => ({ isCI: true }));

      const { prompt } = await import("./prompt");
      const { CIPromptError } = await import("./logger");

      await expect(prompt.text({ message: "test" })).rejects.toThrow(CIPromptError);
    });
  });
});
