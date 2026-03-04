import { describe, test, expect, vi, beforeEach } from "vitest";
import { applySecrets, planSecrets } from "./secrets";
import { hashValue } from "./secrets-state";
import type { PlanContext } from "@/cli/commands/apply/apply";
import type { Application } from "@/cli/services/application";
import type { OperatorClient } from "@/cli/shared/client";

const mockLoadSecretsState = vi.fn();
const mockSaveSecretsState = vi.fn();

vi.mock("./secrets-state", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = (await importOriginal()) as typeof import("./secrets-state");
  return {
    ...actual,
    loadSecretsState: (...args: unknown[]) => mockLoadSecretsState(...args),
    saveSecretsState: (...args: unknown[]) => mockSaveSecretsState(...args),
  };
});

vi.mock("@/cli/shared/client", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = (await importOriginal()) as typeof import("@/cli/shared/client");
  return {
    ...actual,
    fetchAll: async <T>(fn: (pageToken: string, maxPageSize: number) => Promise<[T[], string]>) => {
      const [items] = await fn("", 100);
      return items;
    },
  };
});

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
    mockLoadSecretsState.mockReturnValue({
      version: 1,
      vaults: {
        "my-vault": {
          ORPHAN_SECRET: hashValue("orphan-value"),
        },
      },
    });
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

describe("planSecrets hash-based diff", () => {
  function createMockPlanClient(existingSecrets: string[] = []) {
    return {
      getSecretManagerVault: vi.fn().mockResolvedValue({}),
      listSecretManagerSecrets: vi.fn().mockResolvedValue({
        secrets: existingSecrets.map((name) => ({ name })),
        nextPageToken: "",
      }),
    } as unknown as OperatorClient;
  }

  function createPlanContext(
    client: OperatorClient,
    secrets: Array<{ vaultName: string; secrets: Array<{ name: string; value: string }> }>,
  ): PlanContext {
    return {
      client,
      workspaceId: "ws-1",
      application: {
        secrets,
      } as unknown as Application,
      forRemoval: false,
      config: {} as PlanContext["config"],
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadSecretsState.mockReturnValue({ version: 1, vaults: {} });
  });

  test("skips update when hash matches stored state", async () => {
    const secretValue = "my-secret-value";
    mockLoadSecretsState.mockReturnValue({
      version: 1,
      vaults: {
        "my-vault": {
          EXISTING_SECRET: hashValue(secretValue),
        },
      },
    });

    const client = createMockPlanClient(["EXISTING_SECRET"]);
    const ctx = createPlanContext(client, [
      {
        vaultName: "my-vault",
        secrets: [{ name: "EXISTING_SECRET", value: secretValue }],
      },
    ]);

    const result = await planSecrets(ctx);
    expect(result.secretChangeSet.updates).toHaveLength(0);
  });

  test("includes update when hash does not match", async () => {
    mockLoadSecretsState.mockReturnValue({
      version: 1,
      vaults: {
        "my-vault": {
          EXISTING_SECRET: hashValue("old-value"),
        },
      },
    });

    const client = createMockPlanClient(["EXISTING_SECRET"]);
    const ctx = createPlanContext(client, [
      {
        vaultName: "my-vault",
        secrets: [{ name: "EXISTING_SECRET", value: "new-value" }],
      },
    ]);

    const result = await planSecrets(ctx);
    expect(result.secretChangeSet.updates).toHaveLength(1);
    expect(result.secretChangeSet.updates[0].value).toBe("new-value");
  });

  test("includes update when no stored state exists", async () => {
    mockLoadSecretsState.mockReturnValue({ version: 1, vaults: {} });

    const client = createMockPlanClient(["EXISTING_SECRET"]);
    const ctx = createPlanContext(client, [
      {
        vaultName: "my-vault",
        secrets: [{ name: "EXISTING_SECRET", value: "some-value" }],
      },
    ]);

    const result = await planSecrets(ctx);
    expect(result.secretChangeSet.updates).toHaveLength(1);
  });
});

