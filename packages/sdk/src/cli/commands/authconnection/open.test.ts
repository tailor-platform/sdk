import open from "open";
import { runCommand } from "politty";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { loadWorkspaceId } from "#src/cli/shared/context";
import { captureStdout } from "#src/cli/shared/test-helpers/capture-output";
import { jsonMode } from "#src/cli/shared/test-helpers/json-mode";
import { openAuthConnectionCommand } from "./open";
import type { ChildProcess } from "node:child_process";

vi.mock("open", () => ({
  default: vi.fn(),
}));

vi.mock("#src/cli/shared/context", () => ({
  loadWorkspaceId: vi.fn(),
}));

describe("authconnection open --json", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadWorkspaceId).mockResolvedValue("12345678-1234-4abc-8def-123456789012");
    vi.mocked(open).mockResolvedValue({} as ChildProcess);
  });

  test("emits a parseable JSON object when the browser opens", async () => {
    using stdout = captureStdout();
    using _stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    using _json = jsonMode();

    await runCommand(openAuthConnectionCommand, []);

    expect(JSON.parse(stdout.output)).toEqual({
      consoleUrl:
        "https://console.tailor.tech/workspaces/12345678-1234-4abc-8def-123456789012/settings/connections",
      workspaceId: "12345678-1234-4abc-8def-123456789012",
      opened: true,
    });
  });

  test("emits a parseable JSON object when opening the browser fails", async () => {
    vi.mocked(open).mockRejectedValue(new Error("browser unavailable"));

    using stdout = captureStdout();
    using _stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    using _json = jsonMode();

    await runCommand(openAuthConnectionCommand, []);

    expect(JSON.parse(stdout.output)).toEqual({
      consoleUrl:
        "https://console.tailor.tech/workspaces/12345678-1234-4abc-8def-123456789012/settings/connections",
      workspaceId: "12345678-1234-4abc-8def-123456789012",
      opened: false,
    });
  });
});
