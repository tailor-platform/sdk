import { runCommand } from "politty";
import { describe, expect, test, vi } from "vitest";
import { jsonMode } from "#src/cli/shared/test-helpers/json-mode";
import { apiCommand } from "./index";

describe("api inspect", () => {
  test("prints field tree as text", async () => {
    using stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runCommand(apiCommand, ["inspect", "GetApplication"]);
    const written = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(written).toContain("GetApplication");
    expect(written).toContain("workspaceId");
    expect(written).toContain("applicationName");
  });

  test("with jsonMode emits a structured method descriptor", async () => {
    using _stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    using consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    using _json = jsonMode();
    await runCommand(apiCommand, ["inspect", "GetApplication"]);
    const calls = consoleLogSpy.mock.calls.map((c) => String(c[0]));
    const json = calls.find((line) => line.startsWith("{"));
    expect(json).toBeDefined();
    const parsed = JSON.parse(json ?? "{}");
    expect(parsed.method).toBe("GetApplication");
    const names = parsed.input.fields.map((f: { name: string }) => f.name);
    expect(names).toContain("workspaceId");
  });

  test("rejects unknown method", async () => {
    using _stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const result = await runCommand(apiCommand, ["inspect", "NotARealMethod"]);
    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/unknown method/);
  });
});
