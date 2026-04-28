import { runCommand } from "politty";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { logger } from "@/cli/shared/logger";
import { apiCommand } from "./index";

describe("api inspect", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  test("prints field tree as text", async () => {
    await runCommand(apiCommand, ["inspect", "GetApplication"]);
    const written = stdoutSpy.mock.calls.map((c: [unknown]) => String(c[0])).join("");
    expect(written).toContain("GetApplication");
    expect(written).toContain("workspaceId");
    expect(written).toContain("applicationName");
  });

  test("with jsonMode emits a structured method descriptor", async () => {
    const original = logger.jsonMode;
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.jsonMode = true;
    try {
      await runCommand(apiCommand, ["inspect", "GetApplication"]);
      const calls = consoleLogSpy.mock.calls.map((c) => String(c[0]));
      const json = calls.find((line) => line.startsWith("{"));
      expect(json).toBeDefined();
      const parsed = JSON.parse(json ?? "{}");
      expect(parsed.method).toBe("GetApplication");
      const names = parsed.input.fields.map((f: { name: string }) => f.name);
      expect(names).toContain("workspaceId");
    } finally {
      consoleLogSpy.mockRestore();
      logger.jsonMode = original;
    }
  });

  test("rejects unknown method", async () => {
    const result = await runCommand(apiCommand, ["inspect", "NotARealMethod"]);
    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/unknown method/);
  });
});
