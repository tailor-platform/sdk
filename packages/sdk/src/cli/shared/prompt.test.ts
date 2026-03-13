import { describe, test, expect, vi, beforeEach } from "vitest";

describe("prompt", () => {
  describe("CI environment", () => {
    beforeEach(() => {
      vi.resetModules();
    });

    test("confirm throws CIPromptError when isCI is true", async () => {
      vi.doMock("std-env", () => ({ isCI: true }));

      const { confirm } = await import("./prompt");
      const { CIPromptError } = await import("./logger");

      await expect(confirm({ message: "test" })).rejects.toThrow(CIPromptError);
      await expect(confirm({ message: "test" })).rejects.toThrow(
        /Interactive prompts are not available in CI environments/,
      );
    });

    test("text throws CIPromptError when isCI is true", async () => {
      vi.doMock("std-env", () => ({ isCI: true }));

      const { text } = await import("./prompt");
      const { CIPromptError } = await import("./logger");

      await expect(text({ message: "test" })).rejects.toThrow(CIPromptError);
    });
  });
});
