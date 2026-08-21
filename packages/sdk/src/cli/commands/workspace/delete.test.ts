import { Code, ConnectError } from "@connectrpc/connect";
import { runCommand } from "politty";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { initOperatorClient } from "#/cli/shared/client";
import { logger } from "#/cli/shared/logger";
import { prompt } from "#/cli/shared/prompt";
import { deleteCommand } from "./delete";

vi.mock("#/cli/shared/client", () => ({
  initOperatorClient: vi.fn(),
}));

vi.mock("#/cli/shared/context", () => ({
  loadAccessToken: vi.fn().mockResolvedValue("mock-token"),
  readPlatformConfig: vi.fn().mockResolvedValue({ profiles: {} }),
  writePlatformConfig: vi.fn(),
}));

vi.mock("#/cli/shared/logger", () => ({
  logger: {
    info: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("#/cli/shared/prompt", () => ({
  prompt: {
    text: vi.fn(),
  },
}));

vi.mock("#/cli/shared/readonly-guard", () => ({
  assertWritable: vi.fn(),
}));

const workspaceId = "12345678-1234-4abc-8def-123456789012";

function stubClient() {
  const client = {
    getWorkspace: vi.fn().mockResolvedValue({
      workspace: {
        id: workspaceId,
        name: "sample-space",
        organizationId: "organization-1",
        folderId: "folder-1",
      },
    }),
    getOrganizationFolder: vi.fn().mockResolvedValue({
      folder: {
        name: "dev",
      },
    }),
    deleteWorkspace: vi.fn().mockResolvedValue({}),
  };
  vi.mocked(initOperatorClient).mockResolvedValue(
    client as unknown as Awaited<ReturnType<typeof initOperatorClient>>,
  );
  return client;
}

describe("workspace delete command", () => {
  aroundEach(async (runTest) => {
    vi.clearAllMocks();
    await runTest();
  });

  test("accepts the bare workspace name when the prompt shows the folder-qualified name", async () => {
    const client = stubClient();
    vi.mocked(prompt.text).mockResolvedValue("sample-space");

    await runCommand(deleteCommand, ["--workspace-id", workspaceId]);

    expect(prompt.text).toHaveBeenCalledWith({
      message: "Enter the workspace name to confirm deletion (dev/sample-space):",
    });
    expect(client.deleteWorkspace).toHaveBeenCalledWith({ workspaceId });
    expect(logger.success).toHaveBeenCalledWith(
      'Workspace "dev/sample-space" deleted successfully.',
    );
  });

  test("accepts the folder-qualified workspace name", async () => {
    const client = stubClient();
    vi.mocked(prompt.text).mockResolvedValue("dev/sample-space");

    await runCommand(deleteCommand, ["--workspace-id", workspaceId]);

    expect(client.deleteWorkspace).toHaveBeenCalledWith({ workspaceId });
  });

  test("reports not found when the workspace lookup returns NotFound", async () => {
    const client = stubClient();
    client.getWorkspace.mockRejectedValue(new ConnectError("missing", Code.NotFound));

    const result = await runCommand(deleteCommand, ["--workspace-id", workspaceId]);

    expect(result.error?.message).toBe(`Workspace "${workspaceId}" not found.`);
    expect(client.deleteWorkspace).not.toHaveBeenCalled();
  });

  test("propagates lookup failures other than NotFound", async () => {
    const client = stubClient();
    const failure = new ConnectError("backend unavailable", Code.Unavailable);
    client.getWorkspace.mockRejectedValue(failure);

    const result = await runCommand(deleteCommand, ["--workspace-id", workspaceId]);

    expect(result.error).toBe(failure);
    expect(client.deleteWorkspace).not.toHaveBeenCalled();
  });
});
