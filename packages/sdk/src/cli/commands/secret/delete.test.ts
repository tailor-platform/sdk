import { runCommand } from "@politty/zod";
import { describe, expect, test, vi } from "vitest";
import { loadOperatorWorkspaceContext } from "#/cli/shared/operator-context";
import { prompt } from "#/cli/shared/prompt";
import { deleteSecretCommand } from "./delete";

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

vi.mock("./check-vault-managed", () => ({
  checkVaultManaged: vi.fn().mockResolvedValue({ isManaged: false }),
  releaseVaultOwnership: vi.fn(),
}));

describe("secret delete command", () => {
  test("fails without deleting when the entered name does not match", async () => {
    const client = { deleteSecretManagerSecret: vi.fn().mockResolvedValue({}) };
    vi.mocked(loadOperatorWorkspaceContext).mockResolvedValue({
      client,
      workspaceId: "workspace-1",
    } as unknown as Awaited<ReturnType<typeof loadOperatorWorkspaceContext>>);
    vi.mocked(prompt.text).mockResolvedValue("other");

    const result = await runCommand(deleteSecretCommand, [
      "--vault-name",
      "api-keys",
      "--name",
      "stripe",
    ]);

    expect(prompt.text).toHaveBeenCalledWith({
      message: 'Enter the secret name to confirm deletion ("stripe"):',
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({ code: "SECRET_DELETION_CANCELLED" });
    expect(client.deleteSecretManagerSecret).not.toHaveBeenCalled();
  });

  test("deletes when the entered name matches", async () => {
    const client = { deleteSecretManagerSecret: vi.fn().mockResolvedValue({}) };
    vi.mocked(loadOperatorWorkspaceContext).mockResolvedValue({
      client,
      workspaceId: "workspace-1",
    } as unknown as Awaited<ReturnType<typeof loadOperatorWorkspaceContext>>);
    vi.mocked(prompt.text).mockResolvedValue("stripe");

    const result = await runCommand(deleteSecretCommand, [
      "--vault-name",
      "api-keys",
      "--name",
      "stripe",
    ]);

    expect(result.success).toBe(true);
    expect(client.deleteSecretManagerSecret).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      secretmanagerVaultName: "api-keys",
      secretmanagerSecretName: "stripe",
    });
  });
});
