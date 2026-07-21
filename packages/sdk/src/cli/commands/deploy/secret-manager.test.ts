import { describe, test, expect, vi, beforeEach } from "vitest";
import { applySecretManager, planSecretManager } from "./secret-manager";
import { hashValue } from "./secrets-state";
import type { PlanContext } from "#/cli/commands/deploy/types";
import type { Application } from "#/cli/services/application";
import type { OperatorClient } from "#/cli/shared/client";

const mockLoadSecretsState = vi.fn();
const mockSaveSecretsState = vi.fn();
const sdkVersion = "v1-0-0";
const stateScope = {
  workspaceId: "ws-1",
  applicationId: "app-1",
  applicationName: "test-app",
};

vi.mock("./secrets-state", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = (await importOriginal()) as typeof import("./secrets-state");
  return {
    ...actual,
    loadSecretsState: (...args: unknown[]) => mockLoadSecretsState(...args),
    saveSecretsState: (...args: unknown[]) => mockSaveSecretsState(...args),
    withSecretsStateLock: (_scope: unknown, fn: () => Promise<unknown>) => fn(),
  };
});

vi.mock("#/cli/shared/client", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = (await importOriginal()) as typeof import("#/cli/shared/client");
  return {
    ...actual,
    fetchAll: async <T>(fn: (pageToken: string, maxPageSize: number) => Promise<[T[], string]>) => {
      const [items] = await fn("", 100);
      return items;
    },
  };
});

vi.mock("./label", async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    buildMetaRequest: vi
      .fn()
      .mockImplementation(async (params: { trn: string; appName: string; appId?: string }) => ({
        trn: params.trn,
        labels: {
          "sdk-name": params.appName,
          "sdk-version": "v1-0-0",
          ...(params.appId ? { "sdk-app-id": `app-${params.appId}` } : {}),
        },
      })),
  };
});

function createMockApplyClient() {
  return {
    createSecretManagerVault: vi.fn().mockResolvedValue({}),
    createSecretManagerSecret: vi.fn().mockResolvedValue({}),
    updateSecretManagerSecret: vi.fn().mockResolvedValue({}),
    deleteSecretManagerSecret: vi.fn().mockResolvedValue({}),
    deleteSecretManagerVault: vi.fn().mockResolvedValue({}),
    setMetadata: vi.fn().mockResolvedValue({}),
  } as unknown as OperatorClient;
}

type ExistingSecretFixture =
  | string
  | { name: string; updateTime?: { seconds: bigint; nanos: number } };

function createMockPlanClient(
  existingSecrets: ExistingSecretFixture[] = [],
  vaultName = "my-vault",
) {
  return {
    listSecretManagerVaults: vi.fn().mockResolvedValue({
      vaults: [{ name: vaultName }],
      nextPageToken: "",
    }),
    getMetadata: vi.fn().mockResolvedValue({
      metadata: { labels: { "sdk-name": "test-app", "sdk-version": sdkVersion } },
    }),
    listSecretManagerSecrets: vi.fn().mockResolvedValue({
      secrets: existingSecrets.map((secret) =>
        typeof secret === "string" ? { name: secret } : secret,
      ),
      nextPageToken: "",
    }),
  } as unknown as OperatorClient;
}

function createPlanContext(
  client: OperatorClient,
  secrets: Array<{
    vaultName: string;
    secrets: Array<{ name: string; value: string | null | undefined }>;
  }>,
  overrides: {
    appName?: string;
    appId?: string;
    workspaceId?: string;
    forRemoval?: boolean;
  } = {},
): PlanContext {
  return {
    client,
    workspaceId: overrides.workspaceId ?? "ws-1",
    application: {
      name: overrides.appName ?? "test-app",
      id: overrides.appId ?? "app-1",
      secrets,
    } as unknown as Application,
    forRemoval: overrides.forRemoval ?? false,
    config: {} as PlanContext["config"],
  };
}

