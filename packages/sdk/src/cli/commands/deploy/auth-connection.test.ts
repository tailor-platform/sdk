// oxlint-disable local/typed-operator-client-mock -- Untyped mocks; migrate them to mockOperatorClient() when editing them.
import { AuthConnection_Status } from "@tailor-platform/tailor-proto/auth_resource_pb";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { applyAuthConnections, planAuthConnections } from "./auth-connection";
import type { AuthService } from "#/cli/services/auth/service";
import type { OperatorClient } from "#/cli/shared/client";
import type { AuthConnectionConfig } from "#/types/auth-connection.generated";
import type { SecretsStateScope } from "./secrets-state";

const { mockLoggerWarn, mockLoggerInfo, mockSaveSecretsState } = vi.hoisted(() => ({
  mockLoggerWarn: vi.fn(),
  mockLoggerInfo: vi.fn(),
  mockSaveSecretsState: vi.fn(),
}));

vi.mock("#/cli/shared/logger", () => ({
  logger: {
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
    info: (...args: unknown[]) => mockLoggerInfo(...args),
    registerSecret: () => {},
  },
}));

const mockLoadSecretsState = vi.fn();

vi.mock("./secrets-state", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import("./secrets-state")>();
  return {
    ...actual,
    loadSecretsState: (...args: unknown[]) => mockLoadSecretsState(...args),
    saveSecretsState: (...args: unknown[]) => mockSaveSecretsState(...args),
    withSecretsStateLock: (_scope: unknown, fn: () => Promise<unknown>) => fn(),
    // Deterministic hash so tests can pin the "unchanged" secret state.
    hashValue: () => "fixed-hash",
  };
});

vi.mock("#/cli/shared/client", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import("#/cli/shared/client")>();
  return {
    ...actual,
    fetchAll: async <T>(fn: (pageToken: string, maxPageSize: number) => Promise<[T[], string]>) => {
      const [items] = await fn("", 100);
      return items;
    },
  };
});

vi.mock("./label", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import("./label")>();
  return {
    ...actual,
    buildMetaRequest: vi
      .fn()
      .mockImplementation(async (params: { trn: string; appName: string; appId?: string }) => ({
        trn: params.trn,
        labels: { "sdk-name": params.appName, "sdk-version": "v1-0-0" },
      })),
  };
});

const workspaceId = "ws-1";
const appName = "my-app";
const configPath = "/proj/app/tailor.config.ts";

function connectionStateScope(
  overrides: Partial<Pick<SecretsStateScope, "workspaceId" | "applicationId">> = {},
): SecretsStateScope {
  return {
    workspaceId: overrides.workspaceId ?? workspaceId,
    applicationId: overrides.applicationId,
    applicationName: appName,
    configPath,
  };
}

type ConnectionFixture = {
  name: string;
  /** sdk-name label value when the connection carries SDK metadata */
  ownerLabel?: string;
  /** sdk-app-id label value when the connection was tagged with an app id */
  appIdLabel?: string;
  /** sdk-version label value of a connection carrying SDK metadata; defaults to the planned one */
  sdkVersion?: string;
};

const oauth2DesiredConfig: AuthConnectionConfig = {
  type: "oauth2",
  providerUrl: "https://idp.example.com",
  issuerUrl: "https://idp.example.com",
  clientId: "client-id",
  clientSecret: "client-secret",
};

function oauth2Connection(name: string) {
  return {
    name,
    config: {
      case: "oauth2" as const,
      value: {
        providerUrl: "https://idp.example.com",
        issuerUrl: "https://idp.example.com",
        clientId: "client-id",
        authUrl: "",
        tokenUrl: "",
      },
    },
  };
}

