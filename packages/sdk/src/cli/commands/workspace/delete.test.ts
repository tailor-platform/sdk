import { runCommand } from "politty";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { initOperatorClient } from "#src/cli/shared/client";
import { logger } from "#src/cli/shared/logger";
import { prompt } from "#src/cli/shared/prompt";
import { deleteCommand } from "./delete";

vi.mock("#src/cli/shared/client", () => ({
  initOperatorClient: vi.fn(),
}));

vi.mock("#src/cli/shared/context", () => ({
  loadAccessToken: vi.fn().mockResolvedValue("mock-token"),
  readPlatformConfig: vi.fn().mockResolvedValue({ profiles: {} }),
  writePlatformConfig: vi.fn(),
}));

vi.mock("#src/cli/shared/logger", () => ({
  logger: {
    info: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("#src/cli/shared/prompt", () => ({
  prompt: {
    text: vi.fn(),
  },
}));

vi.mock("#src/cli/shared/readonly-guard", () => ({
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
  beforeEach(() => {
    vi.clearAllMocks();
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
});
