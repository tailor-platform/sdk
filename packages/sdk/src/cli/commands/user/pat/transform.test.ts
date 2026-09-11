import { describe, expect, test, vi } from "vitest";
import { logger } from "#/cli/shared/logger";
import { printCreatedToken } from "./transform";

function captureStdout(fn: () => void): string {
  using stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  fn();
  return stdoutSpy.mock.calls.map((call) => String(call[0])).join("");
}

function captureStderr(fn: () => void): string {
  using stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  fn();
  return stderrSpy.mock.calls.map((call) => String(call[0])).join("");
}

describe("printCreatedToken", () => {
  test("prints the human-readable result to stdout, not stderr, in non-JSON mode", () => {
    logger.jsonMode = false;
    const stderrOutput = captureStderr(() => {
      const stdoutOutput = captureStdout(() => {
        printCreatedToken("token-name", "the-new-token-value", false, "created");
      });
      expect(stdoutOutput).toContain("the-new-token-value");
      expect(stdoutOutput).toContain("Personal access token created successfully");
    });
    expect(stderrOutput).toBe("");
  });

  test("prints a JSON envelope in JSON mode", () => {
    logger.jsonMode = true;
    // logger.out()'s JSON-mode branch writes via console.log, not process.stdout.write.
    using consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      printCreatedToken("token-name", "the-new-token-value", true, "updated");
      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const parsed = JSON.parse(String(consoleLogSpy.mock.calls[0]?.[0])) as Record<
        string,
        unknown
      >;
      expect(parsed).toMatchObject({
        name: "token-name",
        scopes: ["read", "write"],
        token: "the-new-token-value",
      });
    } finally {
      logger.jsonMode = false;
    }
  });
});
