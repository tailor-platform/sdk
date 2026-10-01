import { runCommand } from "@politty/zod";
import { describe, expect, test, vi } from "vitest";
import { loadOperatorWorkspaceContext } from "#/cli/shared/operator-context";
import { prompt } from "#/cli/shared/prompt";
import { deleteAuthConnectionCommand } from "./delete";

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

describe("authconnection delete command", () => {
  test("fails without deleting when the entered name does not match", async () => {
    const client = { deleteAuthConnection: vi.fn().mockResolvedValue({}) };
    vi.mocked(loadOperatorWorkspaceContext).mockResolvedValue({
      client,
      workspaceId: "workspace-1",
    } as unknown as Awaited<ReturnType<typeof loadOperatorWorkspaceContext>>);
    vi.mocked(prompt.text).mockResolvedValue("other");

    const result = await runCommand(deleteAuthConnectionCommand, ["--name", "google"]);

    expect(prompt.text).toHaveBeenCalledWith({
      message: 'Enter the connection name to confirm deletion ("google"):',
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({ code: "AUTH_CONNECTION_DELETION_CANCELLED" });
    expect(client.deleteAuthConnection).not.toHaveBeenCalled();
  });

  test("deletes when the entered name matches", async () => {
    const client = { deleteAuthConnection: vi.fn().mockResolvedValue({}) };
    vi.mocked(loadOperatorWorkspaceContext).mockResolvedValue({
      client,
      workspaceId: "workspace-1",
    } as unknown as Awaited<ReturnType<typeof loadOperatorWorkspaceContext>>);
    vi.mocked(prompt.text).mockResolvedValue("google");

    const result = await runCommand(deleteAuthConnectionCommand, ["--name", "google"]);

    expect(result.success).toBe(true);
    expect(client.deleteAuthConnection).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      connectionName: "google",
    });
  });
});