function createMockClient(opts: { connections: ConnectionFixture[] }): OperatorClient {
  return {
    listAuthConnections: vi.fn().mockResolvedValue({
      connections: opts.connections.map((c) => oauth2Connection(c.name)),
      nextPageToken: "",
    }),
    getMetadata: vi.fn().mockImplementation(({ trn }: { trn: string }) => {
      const name = trn.split(":").pop();
      const fixture = opts.connections.find((c) => c.name === name);
      return {
        metadata: {
          labels: {
            ...(fixture?.ownerLabel
              ? { "sdk-name": fixture.ownerLabel, "sdk-version": fixture.sdkVersion ?? "v1-0-0" }
              : {}),
            ...(fixture?.appIdLabel ? { "sdk-app-id": fixture.appIdLabel } : {}),
          },
        },
      };
    }),
    setMetadata: vi.fn().mockResolvedValue({}),
    createAuthConnection: vi.fn().mockResolvedValue({}),
    updateAuthConnection: vi
      .fn()
      .mockResolvedValue({ connection: { status: AuthConnection_Status.AUTHORIZED } }),
    deleteAuthConnection: vi.fn().mockResolvedValue({}),
  } as unknown as OperatorClient;
}

/** Auth service with no desired connections, so every existing one is a deletion candidate. */
const emptyAuths: ReadonlyArray<Readonly<AuthService>> = [
  { name: "auth-a", connections: {} } as unknown as AuthService,
];

// Auth service whose desired connections match `oauth2Connection`'s non-secret fields.
function authsWith(names: string[]): ReadonlyArray<Readonly<AuthService>> {
  const connections: Record<string, AuthConnectionConfig> = {};
  for (const name of names) {
    connections[name] = oauth2DesiredConfig;
  }
  return [{ name: "auth-a", connections } as unknown as AuthService];
}

aroundEach(async (runTest) => {
  mockLoadSecretsState.mockReset();
  mockLoadSecretsState.mockReturnValue({ vaults: {}, connections: {} });
  await runTest();
});

