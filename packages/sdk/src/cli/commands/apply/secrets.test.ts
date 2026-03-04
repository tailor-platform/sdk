import { describe, test, expect, vi, beforeEach } from "vitest";
import { applySecrets, type planSecrets } from "./secrets";
import type { OperatorClient } from "@/cli/shared/client";

describe("applySecrets phase separation", () => {
  function createMockClient() {
    return {
      createSecretManagerVault: vi.fn().mockResolvedValue({}),
      createSecretManagerSecret: vi.fn().mockResolvedValue({}),
      updateSecretManagerSecret: vi.fn().mockResolvedValue({}),
      deleteSecretManagerSecret: vi.fn().mockResolvedValue({}),
    } as unknown as OperatorClient;
  }

  function createMockPlanResult() {
    return {
      vaultChangeSet: {
        creates: [{ name: "my-vault", workspaceId: "ws-1" }],
        updates: [],
        deletes: [],
        replaces: [],
        title: "Secret Manager vaults",
        isEmpty: () => false,
        print: () => {},
      },
      secretChangeSet: {
        creates: [
          {
            name: "my-vault/NEW_SECRET",
            secretName: "NEW_SECRET",
            workspaceId: "ws-1",
            vaultName: "my-vault",
            value: "new-value",
          },
        ],
        updates: [
          {
            name: "my-vault/EXISTING_SECRET",
            secretName: "EXISTING_SECRET",
            workspaceId: "ws-1",
            vaultName: "my-vault",
            value: "updated-value",
          },
        ],
        deletes: [
          {
            name: "my-vault/ORPHAN_SECRET",
            secretName: "ORPHAN_SECRET",
            workspaceId: "ws-1",
            vaultName: "my-vault",
          },
        ],
        replaces: [],
        title: "Secret Manager secrets",
        isEmpty: () => false,
        print: () => {},
      },
    } as unknown as Awaited<ReturnType<typeof planSecrets>>;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("create-update phase creates vaults and secrets, does not delete", async () => {
    const client = createMockClient();
    const planResult = createMockPlanResult();

    await applySecrets(client, planResult, "create-update");

    expect(client.createSecretManagerVault).toHaveBeenCalledTimes(1);
    expect(client.createSecretManagerVault).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      secretmanagerVaultName: "my-vault",
    });

    expect(client.createSecretManagerSecret).toHaveBeenCalledTimes(1);
    expect(client.createSecretManagerSecret).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      secretmanagerVaultName: "my-vault",
      secretmanagerSecretName: "NEW_SECRET",
      secretmanagerSecretValue: "new-value",
    });

    expect(client.updateSecretManagerSecret).toHaveBeenCalledTimes(1);
    expect(client.updateSecretManagerSecret).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      secretmanagerVaultName: "my-vault",
      secretmanagerSecretName: "EXISTING_SECRET",
      secretmanagerSecretValue: "updated-value",
    });

    expect(client.deleteSecretManagerSecret).not.toHaveBeenCalled();
  });

  test("delete phase deletes orphan secrets, does not create or update", async () => {
    const client = createMockClient();
    const planResult = createMockPlanResult();

    await applySecrets(client, planResult, "delete");

    expect(client.createSecretManagerVault).not.toHaveBeenCalled();
    expect(client.createSecretManagerSecret).not.toHaveBeenCalled();
    expect(client.updateSecretManagerSecret).not.toHaveBeenCalled();

    expect(client.deleteSecretManagerSecret).toHaveBeenCalledTimes(1);
    expect(client.deleteSecretManagerSecret).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      secretmanagerVaultName: "my-vault",
      secretmanagerSecretName: "ORPHAN_SECRET",
    });
  });

  test("empty plan result does nothing", async () => {
    const client = createMockClient();
    const emptyResult = {
      vaultChangeSet: {
        creates: [],
        updates: [],
        deletes: [],
        replaces: [],
        title: "Secret Manager vaults",
        isEmpty: () => true,
        print: () => {},
      },
      secretChangeSet: {
        creates: [],
        updates: [],
        deletes: [],
        replaces: [],
        title: "Secret Manager secrets",
        isEmpty: () => true,
        print: () => {},
      },
    } as unknown as Awaited<ReturnType<typeof planSecrets>>;

    await applySecrets(client, emptyResult, "create-update");

    expect(client.createSecretManagerVault).not.toHaveBeenCalled();
    expect(client.createSecretManagerSecret).not.toHaveBeenCalled();
    expect(client.updateSecretManagerSecret).not.toHaveBeenCalled();
    expect(client.deleteSecretManagerSecret).not.toHaveBeenCalled();
  });
});