describe("applySecretManager phase separation", () => {
  function createMockPlanResult() {
    return {
      stateScope,
      vaultChangeSet: {
        creates: [{ name: "my-vault", workspaceId: "ws-1" }],
        updates: [],
        deletes: [],
        replaces: [],
        title: "Secret Manager vaults",
        isEmpty: () => false,
        lines: () => [],
      },
      secretChangeSet: {
        creates: [
          {
            name: "my-vault/new-secret",
            secretName: "new-secret",
            workspaceId: "ws-1",
            vaultName: "my-vault",
            value: "new-value",
          },
        ],
        updates: [
          {
            name: "my-vault/existing-secret",
            secretName: "existing-secret",
            workspaceId: "ws-1",
            vaultName: "my-vault",
            value: "updated-value",
          },
        ],
        deletes: [
          {
            name: "my-vault/orphan-secret",
            secretName: "orphan-secret",
            workspaceId: "ws-1",
            vaultName: "my-vault",
          },
        ],
        replaces: [],
        title: "Secret Manager secrets",
        isEmpty: () => false,
        lines: () => [],
      },
    } as unknown as Awaited<ReturnType<typeof planSecretManager>>;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadSecretsState.mockReturnValue({
      vaults: {
        "my-vault": {
          "orphan-secret": { hash: hashValue("orphan-value") },
        },
      },
    });
  });

  test("create-update phase creates vaults and secrets, does not delete", async () => {
    const client = createMockApplyClient();
    const planResult = createMockPlanResult();

    await applySecretManager(client, planResult, "create-update");

    expect(client.createSecretManagerVault).toHaveBeenCalledTimes(1);
    expect(client.createSecretManagerVault).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      secretmanagerVaultName: "my-vault",
    });

    expect(client.createSecretManagerSecret).toHaveBeenCalledTimes(1);
    expect(client.createSecretManagerSecret).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      secretmanagerVaultName: "my-vault",
      secretmanagerSecretName: "new-secret",
      secretmanagerSecretValue: "new-value",
    });

    expect(client.updateSecretManagerSecret).toHaveBeenCalledTimes(1);
    expect(client.updateSecretManagerSecret).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      secretmanagerVaultName: "my-vault",
      secretmanagerSecretName: "existing-secret",
      secretmanagerSecretValue: "updated-value",
    });

    expect(client.deleteSecretManagerSecret).not.toHaveBeenCalled();
  });

  test("delete phase deletes orphan secrets, does not create or update", async () => {
    const client = createMockApplyClient();
    const planResult = createMockPlanResult();

    await applySecretManager(client, planResult, "delete");

    expect(client.createSecretManagerVault).not.toHaveBeenCalled();
    expect(client.createSecretManagerSecret).not.toHaveBeenCalled();
    expect(client.updateSecretManagerSecret).not.toHaveBeenCalled();

    expect(client.deleteSecretManagerSecret).toHaveBeenCalledTimes(1);
    expect(client.deleteSecretManagerSecret).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      secretmanagerVaultName: "my-vault",
      secretmanagerSecretName: "orphan-secret",
    });
  });

  test("empty plan result does nothing", async () => {
    const client = createMockApplyClient();
    const emptyResult = {
      vaultChangeSet: {
        creates: [],
        updates: [],
        deletes: [],
        replaces: [],
        title: "Secret Manager vaults",
        isEmpty: () => true,
        lines: () => [],
      },
      secretChangeSet: {
        creates: [],
        updates: [],
        deletes: [],
        replaces: [],
        title: "Secret Manager secrets",
        isEmpty: () => true,
        lines: () => [],
      },
    } as unknown as Awaited<ReturnType<typeof planSecretManager>>;

    await applySecretManager(client, emptyResult, "create-update");

    expect(client.createSecretManagerVault).not.toHaveBeenCalled();
    expect(client.createSecretManagerSecret).not.toHaveBeenCalled();
    expect(client.updateSecretManagerSecret).not.toHaveBeenCalled();
    expect(client.deleteSecretManagerSecret).not.toHaveBeenCalled();
  });
});

