import { runCommand } from "@politty/zod";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { fetchPaged, initOperatorClient } from "#/cli/shared/client";
import { loadAccessToken, loadWorkspaceId } from "#/cli/shared/context";
import { logger } from "#/cli/shared/logger";
import { captureStdout } from "#/cli/shared/test-helpers/capture-output";
import { listCommand } from "./list";
import type { ExecutorExecutor } from "@tailor-platform/tailor-proto/executor_resource_pb";

vi.mock("#/cli/shared/client", () => ({
  fetchPaged: vi.fn(),
  initOperatorClient: vi.fn(),
}));

vi.mock("#/cli/shared/context", () => ({
  loadAccessToken: vi.fn(),
  loadWorkspaceId: vi.fn(),
}));

const workspaceId = "12345678-1234-4abc-8def-123456789012";

const webhookExecutor = {
  name: "on-webhook",
  disabled: false,
  triggerConfig: { config: { case: "incomingWebhook", value: {} } },
} as unknown as ExecutorExecutor;

describe("executor list", () => {
  aroundEach(async (runTest) => {
    vi.mocked(loadAccessToken).mockResolvedValue("mock-token");
    vi.mocked(loadWorkspaceId).mockResolvedValue(workspaceId);
    vi.mocked(initOperatorClient).mockResolvedValue(
      {} as Awaited<ReturnType<typeof initOperatorClient>>,
    );
    vi.mocked(fetchPaged).mockResolvedValue([webhookExecutor]);
    await runTest();
  });

  test("names the run's profile and workspace in the webhook list hint", async () => {
    using _stdout = captureStdout();
    using info = vi.spyOn(logger, "info").mockImplementation(() => undefined);

    const result = await runCommand(listCommand, [
      "--profile",
      "dev",
      "--workspace-id",
      workspaceId,
    ]);

    expect(result.success).toBe(true);
    expect(info).toHaveBeenCalledWith(
      `To see webhook URLs, run: tailor executor webhook list --workspace-id=${workspaceId} --profile=dev`,
    );
  });
});
