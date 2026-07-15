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
        /Use --yes to skip confirmation prompts/,
      );
    });

    test("text throws CIPromptError when isCI is true", async () => {
      vi.doMock("std-env", () => ({ isCI: true }));

      const { prompt } = await import("./prompt");
      const { CIPromptError } = await import("./logger");

      await expect(prompt.text({ message: "test" })).rejects.toThrow(CIPromptError);
    });
  });

  describe("interactive detection", () => {
    beforeEach(() => {
      vi.resetModules();
      vi.doMock("std-env", () => ({ isCI: false }));
    });

    test("requires both input and output TTYs", async () => {
      const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
      const stdoutDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
      Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
      Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: false });

      try {
        const { canPrompt } = await import("./prompt");
        expect(canPrompt()).toBe(false);
        Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
        expect(canPrompt()).toBe(true);
      } finally {
        if (stdinDescriptor) Object.defineProperty(process.stdin, "isTTY", stdinDescriptor);
        if (stdoutDescriptor) Object.defineProperty(process.stdout, "isTTY", stdoutDescriptor);
      }
    });

    test("disables prompts for JSON output", async () => {
      const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
      const stdoutDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
      Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
      Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });

      try {
        const [{ canPrompt }, { logger }] = await Promise.all([
          import("./prompt"),
          import("./logger"),
        ]);
        logger.jsonMode = true;
        expect(canPrompt()).toBe(false);
        logger.jsonMode = false;
      } finally {
        if (stdinDescriptor) Object.defineProperty(process.stdin, "isTTY", stdinDescriptor);
        if (stdoutDescriptor) Object.defineProperty(process.stdout, "isTTY", stdoutDescriptor);
      }
    });
  });
});
