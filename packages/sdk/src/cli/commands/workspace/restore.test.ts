import { runCommand } from "@politty/zod";
import { describe, expect, test, vi } from "vitest";
import { initOperatorClient } from "#/cli/shared/client";
import { prompt } from "#/cli/shared/prompt";
import { restoreCommand } from "./restore";

vi.mock("#/cli/shared/client", () => ({
  initOperatorClient: vi.fn(),
}));

vi.mock("#/cli/shared/context", () => ({
  loadAccessToken: vi.fn().mockResolvedValue("mock-token"),
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

describe("workspace restore command", () => {
  test("fails without restoring when the confirmation is not yes", async () => {
    const client = { restoreWorkspace: vi.fn().mockResolvedValue({}) };
    vi.mocked(initOperatorClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof initOperatorClient>>,
    );
    vi.mocked(prompt.text).mockResolvedValue("no");

    const result = await runCommand(restoreCommand, ["--workspace-id", workspaceId]);

    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({ code: "WORKSPACE_RESTORATION_CANCELLED" });
    expect(client.restoreWorkspace).not.toHaveBeenCalled();
  });

  test("restores when the confirmation is yes", async () => {
    const client = { restoreWorkspace: vi.fn().mockResolvedValue({}) };
    vi.mocked(initOperatorClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof initOperatorClient>>,
    );
    vi.mocked(prompt.text).mockResolvedValue("yes");

    const result = await runCommand(restoreCommand, ["--workspace-id", workspaceId]);

    expect(result.success).toBe(true);
    expect(client.restoreWorkspace).toHaveBeenCalledWith({ workspaceId });
  });
});
