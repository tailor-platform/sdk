import { describe, test, expect, vi, aroundEach } from "vitest";

describe("prompt", () => {
  describe("CI environment", () => {
    aroundEach(async (runTest) => {
      vi.resetModules();
      await runTest();
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

    test("does not suggest a JSON remedy in CI", async () => {
      vi.doMock("std-env", () => ({ isCI: true }));

      const { prompt } = await import("./prompt");
      const { logger } = await import("./logger");
      logger.setJsonMode(true, "flag");
      const error = await prompt.confirm({ message: "proceed?" }).catch((e: unknown) => e);
      logger.jsonMode = false;
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain("--json");
      expect(message).not.toContain("TAILOR_JSON_OUTPUT");
    });
  });

  describe("interactive detection", () => {
    aroundEach(async (runTest) => {
      vi.resetModules();
      vi.doMock("std-env", () => ({ isCI: false }));
      await runTest();
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

    test.each([
      {
        label: "tells the user to drop the flag when it selected JSON",
        source: "flag" as const,
        expected: ["--json"],
        unexpected: ["TAILOR_JSON_OUTPUT"],
      },
      {
        label: "names TAILOR_JSON_OUTPUT when the environment selected JSON",
        source: "env" as const,
        expected: ["TAILOR_JSON_OUTPUT"],
        unexpected: ["--json"],
      },
      {
        label: "names both sources when both selected JSON",
        source: "both" as const,
        expected: ["--json", "TAILOR_JSON_OUTPUT"],
        unexpected: [],
      },
    ])("$label", async ({ source, expected, unexpected }) => {
      const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
      const stdoutDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
      Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
      Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });

      try {
        const [{ prompt }, { logger }] = await Promise.all([
          import("./prompt"),
          import("./logger"),
        ]);
        logger.setJsonMode(true, source);
        const error = await prompt.confirm({ message: "proceed?" }).catch((e: unknown) => e);
        logger.jsonMode = false;
        const message = error instanceof Error ? error.message : String(error);
        for (const text of expected) expect(message).toContain(text);
        for (const text of unexpected) expect(message).not.toContain(text);
      } finally {
        if (stdinDescriptor) Object.defineProperty(process.stdin, "isTTY", stdinDescriptor);
        if (stdoutDescriptor) Object.defineProperty(process.stdout, "isTTY", stdoutDescriptor);
      }
    });

    test("does not suggest a JSON remedy without a TTY", async () => {
      const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
      const stdoutDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
      Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: false });
      Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });

      try {
        const [{ prompt }, { logger }] = await Promise.all([
          import("./prompt"),
          import("./logger"),
        ]);
        logger.setJsonMode(true, "flag");
        const error = await prompt.confirm({ message: "proceed?" }).catch((e: unknown) => e);
        logger.jsonMode = false;
        const message = error instanceof Error ? error.message : String(error);
        expect(message).not.toContain("--json");
        expect(message).not.toContain("TAILOR_JSON_OUTPUT");
      } finally {
        if (stdinDescriptor) Object.defineProperty(process.stdin, "isTTY", stdinDescriptor);
        if (stdoutDescriptor) Object.defineProperty(process.stdout, "isTTY", stdoutDescriptor);
      }
    });

    test("stays silent about the source when nothing recorded it", async () => {
      const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
      const stdoutDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
      Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
      Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
      vi.stubEnv("TAILOR_JSON_OUTPUT", "true");

      try {
        const [{ prompt }, { logger }] = await Promise.all([
          import("./prompt"),
          import("./logger"),
        ]);
        // Callers that set the mode without a source (e.g. test helpers) get no
        // remedy rather than one guessed from the environment.
        logger.jsonMode = true;
        const error = await prompt.confirm({ message: "proceed?" }).catch((e: unknown) => e);
        logger.jsonMode = false;
        const message = error instanceof Error ? error.message : String(error);
        expect(message).not.toContain("TAILOR_JSON_OUTPUT");
        expect(message).not.toContain("--json");
      } finally {
        vi.unstubAllEnvs();
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