describe("planSecretManager hash-based diff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadSecretsState.mockReturnValue({ vaults: {} });
  });

  test("includes update when forceApplyAll is enabled even if evidence matches", async () => {
    const secretValue = "my-secret-value";
    mockLoadSecretsState.mockReturnValue({
      vaults: {
        "my-vault": { "existing-secret": { hash: hashValue(secretValue), updateTime: "100.5" } },
      },
    });

    const client = createMockPlanClient([
      { name: "existing-secret", updateTime: { seconds: 100n, nanos: 5 } },
    ]);
    const ctx = {
      ...createPlanContext(client, [
        { vaultName: "my-vault", secrets: [{ name: "existing-secret", value: secretValue }] },
      ]),
      forceApplyAll: true,
    };

    const result = await planSecretManager(ctx);
    expect(result.secretChangeSet.updates).toHaveLength(1);
  });

  test("includes update when hash does not match", async () => {
    mockLoadSecretsState.mockReturnValue({
      vaults: {
        "my-vault": { "existing-secret": { hash: hashValue("old-value"), updateTime: "100.5" } },
      },
    });

    const client = createMockPlanClient([
      { name: "existing-secret", updateTime: { seconds: 100n, nanos: 5 } },
    ]);
    const ctx = createPlanContext(client, [
      { vaultName: "my-vault", secrets: [{ name: "existing-secret", value: "new-value" }] },
    ]);

    const result = await planSecretManager(ctx);
    expect(result.secretChangeSet.updates).toHaveLength(1);
    expect(result.secretChangeSet.updates[0]!.value).toBe("new-value");
  });

  test("includes update when no stored state exists", async () => {
    mockLoadSecretsState.mockReturnValue({ vaults: {} });

    const client = createMockPlanClient(["existing-secret"]);
    const ctx = createPlanContext(client, [
      { vaultName: "my-vault", secrets: [{ name: "existing-secret", value: "some-value" }] },
    ]);

    const result = await planSecretManager(ctx);
    expect(result.secretChangeSet.updates).toHaveLength(1);
  });

  test("includes update when matching state belongs to another workspace", async () => {
    const secretValue = "my-secret-value";
    mockLoadSecretsState.mockImplementation((scope?: { workspaceId: string }) =>
      scope?.workspaceId === "ws-a"
        ? {
            vaults: {
              "my-vault": {
                "existing-secret": { hash: hashValue(secretValue), updateTime: "100.5" },
              },
            },
          }
        : { vaults: {} },
    );
    const client = createMockPlanClient([
      { name: "existing-secret", updateTime: { seconds: 100n, nanos: 5 } },
    ]);
    const ctxA = createPlanContext(
      client,
      [{ vaultName: "my-vault", secrets: [{ name: "existing-secret", value: secretValue }] }],
      { workspaceId: "ws-a", appId: "shared-app-id" },
    );
    const ctxB = createPlanContext(
      client,
      [{ vaultName: "my-vault", secrets: [{ name: "existing-secret", value: secretValue }] }],
      { workspaceId: "ws-b", appId: "shared-app-id" },
    );

    const resultA = await planSecretManager(ctxA);
    const resultB = await planSecretManager(ctxB);

    expect(resultA.secretChangeSet.updates).toHaveLength(0);
    expect(resultB.secretChangeSet.updates).toHaveLength(1);
    expect(mockLoadSecretsState).toHaveBeenCalledWith({
      workspaceId: "ws-b",
      applicationId: "shared-app-id",
      applicationName: "test-app",
    });
  });

  test("includes update when matching state belongs to another application", async () => {
    const secretValue = "my-secret-value";
    mockLoadSecretsState.mockImplementation((scope?: { applicationId: string }) =>
      scope?.applicationId === "app-a"
        ? {
            vaults: {
              "my-vault": {
                "existing-secret": { hash: hashValue(secretValue), updateTime: "100.5" },
              },
            },
          }
        : { vaults: {} },
    );
    const client = createMockPlanClient([
      { name: "existing-secret", updateTime: { seconds: 100n, nanos: 5 } },
    ]);
    const ctxA = createPlanContext(
      client,
      [{ vaultName: "my-vault", secrets: [{ name: "existing-secret", value: secretValue }] }],
      { appName: "shared-app", appId: "app-a" },
    );
    const ctxB = createPlanContext(
      client,
      [{ vaultName: "my-vault", secrets: [{ name: "existing-secret", value: secretValue }] }],
      { appName: "shared-app", appId: "app-b" },
    );

    const resultA = await planSecretManager(ctxA);
    const resultB = await planSecretManager(ctxB);

    expect(resultA.secretChangeSet.updates).toHaveLength(0);
    expect(resultB.secretChangeSet.updates).toHaveLength(1);
    expect(mockLoadSecretsState).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      applicationId: "app-b",
      applicationName: "shared-app",
    });
  });
});