describe("planAuthConnections", () => {
  test("uses label ownership: deletes app-owned connections and keeps others", async () => {
    const client = createMockClient({
      connections: [
        { name: "owned-connection", ownerLabel: appName },
        { name: "other-app-connection", ownerLabel: "other-app" },
        { name: "unmanaged-connection" },
      ],
    });

    const { changeSet, resourceOwners } = await planAuthConnections(
      client,
      connectionStateScope(),
      emptyAuths,
    );

    expect(changeSet.deletes.map((d) => d.name)).toEqual(["owned-connection"]);
    expect(resourceOwners.has("other-app")).toBe(true);
  });

  test("addresses connections via the `auth_connection` TRN segment", async () => {
    const client = createMockClient({
      connections: [{ name: "owned-connection", ownerLabel: appName }],
    });

    await planAuthConnections(client, connectionStateScope(), emptyAuths);

    const trns = vi
      .mocked(client.getMetadata)
      .mock.calls.map(([req]) => (req as { trn: string }).trn);
    expect(trns).toContain(`trn:v1:workspace:${workspaceId}:auth_connection:owned-connection`);
  });

  test("backfills the SDK label for an unmanaged connection that is otherwise unchanged", async () => {
    // The connection exists, has no SDK label, and its config (incl. secret)
    // matches the desired state, so it would otherwise be a no-op.
    mockLoadSecretsState.mockReturnValue({
      vaults: {},
      connections: { "adopted-connection": "fixed-hash" },
    });
    const client = createMockClient({
      connections: [{ name: "adopted-connection" }],
    });

    const result = await planAuthConnections(
      client,
      connectionStateScope(),
      authsWith(["adopted-connection"]),
    );
    const { changeSet, unmanaged } = result;

    expect(unmanaged).toEqual([
      {
        resourceType: "auth.connection",
        resourceLabel: "Auth connection",
        resourceName: "adopted-connection",
      },
    ]);
    expect(changeSet.updates.map((u) => u.name)).toEqual(["adopted-connection"]);
    expect(changeSet.unchanged.map((u) => u.name)).toEqual([]);

    await applyAuthConnections(client, result, "create-update");

    expect(client.updateAuthConnection).not.toHaveBeenCalled();
    expect(client.setMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        trn: `trn:v1:workspace:${workspaceId}:auth_connection:adopted-connection`,
      }),
    );
  });

  test("re-tags an unchanged connection whose recorded id does not match", async () => {
    // The conflict is reported, so the user is asked to take the connection over.
    // Unless the plan also writes the labels, accepting changes nothing and the
    // same question comes back on the next deploy.
    mockLoadSecretsState.mockReturnValue({
      vaults: {},
      connections: { "owned-connection": "fixed-hash" },
    });
    const client = createMockClient({
      connections: [{ name: "owned-connection", ownerLabel: appName, appIdLabel: "app-id-1" }],
    });

    const { changeSet, conflicts } = await planAuthConnections(
      client,
      connectionStateScope({ applicationId: "id-2" }),
      authsWith(["owned-connection"]),
    );

    expect(conflicts.map((c) => c.resourceName)).toEqual(["owned-connection"]);
    expect(changeSet.updates.map((u) => u.name)).toEqual(["owned-connection"]);
    expect(changeSet.unchanged.map((u) => u.name)).toEqual([]);
  });

  test("leaves an already-owned unchanged connection untouched", async () => {
    mockLoadSecretsState.mockReturnValue({
      vaults: {},
      connections: { "owned-connection": "fixed-hash" },
    });
    const client = createMockClient({
      connections: [{ name: "owned-connection", ownerLabel: appName }],
    });

    const { changeSet, unmanaged } = await planAuthConnections(
      client,
      connectionStateScope(),
      authsWith(["owned-connection"]),
    );

    expect(changeSet.unchanged).toEqual([{ name: "owned-connection" }]);
    expect(changeSet.updates.map((u) => u.name)).toEqual([]);
    expect(unmanaged.map((u) => u.resourceName)).toEqual([]);
  });

  test("refreshes only the labels of an owned unchanged connection applied by another SDK version", async () => {
    mockLoadSecretsState.mockReturnValue({
      vaults: {},
      connections: { "owned-connection": "fixed-hash" },
    });
    const client = createMockClient({
      connections: [{ name: "owned-connection", ownerLabel: appName, sdkVersion: "v0-9-0" }],
    });

    const { changeSet } = await planAuthConnections(
      client,
      connectionStateScope(),
      authsWith(["owned-connection"]),
    );

    expect(changeSet.updates).toEqual([]);
    expect(changeSet.unchanged).toEqual([
      {
        name: "owned-connection",
        labelRefresh: expect.objectContaining({
          labels: { "sdk-name": appName, "sdk-version": "v1-0-0" },
        }),
      },
    ]);
  });

  test("omits client_secret from update mask when clientSecret is empty (CI scenario)", async () => {
    const client = createMockClient({
      connections: [{ name: "conn", ownerLabel: appName }],
    });
    const ciConfig: AuthConnectionConfig = {
      ...oauth2DesiredConfig,
      clientSecret: "",
      providerUrl: "https://changed.example.com",
    };

    const { changeSet } = await planAuthConnections(client, connectionStateScope(), [
      { name: "auth-a", connections: { conn: ciConfig } } as unknown as AuthService,
    ]);

    expect(changeSet.updates.map((u) => u.name)).toEqual(["conn"]);
    const [update] = changeSet.updates;
    expect(update?.request?.updateMask?.paths).toContain("oauth2.provider_url");
    expect(update?.request?.updateMask?.paths).not.toContain("oauth2.client_secret");
  });

  test("updates an existing same-name connection when state belongs to another workspace", async () => {
    mockLoadSecretsState.mockImplementation((scope?: { workspaceId: string }) =>
      scope?.workspaceId === "ws-a"
        ? { vaults: {}, connections: { "shared-connection": "fixed-hash" } }
        : { vaults: {}, connections: {} },
    );
    const client = createMockClient({
      connections: [{ name: "shared-connection", ownerLabel: appName }],
    });

    const resultA = await planAuthConnections(
      client,
      connectionStateScope({ workspaceId: "ws-a", applicationId: "shared-app-id" }),
      authsWith(["shared-connection"]),
    );
    const resultB = await planAuthConnections(
      client,
      connectionStateScope({ workspaceId: "ws-b", applicationId: "shared-app-id" }),
      authsWith(["shared-connection"]),
    );

    expect(resultA.changeSet.unchanged.map((connection) => connection.name)).toEqual([
      "shared-connection",
    ]);
    expect(resultB.changeSet.updates.map((update) => update.name)).toEqual(["shared-connection"]);
    expect(resultB.changeSet.updates[0]?.request?.updateMask?.paths).toContain(
      "oauth2.client_secret",
    );
    expect(mockLoadSecretsState).toHaveBeenCalledWith({
      workspaceId: "ws-b",
      applicationId: "shared-app-id",
      applicationName: appName,
      configPath,
    });
  });
});

