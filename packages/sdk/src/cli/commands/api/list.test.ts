import { runCommand } from "politty";
import { describe, expect, test, vi } from "vitest";
import { logger } from "@/cli/shared/logger";
import { apiCommand } from "./index";

describe("api list", () => {
  test("emits method names line by line", async () => {
    using stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runCommand(apiCommand, ["list"]);
    const written = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(written).toContain("Ping\n");
    expect(written).toContain("GetApplication\n");
  });

  test("with jsonMode emits a JSON array of method names", async () => {
    using _stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    using consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const original = logger.jsonMode;
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
      logger.jsonMode = original;
    }
  });
});