describe("planSecretManager update-time evidence", () => {
  const secretValue = "my-secret-value";
  const storedEntry = { hash: hashValue(secretValue), updateTime: "100.5" };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("skips update when hash and remote updateTime both match stored evidence", async () => {
    mockLoadSecretsState.mockReturnValue({
      vaults: { "my-vault": { "existing-secret": storedEntry } },
    });
    const client = createMockPlanClient([
      { name: "existing-secret", updateTime: { seconds: 100n, nanos: 5 } },
    ]);
    const ctx = createPlanContext(client, [
      { vaultName: "my-vault", secrets: [{ name: "existing-secret", value: secretValue }] },
    ]);

    const result = await planSecretManager(ctx);
    expect(result.secretChangeSet.updates).toHaveLength(0);
  });

  test("updates when the remote updateTime differs from stored evidence", async () => {
    mockLoadSecretsState.mockReturnValue({
      vaults: { "my-vault": { "existing-secret": storedEntry } },
    });
    const client = createMockPlanClient([
      { name: "existing-secret", updateTime: { seconds: 200n, nanos: 0 } },
    ]);
    const ctx = createPlanContext(client, [
      { vaultName: "my-vault", secrets: [{ name: "existing-secret", value: secretValue }] },
    ]);

    const result = await planSecretManager(ctx);
    expect(result.secretChangeSet.updates).toHaveLength(1);
  });

  test("updates when the stored entry has no updateTime evidence", async () => {
    mockLoadSecretsState.mockReturnValue({
      vaults: { "my-vault": { "existing-secret": { hash: hashValue(secretValue) } } },
    });
    const client = createMockPlanClient([
      { name: "existing-secret", updateTime: { seconds: 100n, nanos: 5 } },
    ]);
    const ctx = createPlanContext(client, [
      { vaultName: "my-vault", secrets: [{ name: "existing-secret", value: secretValue }] },
    ]);

    const result = await planSecretManager(ctx);
    expect(result.secretChangeSet.updates).toHaveLength(1);
  });

  test("updates when the remote secret carries no updateTime", async () => {
    mockLoadSecretsState.mockReturnValue({
      vaults: { "my-vault": { "existing-secret": storedEntry } },
    });
    const client = createMockPlanClient(["existing-secret"]);
    const ctx = createPlanContext(client, [
      { vaultName: "my-vault", secrets: [{ name: "existing-secret", value: secretValue }] },
    ]);

    const result = await planSecretManager(ctx);
    expect(result.secretChangeSet.updates).toHaveLength(1);
  });
});

describe("applySecretManager update-time evidence persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadSecretsState.mockReturnValue({ vaults: {} });
  });

  function evidencePlanResult() {
    return {
      stateScope,
      vaultChangeSet: { creates: [], updates: [], deletes: [], replaces: [] },
      secretChangeSet: {
        creates: [
          {
            name: "my-vault/secret-a",
            secretName: "secret-a",
            workspaceId: "ws-1",
            vaultName: "my-vault",
            value: "value-a",
          },
        ],
        updates: [
          {
            name: "my-vault/secret-b",
            secretName: "secret-b",
            workspaceId: "ws-1",
            vaultName: "my-vault",
            value: "value-b",
          },
        ],
        deletes: [],
        replaces: [],
      },
    } as unknown as Awaited<ReturnType<typeof planSecretManager>>;
  }

  test("stores updateTime evidence from create and update responses", async () => {
    const client = {
      ...createMockApplyClient(),
      createSecretManagerSecret: vi.fn().mockResolvedValue({
        secret: { name: "secret-a", updateTime: { seconds: 10n, nanos: 1 } },
      }),
      updateSecretManagerSecret: vi.fn().mockResolvedValue({
        secret: { name: "secret-b", updateTime: { seconds: 20n, nanos: 2 } },
      }),
    } as unknown as OperatorClient;
    const application = { secrets: [] } as unknown as Application;

    await applySecretManager(client, evidencePlanResult(), "create-update", application);

    const savedState = mockSaveSecretsState.mock.calls[0]![1];
    expect(savedState.vaults["my-vault"]["secret-a"]).toEqual({
      hash: hashValue("value-a"),
      updateTime: "10.1",
    });
    expect(savedState.vaults["my-vault"]["secret-b"]).toEqual({
      hash: hashValue("value-b"),
      updateTime: "20.2",
    });
  });

  test("stores hash without evidence when a create response is empty", async () => {
    const client = createMockApplyClient();
    const application = { secrets: [] } as unknown as Application;

    await applySecretManager(client, evidencePlanResult(), "create-update", application);

    const savedState = mockSaveSecretsState.mock.calls[0]![1];
    expect(savedState.vaults["my-vault"]["secret-a"]).toEqual({ hash: hashValue("value-a") });
    expect(savedState.vaults["my-vault"]["secret-b"]).toEqual({ hash: hashValue("value-b") });
  });
});

