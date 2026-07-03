import open from "open";
import { runCommand } from "politty";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { loadConfig } from "#/cli/shared/config-loader";
import { loadConsoleBaseUrl, loadWorkspaceId } from "#/cli/shared/context";
import { captureStdout } from "#/cli/shared/test-helpers/capture-output";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
import { openCommand } from "./open";
import type { ChildProcess } from "node:child_process";

vi.mock("open", () => ({
  default: vi.fn(),
}));

vi.mock("#/cli/shared/config-loader", () => ({
  loadConfig: vi.fn(),
}));

vi.mock("#/cli/shared/context", () => ({
  loadConsoleBaseUrl: vi.fn(),
  loadWorkspaceId: vi.fn(),
}));

describe("open --json", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadWorkspaceId).mockResolvedValue("12345678-1234-4abc-8def-123456789012");
    vi.mocked(loadConsoleBaseUrl).mockResolvedValue("https://console.tailor.tech");
    vi.mocked(loadConfig).mockResolvedValue({
      config: {
        name: "my-app",
      },
    } as unknown as Awaited<ReturnType<typeof loadConfig>>);
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

    await runCommand(openCommand, []);

    expect(JSON.parse(stdout.output)).toEqual({
      consoleUrl:
        "https://console.tailor.tech/workspaces/12345678-1234-4abc-8def-123456789012/applications/my-app/overview",
      workspaceId: "12345678-1234-4abc-8def-123456789012",
      applicationName: "my-app",
      opened,
    });
  });

  test("uses the console URL resolved from the selected profile", async () => {
    vi.mocked(loadConsoleBaseUrl).mockResolvedValue("https://console.dev.tailor.tech");

    using stdout = captureStdout();
    using _stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    using _json = jsonMode();

    await runCommand(openCommand, ["--profile", "dev"]);

    expect(JSON.parse(stdout.output)).toEqual({
      consoleUrl:
        "https://console.dev.tailor.tech/workspaces/12345678-1234-4abc-8def-123456789012/applications/my-app/overview",
      workspaceId: "12345678-1234-4abc-8def-123456789012",
      applicationName: "my-app",
      opened: true,
    });
    expect(loadConsoleBaseUrl).toHaveBeenCalledWith({ profile: "dev" });
  });

  test("allows a missing profile when the workspace ID is overridden", async () => {
    using _stdout = captureStdout();
    using _stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await runCommand(openCommand, [
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
