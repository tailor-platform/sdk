import { runCommand } from "@politty/zod";
import { describe, expect, test, vi } from "vitest";
import { loadOperatorWorkspaceContext } from "#/cli/shared/operator-context";
import { prompt } from "#/cli/shared/prompt";
import { releaseVaultOwnership } from "./check-vault-managed";
import { createSecretCommand } from "./create";

vi.mock("#/cli/shared/operator-context", () => ({
  loadOperatorWorkspaceContext: vi.fn(),
}));

vi.mock("#/cli/shared/prompt", () => ({
  prompt: {
    confirm: vi.fn(),
  },
}));

vi.mock("#/cli/shared/readonly-guard", () => ({
  assertWritable: vi.fn(),
}));

vi.mock("./check-vault-managed", () => ({
  checkVaultManaged: vi.fn().mockResolvedValue({ isManaged: true }),
  releaseVaultOwnership: vi.fn(),
}));

describe("secret create command", () => {
  test("fails without creating when releasing a managed vault is declined", async () => {
    const client = { createSecretManagerSecret: vi.fn().mockResolvedValue({}) };
    vi.mocked(loadOperatorWorkspaceContext).mockResolvedValue({
      client,
      workspaceId: "workspace-1",
    } as unknown as Awaited<ReturnType<typeof loadOperatorWorkspaceContext>>);
    vi.mocked(prompt.confirm).mockResolvedValue(false);

    const result = await runCommand(createSecretCommand, [
      "--vault-name",
      "api-keys",
      "--name",
      "stripe",
      "--value",
      "sk_live",
    ]);

    expect(prompt.confirm).toHaveBeenCalledWith({
      message: "Do you want to proceed?",
      default: false,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({ code: "SECRET_CREATION_CANCELLED" });
    expect(client.createSecretManagerSecret).not.toHaveBeenCalled();
    expect(releaseVaultOwnership).not.toHaveBeenCalled();
  });

  test("creates and releases the vault when the confirmation is accepted", async () => {
    const client = { createSecretManagerSecret: vi.fn().mockResolvedValue({}) };
    vi.mocked(loadOperatorWorkspaceContext).mockResolvedValue({
      client,
      workspaceId: "workspace-1",
    } as unknown as Awaited<ReturnType<typeof loadOperatorWorkspaceContext>>);
    vi.mocked(prompt.confirm).mockResolvedValue(true);

    const result = await runCommand(createSecretCommand, [
      "--vault-name",
      "api-keys",
      "--name",
      "stripe",
      "--value",
      "sk_live",
    ]);

    expect(result.success).toBe(true);
    expect(client.createSecretManagerSecret).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      secretmanagerVaultName: "api-keys",
      secretmanagerSecretName: "stripe",
      secretmanagerSecretValue: "sk_live",
    });
    expect(releaseVaultOwnership).toHaveBeenCalledTimes(1);
  });
});