describe("planSecretManager vault metadata and deletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadSecretsState.mockReturnValue({ vaults: {} });
  });

  test("plans vault deletion for managed vaults removed from config", async () => {
    const client = {
      listSecretManagerVaults: vi.fn().mockResolvedValue({
        vaults: [{ name: "kept-vault" }, { name: "removed-vault" }],
        nextPageToken: "",
      }),
      getMetadata: vi.fn().mockResolvedValue({
        metadata: { labels: { "sdk-name": "my-app", "sdk-version": sdkVersion } },
      }),
      listSecretManagerSecrets: vi.fn().mockResolvedValue({
        secrets: [{ name: "secret-in-removed" }],
        nextPageToken: "",
      }),
    } as unknown as OperatorClient;

    const ctx = createPlanContext(
      client,
      [{ vaultName: "kept-vault", secrets: [{ name: "app-key", value: "val" }] }],
      { appName: "my-app" },
    );

    const result = await planSecretManager(ctx);

    expect(result.vaultChangeSet.deletes).toHaveLength(1);
    expect(result.vaultChangeSet.deletes[0]!.name).toBe("removed-vault");
    expect(result.secretChangeSet.deletes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          secretName: "secret-in-removed",
          vaultName: "removed-vault",
        }),
      ]),
    );
  });

  test("does not delete vaults managed by another application", async () => {
    const client = {
      listSecretManagerVaults: vi.fn().mockResolvedValue({
        vaults: [{ name: "other-vault" }],
        nextPageToken: "",
      }),
      getMetadata: vi.fn().mockResolvedValue({
        metadata: { labels: { "sdk-name": "other-app", "sdk-version": sdkVersion } },
      }),
      listSecretManagerSecrets: vi.fn().mockResolvedValue({ secrets: [], nextPageToken: "" }),
    } as unknown as OperatorClient;

    const ctx = createPlanContext(client, [], { appName: "my-app" });

    const result = await planSecretManager(ctx);

    expect(result.vaultChangeSet.deletes).toHaveLength(0);
    expect(result.resourceOwners).toContain("other-app");
  });

  test("treats matching managed vault as unchanged", async () => {
    const client = {
      listSecretManagerVaults: vi.fn().mockResolvedValue({
        vaults: [{ name: "my-vault" }],
        nextPageToken: "",
      }),
      getMetadata: vi.fn().mockResolvedValue({
        metadata: { labels: { "sdk-name": "my-app", "sdk-version": sdkVersion } },
      }),
      listSecretManagerSecrets: vi.fn().mockResolvedValue({ secrets: [], nextPageToken: "" }),
    } as unknown as OperatorClient;

    const ctx = createPlanContext(
      client,
      [{ vaultName: "my-vault", secrets: [{ name: "app-key", value: "val" }] }],
      { appName: "my-app" },
    );

    const result = await planSecretManager(ctx);

    expect(result.vaultChangeSet.unchanged).toHaveLength(1);
    expect(result.vaultChangeSet.unchanged[0]!.name).toBe("my-vault");
    expect(result.vaultChangeSet.creates).toHaveLength(0);
  });

  test("updates matching managed vault when forceApplyAll is enabled", async () => {
    const client = {
      listSecretManagerVaults: vi.fn().mockResolvedValue({
        vaults: [{ name: "my-vault" }],
        nextPageToken: "",
      }),
      getMetadata: vi.fn().mockResolvedValue({
        metadata: { labels: { "sdk-name": "my-app", "sdk-version": sdkVersion } },
      }),
      listSecretManagerSecrets: vi.fn().mockResolvedValue({ secrets: [], nextPageToken: "" }),
    } as unknown as OperatorClient;

    const ctx = {
      ...createPlanContext(
        client,
        [{ vaultName: "my-vault", secrets: [{ name: "app-key", value: "val" }] }],
        { appName: "my-app" },
      ),
      forceApplyAll: true,
    };

    const result = await planSecretManager(ctx);

    expect(result.vaultChangeSet.updates).toHaveLength(0);
    expect(result.vaultChangeSet.unchanged).toHaveLength(1);
  });

  test("detects unmanaged vault without metadata label", async () => {
    const client = {
      listSecretManagerVaults: vi.fn().mockResolvedValue({
        vaults: [{ name: "my-vault" }],
        nextPageToken: "",
      }),
      getMetadata: vi.fn().mockResolvedValue({ metadata: { labels: {} } }),
      listSecretManagerSecrets: vi.fn().mockResolvedValue({ secrets: [], nextPageToken: "" }),
    } as unknown as OperatorClient;

    const ctx = createPlanContext(
      client,
      [{ vaultName: "my-vault", secrets: [{ name: "app-key", value: "val" }] }],
      { appName: "my-app" },
    );

    const result = await planSecretManager(ctx);

    expect(result.unmanaged).toEqual([
      { resourceType: "Secret Manager vault", resourceName: "my-vault" },
    ]);
  });

  test("detects ownership conflict when vault owned by another app", async () => {
    const client = {
      listSecretManagerVaults: vi.fn().mockResolvedValue({
        vaults: [{ name: "my-vault" }],
        nextPageToken: "",
      }),
      getMetadata: vi.fn().mockResolvedValue({
        metadata: { labels: { "sdk-name": "other-app", "sdk-version": sdkVersion } },
      }),
      listSecretManagerSecrets: vi.fn().mockResolvedValue({ secrets: [], nextPageToken: "" }),
    } as unknown as OperatorClient;

    const ctx = createPlanContext(
      client,
      [{ vaultName: "my-vault", secrets: [{ name: "app-key", value: "val" }] }],
      { appName: "my-app" },
    );

    const result = await planSecretManager(ctx);

    expect(result.conflicts).toEqual([
      {
        resourceType: "Secret Manager vault",
        resourceName: "my-vault",
        currentOwner: "other-app",
      },
    ]);
  });
});

