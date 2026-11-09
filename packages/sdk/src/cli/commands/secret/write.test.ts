import { runCommand } from "@politty/zod";
import { describe, expect, test, vi } from "vitest";
import { loadOperatorWorkspaceContext } from "#/cli/shared/operator-context";
import { prompt } from "#/cli/shared/prompt";
import { checkVaultManaged, releaseVaultOwnership } from "./check-vault-managed";
import { createSecretCommand } from "./create";
import { updateSecretCommand } from "./update";

vi.mock("#/cli/shared/operator-context", () => ({ loadOperatorWorkspaceContext: vi.fn() }));
vi.mock("#/cli/shared/prompt", () => ({ prompt: { confirm: vi.fn() } }));
vi.mock("#/cli/shared/readonly-guard", () => ({ assertWritable: vi.fn() }));
vi.mock("./check-vault-managed", () => ({
  checkVaultManaged: vi.fn(),
  releaseVaultOwnership: vi.fn(),
}));

describe.each([
  ["create", createSecretCommand],
  ["update", updateSecretCommand],
] as const)("secret %s ownership", (_name, command) => {
  test.each([
    { managed: true, fails: false, expected: ["write", "release"] },
    { managed: false, fails: false, expected: ["write"] },
    { managed: true, fails: true, expected: ["write"] },
  ])("--yes with managed=$managed and fails=$fails", async ({ managed, fails, expected }) => {
    const operations: string[] = [];
    const error = new Error("write rejected");
    const write = vi.fn(async () => {
      operations.push("write");
      if (fails) throw error;
      return {};
    });
    vi.mocked(checkVaultManaged).mockResolvedValue({
      isManaged: managed,
      trn: "vault-trn",
      existingLabels: {},
    });
    vi.mocked(releaseVaultOwnership).mockImplementation(async () => {
      operations.push("release");
    });
    vi.mocked(loadOperatorWorkspaceContext).mockResolvedValue({
      workspaceId: "workspace-1",
      client: { createSecretManagerSecret: write, updateSecretManagerSecret: write },
    } as unknown as Awaited<ReturnType<typeof loadOperatorWorkspaceContext>>);

    const result = await runCommand(command, [
      "--vault-name",
      "keys",
      "--name",
      "service",
      "--value",
      "secret-value",
      "--yes",
    ]);

    expect(result.success).toBe(!fails);
    expect(result.error).toBe(fails ? error : undefined);
    expect(prompt.confirm).not.toHaveBeenCalled();
    expect(operations).toEqual(expected);
    expect(write).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      secretmanagerVaultName: "keys",
      secretmanagerSecretName: "service",
      secretmanagerSecretValue: "secret-value",
    });
  });
});