describe("applyAuthConnections", () => {
  aroundEach(async (runTest) => {
    mockSaveSecretsState.mockReset();
    mockLoggerWarn.mockReset();
    mockLoggerInfo.mockReset();
    await runTest();
  });

  test("notifies user to authorize a newly created connection", async () => {
    const client = createMockClient({ connections: [] });
    const result = await planAuthConnections(
      client,
      connectionStateScope(),
      authsWith(["new-conn"]),
    );
    expect(result.changeSet.creates.map((c) => c.name)).toEqual(["new-conn"]);

    await applyAuthConnections(client, result, "create-update");

    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.stringContaining("tailor authconnection authorize --name new-conn"),
    );
  });

  test("delete phase removes connections via deleteAuthConnection", async () => {
    const client = createMockClient({
      connections: [{ name: "owned-connection", ownerLabel: appName }],
    });
    const result = await planAuthConnections(client, connectionStateScope(), emptyAuths);
    expect(result.changeSet.deletes.map((d) => d.name)).toEqual(["owned-connection"]);

    await applyAuthConnections(client, result, "delete-resources");

    expect(client.deleteAuthConnection).toHaveBeenCalledWith({
      workspaceId,
      connectionName: "owned-connection",
    });
  });

  test("updates the connection in-place without deleting it", async () => {
    const client = createMockClient({
      connections: [{ name: "conn", ownerLabel: appName, sdkVersion: "v0-9-0" }],
    });
    const result = await planAuthConnections(client, connectionStateScope(), authsWith(["conn"]));
    expect(result.changeSet.updates.map((u) => u.name)).toEqual(["conn"]);

    await applyAuthConnections(client, result, "create-update");

    const updateFn = (client as OperatorClient & { updateAuthConnection: ReturnType<typeof vi.fn> })
      .updateAuthConnection;
    expect(updateFn).toHaveBeenCalledWith(
      expect.objectContaining({
        updateMask: { paths: ["oauth2.client_secret"] },
      }),
    );
    expect(client.setMetadata).toHaveBeenCalledTimes(1);
    expect(client.deleteAuthConnection).not.toHaveBeenCalled();
    expect(client.createAuthConnection).not.toHaveBeenCalled();
  });

  test("does not save state when clientSecret is absent from update mask (CI scenario)", async () => {
    const client = createMockClient({
      connections: [{ name: "conn", ownerLabel: appName }],
    });
    const ciConfig: AuthConnectionConfig = {
      ...oauth2DesiredConfig,
      clientSecret: "",
      providerUrl: "https://changed.example.com",
    };

    const result = await planAuthConnections(client, connectionStateScope(), [
      { name: "auth-a", connections: { conn: ciConfig } } as unknown as AuthService,
    ]);
    expect(result.changeSet.updates.map((u) => u.name)).toEqual(["conn"]);
    const [update] = result.changeSet.updates;
    expect(update?.request?.updateMask?.paths).not.toContain("oauth2.client_secret");

    mockLoadSecretsState.mockClear();
    mockSaveSecretsState.mockClear();
    await applyAuthConnections(client, result, "create-update");

    expect(mockLoadSecretsState).not.toHaveBeenCalled();
    expect(mockSaveSecretsState).not.toHaveBeenCalled();
  });

  test("warns user to re-authorize when the server responds UNAUTHORIZED", async () => {
    const client = createMockClient({
      connections: [{ name: "conn", ownerLabel: appName }],
    });
    // Override to return UNAUTHORIZED
    (
      client as OperatorClient & { updateAuthConnection: ReturnType<typeof vi.fn> }
    ).updateAuthConnection.mockResolvedValueOnce({
      connection: { status: AuthConnection_Status.UNAUTHORIZED },
    });

    const result = await planAuthConnections(client, connectionStateScope(), authsWith(["conn"]));
    await applyAuthConnections(client, result, "create-update");

    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.stringContaining("tailor authconnection authorize --name conn"),
    );
  });
});