describe("applySecretManager metadata update", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadSecretsState.mockReturnValue({ vaults: {} });
  });

  test("sets metadata on existing vault during create-update phase", async () => {
    const client = createMockApplyClient();
    const application = {
      name: "my-app",
      secrets: [{ vaultName: "existing-vault", secrets: [] }],
    } as unknown as Application;

    const planResult = {
      vaultChangeSet: {
        creates: [],
        updates: [{ name: "existing-vault", workspaceId: "ws-1" }],
        deletes: [],
        replaces: [],
      },
      secretChangeSet: { creates: [], updates: [], deletes: [], replaces: [] },
    } as unknown as Awaited<ReturnType<typeof planSecretManager>>;

    await applySecretManager(client, planResult, "create-update", application);

    expect(client.setMetadata).toHaveBeenCalledTimes(1);
    expect(client.setMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        trn: "trn:v1:workspace:ws-1:vault:existing-vault",
        labels: expect.objectContaining({ "sdk-name": "my-app" }),
      }),
    );
  });

  test("delete phase deletes vault and its secrets", async () => {
    const client = createMockApplyClient();

    const planResult = {
      vaultChangeSet: {
        creates: [],
        updates: [],
        deletes: [{ name: "removed-vault", workspaceId: "ws-1" }],
        replaces: [],
      },
      secretChangeSet: {
        creates: [],
        updates: [],
        deletes: [
          {
            name: "removed-vault/secret-a",
            secretName: "secret-a",
            workspaceId: "ws-1",
            vaultName: "removed-vault",
          },
        ],
        replaces: [],
      },
    } as unknown as Awaited<ReturnType<typeof planSecretManager>>;

    await applySecretManager(client, planResult, "delete");

    expect(client.deleteSecretManagerSecret).toHaveBeenCalledTimes(1);
    expect(client.deleteSecretManagerSecret).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      secretmanagerVaultName: "removed-vault",
      secretmanagerSecretName: "secret-a",
    });
    expect(client.deleteSecretManagerVault).toHaveBeenCalledTimes(1);
    expect(client.deleteSecretManagerVault).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      secretmanagerVaultName: "removed-vault",
    });
  });
});

