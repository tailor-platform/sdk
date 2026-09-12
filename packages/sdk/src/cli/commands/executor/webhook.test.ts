import { runCommand } from "@politty/zod";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { fetchPaged, initOperatorClient } from "#/cli/shared/client";
import { loadAccessToken, loadWorkspaceId } from "#/cli/shared/context";
import { logger } from "#/cli/shared/logger";
import { captureStdout } from "#/cli/shared/test-helpers/capture-output";
import { webhookCommand } from "./webhook";

vi.mock("#/cli/shared/client", () => ({
  fetchPaged: vi.fn(),
  initOperatorClient: vi.fn(),
}));

vi.mock("#/cli/shared/context", () => ({
  loadAccessToken: vi.fn(),
  loadWorkspaceId: vi.fn(),
}));

describe("executor webhook list", () => {
  aroundEach(async (runTest) => {
    vi.mocked(loadAccessToken).mockResolvedValue("mock-token");
    vi.mocked(loadWorkspaceId).mockResolvedValue("12345678-1234-4abc-8def-123456789012");
    vi.mocked(initOperatorClient).mockResolvedValue(
      {} as Awaited<ReturnType<typeof initOperatorClient>>,
    );
    vi.mocked(fetchPaged).mockResolvedValue([
      { executorName: "on-webhook", url: "https://example.com/hook", disabled: false },
    ]);
    await runTest();
  });

  test("keeps the run's profile on the trigger hint", async () => {
    using _platform = vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    using _stdout = captureStdout();
    using info = vi.spyOn(logger, "info").mockImplementation(() => undefined);

    const result = await runCommand(webhookCommand, ["list", "--profile", "dev"]);

    expect(result.success).toBe(true);
    expect(info).toHaveBeenCalledWith(
      `To test a webhook, run: tailor executor trigger '<name>' -d '{"key":"value"}' --profile=dev`,
    );
  });

  test("leaves the trigger hint without a profile when the run selected none", async () => {
    using _platform = vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    using _stdout = captureStdout();
    using info = vi.spyOn(logger, "info").mockImplementation(() => undefined);

    const result = await runCommand(webhookCommand, ["list"]);

    expect(result.success).toBe(true);
    expect(info).toHaveBeenCalledWith(
      `To test a webhook, run: tailor executor trigger '<name>' -d '{"key":"value"}'`,
    );
  });

  test("renders the whole hint as argv when the Windows shell cannot keep the profile literal", async () => {
    using _platform = vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    using _stdout = captureStdout();
    using info = vi.spyOn(logger, "info").mockImplementation(() => undefined);

    const result = await runCommand(webhookCommand, ["list", "--profile", "dev$1"]);

    expect(result.success).toBe(true);
    expect(info).toHaveBeenCalledWith(
      `To test a webhook, run: argv ${JSON.stringify([
        "tailor",
        "executor",
        "trigger",
        "<name>",
        "-d",
        '{"key":"value"}',
        "--profile=dev$1",
      ])}`,
    );
  });
});
