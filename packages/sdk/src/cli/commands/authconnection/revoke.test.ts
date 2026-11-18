import { runCommand } from "@politty/zod";
import { describe, expect, test, vi } from "vitest";
import { SKIP_CONFIRMATION_SUGGESTION } from "#/cli/shared/args";
import { loadOperatorWorkspaceContext } from "#/cli/shared/operator-context";
import { prompt } from "#/cli/shared/prompt";
import { captureStdout } from "#/cli/shared/test-helpers/capture-output";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
import { mockOperatorClient } from "#/cli/shared/test-helpers/operator-client";
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

function mockContextClient() {
  const client = mockOperatorClient({ revokeAuthConnection: {} });
  vi.mocked(loadOperatorWorkspaceContext).mockResolvedValue({ client, workspaceId: "workspace-1" });
  return client;
}

describe("authconnection revoke command", () => {
  test("fails without revoking when the entered name does not match", async () => {
    const client = mockContextClient();
    vi.mocked(prompt.text).mockResolvedValue("other");

    const result = await runCommand(revokeAuthConnectionCommand, ["--name", "google"]);

    expect(prompt.text).toHaveBeenCalledWith({
      message: 'Enter the connection name to confirm revocation ("google"):',
      suggestion: SKIP_CONFIRMATION_SUGGESTION,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({ code: "AUTH_CONNECTION_REVOCATION_CANCELLED" });
    expect(client.revokeAuthConnection).not.toHaveBeenCalled();
  });

  test("revokes when the entered name matches", async () => {
    const client = mockContextClient();
    vi.mocked(prompt.text).mockResolvedValue("google");

    const result = await runCommand(revokeAuthConnectionCommand, ["--name", "google"]);

    expect(result.success).toBe(true);
    expect(client.revokeAuthConnection).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      connectionName: "google",
    });
  });

  test("prints the revoked connection under JSON output", async () => {
    mockContextClient();
    using _json = jsonMode();
    using stdout = captureStdout();

    const result = await runCommand(revokeAuthConnectionCommand, ["--name", "google", "--yes"]);

    expect(result.success).toBe(true);
    expect(JSON.parse(stdout.output)).toEqual({
      changed: true,
      workspaceId: "workspace-1",
      name: "google",
    });
  });
});
