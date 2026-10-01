import { runCommand } from "@politty/zod";
import { describe, expect, test, vi } from "vitest";
import { loadOperatorWorkspaceContext } from "#/cli/shared/operator-context";
import { prompt } from "#/cli/shared/prompt";
import { removeCommand } from "./remove";

vi.mock("#/cli/shared/operator-context", () => ({
  loadOperatorWorkspaceContext: vi.fn(),
}));

vi.mock("#/cli/shared/prompt", () => ({
  prompt: {
    text: vi.fn(),
  },
}));

vi.mock("#/cli/shared/readonly-guard", () => ({
  assertWritable: vi.fn(),
}));

describe("workspace user remove command", () => {
  test("fails without removing the user when the confirmation is not yes", async () => {
    const client = { removeWorkspacePlatformUser: vi.fn().mockResolvedValue({}) };
    vi.mocked(loadOperatorWorkspaceContext).mockResolvedValue({
      client,
      workspaceId: "workspace-1",
    } as unknown as Awaited<ReturnType<typeof loadOperatorWorkspaceContext>>);
    vi.mocked(prompt.text).mockResolvedValue("no");

    const result = await runCommand(removeCommand, ["--email", "user@example.com"]);

    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({ code: "WORKSPACE_USER_REMOVAL_CANCELLED" });
    expect(client.removeWorkspacePlatformUser).not.toHaveBeenCalled();
  });

  test("removes the user when the confirmation is yes", async () => {
    const client = { removeWorkspacePlatformUser: vi.fn().mockResolvedValue({}) };
    vi.mocked(loadOperatorWorkspaceContext).mockResolvedValue({
      client,
      workspaceId: "workspace-1",
    } as unknown as Awaited<ReturnType<typeof loadOperatorWorkspaceContext>>);
    vi.mocked(prompt.text).mockResolvedValue("yes");

    const result = await runCommand(removeCommand, ["--email", "user@example.com"]);

    expect(result.success).toBe(true);
    expect(client.removeWorkspacePlatformUser).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      email: "user@example.com",
    });
  });
});