describe("applySecretManager state persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadSecretsState.mockReturnValue({ vaults: {} });
  });

  test("saves hashes for secret values created or updated during apply", async () => {
    const client = createMockApplyClient();
    const application = {
      secrets: [
        {
          vaultName: "my-vault",
          secrets: [
            { name: "secret-a", value: "value-a" },
            { name: "secret-b", value: "value-b" },
          ],
        },
      ],
    } as unknown as Application;

    const planResult = {
      stateScope,
      vaultChangeSet: { creates: [], updates: [], deletes: [], replaces: [] },
      secretChangeSet: {
        creates: [
          {
            name: "my-vault/secret-a",
            secretName: "secret-a",
            workspaceId: "ws-1",
            vaultName: "my-vault",
            value: "value-a",
          },
        ],
        updates: [
          {
            name: "my-vault/secret-b",
            secretName: "secret-b",
            workspaceId: "ws-1",
            vaultName: "my-vault",
            value: "value-b",
          },
        ],
        deletes: [],
        replaces: [],
      },
    } as unknown as Awaited<ReturnType<typeof planSecretManager>>;

    await applySecretManager(client, planResult, "create-update", application);

    expect(mockSaveSecretsState).toHaveBeenCalledTimes(1);
    const savedState = mockSaveSecretsState.mock.calls[0]![1];
    expect(savedState.vaults["my-vault"]["secret-a"]).toEqual({ hash: hashValue("value-a") });
    expect(savedState.vaults["my-vault"]["secret-b"]).toEqual({ hash: hashValue("value-b") });
  });

  test("does not save state when application is not provided", async () => {
    const client = createMockApplyClient();
    const planResult = {
      stateScope,
      vaultChangeSet: { creates: [], updates: [], deletes: [], replaces: [] },
      secretChangeSet: { creates: [], updates: [], deletes: [], replaces: [] },
    } as unknown as Awaited<ReturnType<typeof planSecretManager>>;

    await applySecretManager(client, planResult, "create-update");

    expect(mockSaveSecretsState).not.toHaveBeenCalled();
  });

  test("does not save state when no secret values were created or updated", async () => {
    const client = createMockApplyClient();
    const application = {
      secrets: [],
    } as unknown as Application;
    const planResult = {
      stateScope,
      vaultChangeSet: { creates: [], updates: [], deletes: [], replaces: [] },
      secretChangeSet: { creates: [], updates: [], deletes: [], replaces: [] },
    } as unknown as Awaited<ReturnType<typeof planSecretManager>>;

    await applySecretManager(client, planResult, "create-update", application);

    expect(mockLoadSecretsState).not.toHaveBeenCalled();
    expect(mockSaveSecretsState).not.toHaveBeenCalled();
  });

  test("removes deleted secrets from state after delete phase", async () => {
    mockLoadSecretsState.mockReturnValue({
      vaults: {
        "my-vault": {
          "secret-a": { hash: hashValue("value-a") },
          orphan: { hash: hashValue("orphan-value") },
        },
      },
    });

    const client = createMockApplyClient();
    const planResult = {
      stateScope,
      vaultChangeSet: { creates: [], updates: [], deletes: [], replaces: [] },
      secretChangeSet: {
        creates: [],
        updates: [],
        deletes: [
          {
            name: "my-vault/orphan",
            secretName: "orphan",
            workspaceId: "ws-1",
            vaultName: "my-vault",
          },
        ],
        replaces: [],
      },
    } as unknown as Awaited<ReturnType<typeof planSecretManager>>;

    await applySecretManager(client, planResult, "delete");

    expect(mockSaveSecretsState).toHaveBeenCalledTimes(1);
    const savedState = mockSaveSecretsState.mock.calls[0]![1];
    expect(savedState.vaults["my-vault"]["secret-a"]).toEqual({ hash: hashValue("value-a") });
    expect(savedState.vaults["my-vault"]["orphan"]).toBeUndefined();
  });

  test("removes empty vault from state when all secrets deleted", async () => {
    mockLoadSecretsState.mockReturnValue({
      vaults: {
        "my-vault": {
          "only-secret": { hash: hashValue("value") },
        },
      },
    });

    const client = createMockApplyClient();
    const planResult = {
      stateScope,
      vaultChangeSet: { creates: [], updates: [], deletes: [], replaces: [] },
      secretChangeSet: {
        creates: [],
        updates: [],
        deletes: [
          {
            name: "my-vault/only-secret",
            secretName: "only-secret",
            workspaceId: "ws-1",
            vaultName: "my-vault",
          },
        ],
        replaces: [],
      },
    } as unknown as Awaited<ReturnType<typeof planSecretManager>>;

    await applySecretManager(client, planResult, "delete");

    const savedState = mockSaveSecretsState.mock.calls[0]![1];
    expect(savedState.vaults["my-vault"]).toBeUndefined();
  });
});

