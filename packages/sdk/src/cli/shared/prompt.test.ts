import { describe, test, expect, vi, aroundEach } from "vitest";
import type * as PromptModule from "./prompt";

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

    test.each([
      {
        kind: "confirm",
        ask: (prompt: typeof PromptModule.prompt) =>
          prompt.confirm({ message: "test", suggestion: "Pass --value." }),
      },
      {
        kind: "text",
        ask: (prompt: typeof PromptModule.prompt) =>
          prompt.text({ message: "test", suggestion: "Pass --value." }),
      },
      {
        kind: "password",
        ask: (prompt: typeof PromptModule.prompt) =>
          prompt.password({ message: "test", suggestion: "Pass --value." }),
      },
      {
        kind: "select",
        ask: (prompt: typeof PromptModule.prompt) =>
          prompt.select({ message: "test", choices: [{ value: 1 }], suggestion: "Pass --value." }),
      },
    ])("$kind reports the caller's suggestion when isCI is true", async ({ ask }) => {
      vi.doMock("std-env", () => ({ isCI: true }));

      const [{ prompt }, { CIPromptError }, { getErrorDiagnostics }] = await Promise.all([
        import("./prompt"),
        import("./logger"),
        import("./error-diagnostics"),
      ]);

      const error = await ask(prompt).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(CIPromptError);
      expect(getErrorDiagnostics(error as Error).suggestion).toBe("Pass --value.");
    });

    test("does not suggest a JSON remedy in CI even with TTYs", async () => {
      vi.doMock("std-env", () => ({ isCI: true }));

      const { prompt } = await import("./prompt");
      const { logger } = await import("./logger");
      const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
      const stdoutDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
      Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
      Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
      logger.setJsonMode(true, "flag");

      try {
        const error = await prompt.confirm({ message: "proceed?" }).catch((e: unknown) => e);
        const message = error instanceof Error ? error.message : String(error);
        expect(message).not.toContain("--json");
        expect(message).not.toContain("TAILOR_JSON_OUTPUT");
      } finally {
        logger.jsonMode = false;
        if (stdinDescriptor) Object.defineProperty(process.stdin, "isTTY", stdinDescriptor);
        if (stdoutDescriptor) Object.defineProperty(process.stdout, "isTTY", stdoutDescriptor);
      }
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
        agent: undefined,
        source: "flag" as const,
        expected: ["--json"],
        unexpected: ["TAILOR_JSON_OUTPUT"],
      },
      {
        label: "names TAILOR_JSON_OUTPUT when the environment selected JSON",
        agent: undefined,
        source: "env" as const,
        expected: ["TAILOR_JSON_OUTPUT"],
        unexpected: ["--json"],
      },
      {
        label: "names both sources when both selected JSON",
        agent: undefined,
        source: "both" as const,
        expected: ["--json", "TAILOR_JSON_OUTPUT"],
        unexpected: [],
      },
      {
        label: "names the detected agent when it selected JSON",
        agent: "claude_code",
        source: "agent" as const,
        expected: ["claude_code", "--json=false", "TAILOR_JSON_OUTPUT=false"],
        unexpected: [],
      },
      {
        label: "tells the user to turn the flag off under an agent",
        agent: "claude_code",
        source: "flag" as const,
        expected: ["--json=false"],
        unexpected: ["drop", "TAILOR_JSON_OUTPUT"],
      },
      {
        label: "tells the user to set TAILOR_JSON_OUTPUT to false under an agent",
        agent: "claude_code",
        source: "env" as const,
        expected: ["TAILOR_JSON_OUTPUT", "to false"],
        unexpected: ["unset", "--json"],
      },
      {
        label: "tells the user to turn the flag off when both selected JSON under an agent",
        agent: "claude_code",
        source: "both" as const,
        expected: ["--json=false"],
        unexpected: ["drop", "unset"],
      },
    ])("$label", async ({ agent, source, expected, unexpected }) => {
      const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
      const stdoutDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
      Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
      Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });

      try {
        const [{ prompt }, { logger, setJsonDefaultAgent }] = await Promise.all([
          import("./prompt"),
          import("./logger"),
        ]);
        setJsonDefaultAgent(agent);
        logger.setJsonMode(true, source);
        const error = await prompt.confirm({ message: "proceed?" }).catch((e: unknown) => e);
        logger.jsonMode = false;
        setJsonDefaultAgent(undefined);
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
