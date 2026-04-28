import { runCommand } from "politty";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { logger } from "@/cli/shared/logger";
import { apiCommand } from "./index";

describe("api list", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  test("emits method names line by line", async () => {
    await runCommand(apiCommand, ["list"]);
    const written = stdoutSpy.mock.calls.map((c: [unknown]) => String(c[0])).join("");
    expect(written).toContain("Ping\n");
    expect(written).toContain("GetApplication\n");
  });

  test("with jsonMode emits a JSON array of method names", async () => {
    const original = logger.jsonMode;
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.jsonMode = true;
    try {
      await runCommand(apiCommand, ["list"]);
      const calls = consoleLogSpy.mock.calls.map((c) => String(c[0]));
      const json = calls.find((line) => line.startsWith("["));
      expect(json).toBeDefined();
      const parsed = JSON.parse(json ?? "[]");
      expect(parsed).toContain("Ping");
      expect(parsed).toContain("GetApplication");
    } finally {
      consoleLogSpy.mockRestore();
      logger.jsonMode = original;
    }
  });
});
