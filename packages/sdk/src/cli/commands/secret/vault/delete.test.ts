import { runCommand } from "@politty/zod";
import { describe, expect, test, vi } from "vitest";
import { loadOperatorWorkspaceContext } from "#/cli/shared/operator-context";
import { prompt } from "#/cli/shared/prompt";
import { deleteCommand } from "./delete";

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

vi.mock("../check-vault-managed", () => ({
  checkVaultManaged: vi.fn().mockResolvedValue({ isManaged: false }),
  releaseVaultOwnership: vi.fn(),
}));

describe("secret vault delete command", () => {
  test("fails without deleting when the entered name does not match", async () => {
    const client = { deleteSecretManagerVault: vi.fn().mockResolvedValue({}) };
    vi.mocked(loadOperatorWorkspaceContext).mockResolvedValue({
      client,
      workspaceId: "workspace-1",
    } as unknown as Awaited<ReturnType<typeof loadOperatorWorkspaceContext>>);
    vi.mocked(prompt.text).mockResolvedValue("other");

    const result = await runCommand(deleteCommand, ["--name", "api-keys"]);

    expect(prompt.text).toHaveBeenCalledWith({
      message: 'Enter the vault name to confirm deletion ("api-keys"):',
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({ code: "VAULT_DELETION_CANCELLED" });
    expect(client.deleteSecretManagerVault).not.toHaveBeenCalled();
  });

  test("deletes when the entered name matches", async () => {
    const client = { deleteSecretManagerVault: vi.fn().mockResolvedValue({}) };
    vi.mocked(loadOperatorWorkspaceContext).mockResolvedValue({
      client,
      workspaceId: "workspace-1",
    } as unknown as Awaited<ReturnType<typeof loadOperatorWorkspaceContext>>);
    vi.mocked(prompt.text).mockResolvedValue("api-keys");

    const result = await runCommand(deleteCommand, ["--name", "api-keys"]);

    expect(result.success).toBe(true);
    expect(client.deleteSecretManagerVault).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      secretmanagerVaultName: "api-keys",
    });
  });
});
