import { runCommand } from "@politty/zod";
import { describe, expect, test, vi } from "vitest";
import { loadOperatorWorkspaceContext } from "#/cli/shared/operator-context";
import { prompt } from "#/cli/shared/prompt";
import { revokeAuthConnectionCommand } from "./revoke";

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

describe("authconnection revoke command", () => {
  test("fails without revoking when the entered name does not match", async () => {
    const client = { revokeAuthConnection: vi.fn().mockResolvedValue({}) };
    vi.mocked(loadOperatorWorkspaceContext).mockResolvedValue({
      client,
      workspaceId: "workspace-1",
    } as unknown as Awaited<ReturnType<typeof loadOperatorWorkspaceContext>>);
    vi.mocked(prompt.text).mockResolvedValue("other");

    const result = await runCommand(revokeAuthConnectionCommand, ["--name", "google"]);

    expect(prompt.text).toHaveBeenCalledWith({
      message: 'Enter the connection name to confirm revocation ("google"):',
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({ code: "AUTH_CONNECTION_REVOCATION_CANCELLED" });
    expect(client.revokeAuthConnection).not.toHaveBeenCalled();
  });
});
