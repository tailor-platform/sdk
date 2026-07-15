import open from "open";
import { runCommand } from "politty";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { loadConsoleBaseUrl, loadWorkspaceId } from "#/cli/shared/context";
import { captureStdout } from "#/cli/shared/test-helpers/capture-output";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
import { openAuthConnectionCommand } from "./open";
import type { ChildProcess } from "node:child_process";

vi.mock("open", () => ({
  default: vi.fn(),
}));

vi.mock("#/cli/shared/context", () => ({
  loadConsoleBaseUrl: vi.fn(),
  loadWorkspaceId: vi.fn(),
}));

describe("authconnection open --json", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadWorkspaceId).mockResolvedValue("12345678-1234-4abc-8def-123456789012");
    vi.mocked(loadConsoleBaseUrl).mockResolvedValue("https://console.tailor.tech");
    vi.mocked(open).mockResolvedValue({} as ChildProcess);
  });

  test.each([
    ["the browser opens", () => vi.mocked(open).mockResolvedValue({} as ChildProcess), true],
    [
      "opening the browser fails",
      () => vi.mocked(open).mockRejectedValue(new Error("browser unavailable")),
      false,
    ],
  ])("emits a parseable JSON object when %s", async (_desc, setupMock, opened) => {
    setupMock();

    using stdout = captureStdout();
    using _stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    using _json = jsonMode();

    await runCommand(openAuthConnectionCommand, []);

    expect(JSON.parse(stdout.output)).toEqual({
      consoleUrl:
        "https://console.tailor.tech/workspaces/12345678-1234-4abc-8def-123456789012/settings/connections",
      workspaceId: "12345678-1234-4abc-8def-123456789012",
      opened,
    });
  });

  test("allows a missing profile when the workspace ID is overridden", async () => {
    using _stdout = captureStdout();
    using _stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await runCommand(openAuthConnectionCommand, [
      "--profile",
      "missing",
      "--workspace-id",
      "12345678-1234-4abc-8def-123456789012",
    ]);

    expect(loadConsoleBaseUrl).toHaveBeenCalledWith({
      profile: "missing",
      allowMissingProfile: true,
    });
  });
});