describe("applySecrets state persistence", () => {
  function createMockClient() {
    return {
      createSecretManagerVault: vi.fn().mockResolvedValue({}),
      createSecretManagerSecret: vi.fn().mockResolvedValue({}),
      updateSecretManagerSecret: vi.fn().mockResolvedValue({}),
      deleteSecretManagerSecret: vi.fn().mockResolvedValue({}),
    } as unknown as OperatorClient;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadSecretsState.mockReturnValue({ version: 1, vaults: {} });
  });

  test("saves hash state after create-update phase when application is provided", async () => {
    const client = createMockClient();
    const application = {
      secrets: [
        {
          vaultName: "my-vault",
          secrets: [
            { name: "SECRET_A", value: "value-a" },
            { name: "SECRET_B", value: "value-b" },
          ],
        },
      ],
    } as unknown as Application;

    const planResult = {
      vaultChangeSet: { creates: [], updates: [], deletes: [], replaces: [] },
      secretChangeSet: {
        creates: [
          {
            name: "my-vault/SECRET_A",
            secretName: "SECRET_A",
            workspaceId: "ws-1",
            vaultName: "my-vault",
            value: "value-a",
          },
        ],
        updates: [],
        deletes: [],
        replaces: [],
      },
    } as unknown as Awaited<ReturnType<typeof planSecrets>>;

    await applySecrets(client, planResult, "create-update", application);

    expect(mockSaveSecretsState).toHaveBeenCalledTimes(1);
    const savedState = mockSaveSecretsState.mock.calls[0][0];
    expect(savedState.vaults["my-vault"]["SECRET_A"]).toBe(hashValue("value-a"));
    expect(savedState.vaults["my-vault"]["SECRET_B"]).toBe(hashValue("value-b"));
  });

  test("does not save state when application is not provided", async () => {
    const client = createMockClient();
    const planResult = {
      vaultChangeSet: { creates: [], updates: [], deletes: [], replaces: [] },
      secretChangeSet: { creates: [], updates: [], deletes: [], replaces: [] },
    } as unknown as Awaited<ReturnType<typeof planSecrets>>;

    await applySecrets(client, planResult, "create-update");

    expect(mockSaveSecretsState).not.toHaveBeenCalled();
  });

  test("removes deleted secrets from state after delete phase", async () => {
    mockLoadSecretsState.mockReturnValue({
      version: 1,
      vaults: {
        "my-vault": {
          SECRET_A: hashValue("value-a"),
          ORPHAN: hashValue("orphan-value"),
        },
      },
    });

    const client = createMockClient();
    const planResult = {
      vaultChangeSet: { creates: [], updates: [], deletes: [], replaces: [] },
      secretChangeSet: {
        creates: [],
        updates: [],
        deletes: [
          {
            name: "my-vault/ORPHAN",
            secretName: "ORPHAN",
            workspaceId: "ws-1",
            vaultName: "my-vault",
          },
        ],
        replaces: [],
      },
    } as unknown as Awaited<ReturnType<typeof planSecrets>>;

    await applySecrets(client, planResult, "delete");

    expect(mockSaveSecretsState).toHaveBeenCalledTimes(1);
    const savedState = mockSaveSecretsState.mock.calls[0][0];
    expect(savedState.vaults["my-vault"]["SECRET_A"]).toBe(hashValue("value-a"));
    expect(savedState.vaults["my-vault"]["ORPHAN"]).toBeUndefined();
  });

  test("removes empty vault from state when all secrets deleted", async () => {
    mockLoadSecretsState.mockReturnValue({
      version: 1,
      vaults: {
        "my-vault": {
          ONLY_SECRET: hashValue("value"),
        },
      },
    });

    const client = createMockClient();
    const planResult = {
      vaultChangeSet: { creates: [], updates: [], deletes: [], replaces: [] },
      secretChangeSet: {
        creates: [],
        updates: [],
        deletes: [
          {
            name: "my-vault/ONLY_SECRET",
            secretName: "ONLY_SECRET",
            workspaceId: "ws-1",
            vaultName: "my-vault",
          },
        ],
        replaces: [],
      },
    } as unknown as Awaited<ReturnType<typeof planSecrets>>;

    await applySecrets(client, planResult, "delete");

    const savedState = mockSaveSecretsState.mock.calls[0][0];
    expect(savedState.vaults["my-vault"]).toBeUndefined();
  });
});