describe("planSecretManager ignoreNullishValues", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadSecretsState.mockReturnValue({ vaults: {} });
  });

  test.each([
    {
      name: "undefined value on a secret missing from the platform",
      value: undefined,
      existingSecrets: [],
      secretName: "missing-secret",
    },
    {
      name: "undefined value on an existing secret",
      value: undefined,
      existingSecrets: ["existing-secret"],
      secretName: "existing-secret",
    },
    {
      name: "null value on an existing secret",
      value: null,
      existingSecrets: ["existing-secret"],
      secretName: "existing-secret",
    },
  ] satisfies Array<{
    name: string;
    value: string | null | undefined;
    existingSecrets: string[];
    secretName: string;
  }>)(
    "nullish secret ($name) is skipped, not created/updated/deleted",
    async ({ value, existingSecrets, secretName }) => {
      const client = createMockPlanClient(existingSecrets);
      const ctx = createPlanContext(client, [
        { vaultName: "my-vault", secrets: [{ name: secretName, value }] },
      ]);

      const result = await planSecretManager(ctx);

      expect(result.secretChangeSet.creates).toHaveLength(0);
      expect(result.secretChangeSet.updates).toHaveLength(0);
      expect(result.secretChangeSet.deletes).toHaveLength(0);
      expect(result.skippedSecrets).toEqual([`my-vault/${secretName}`]);
    },
  );

  test("mixed valued and nullish secrets are handled correctly", async () => {
    const client = createMockPlanClient(["existing-secret"]);
    const ctx = createPlanContext(client, [
      {
        vaultName: "my-vault",
        secrets: [
          { name: "existing-secret", value: undefined },
          { name: "new-secret", value: "new-value" },
        ],
      },
    ]);

    const result = await planSecretManager(ctx);

    expect(result.secretChangeSet.creates).toHaveLength(1);
    expect(result.secretChangeSet.creates[0]!.secretName).toBe("new-secret");
    expect(result.secretChangeSet.updates).toHaveLength(0);
    expect(result.secretChangeSet.deletes).toHaveLength(0);
    expect(result.skippedSecrets).toEqual(["my-vault/existing-secret"]);
  });
});

describe("applySecretManager ignoreNullishValues state persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadSecretsState.mockReturnValue({
      vaults: {
        "my-vault": {
          "nullish-secret": { hash: hashValue("previous-value") },
        },
      },
    });
  });

  test("nullish secret does not overwrite stored hash", async () => {
    const client = createMockApplyClient();
    const application = {
      secrets: [
        {
          vaultName: "my-vault",
          secrets: [
            { name: "nullish-secret", value: undefined },
            { name: "valued-secret", value: "real-value" },
          ],
        },
      ],
    } as unknown as Application;

    const planResult = {
      stateScope,
      vaultChangeSet: { creates: [], updates: [], deletes: [], replaces: [] },
      secretChangeSet: {
        creates: [
          {
            name: "my-vault/valued-secret",
            secretName: "valued-secret",
            workspaceId: "ws-1",
            vaultName: "my-vault",
            value: "real-value",
          },
        ],
        updates: [],
        deletes: [],
        replaces: [],
      },
    } as unknown as Awaited<ReturnType<typeof planSecretManager>>;

    await applySecretManager(client, planResult, "create-update", application);

    expect(mockSaveSecretsState).toHaveBeenCalledTimes(1);
    const savedState = mockSaveSecretsState.mock.calls[0]![1];
    expect(savedState.vaults["my-vault"]["nullish-secret"]).toEqual({
      hash: hashValue("previous-value"),
    });
    expect(savedState.vaults["my-vault"]["valued-secret"]).toEqual({
      hash: hashValue("real-value"),
    });
  });
});
