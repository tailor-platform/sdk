import { beforeEach, describe, expect, test, vi } from "vitest";
import { applyAuthConnections, planAuthConnections } from "./auth-connection";
import type { AuthService } from "#src/cli/services/auth/service";
import type { OperatorClient } from "#src/cli/shared/client";
import type { AuthConnectionConfig } from "#src/types/auth-connection.generated";

const mockLoadSecretsState = vi.fn();

vi.mock("./secrets-state", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = (await importOriginal()) as typeof import("./secrets-state");
  return {
    ...actual,
    loadSecretsState: (...args: unknown[]) => mockLoadSecretsState(...args),
    saveSecretsState: vi.fn(),
    // Deterministic hash so tests can pin the "unchanged" secret state.
    hashValue: () => "fixed-hash",
  };
});

vi.mock("#src/cli/shared/client", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = (await importOriginal()) as typeof import("#src/cli/shared/client");
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
  const actual = (await importOriginal()) as typeof import("./label");
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

type ConnectionFixture = {
  name: string;
  /** sdk-name label value when the connection carries SDK metadata */
  ownerLabel?: string;
};

const oauth2DesiredConfig: AuthConnectionConfig = {
  type: "oauth2",
  providerUrl: "https://idp.example.com",
  issuerUrl: "https://idp.example.com",
  clientId: "client-id",
  clientSecret: "client-secret",
} as AuthConnectionConfig;

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
          labels: fixture?.ownerLabel ? { "sdk-name": fixture.ownerLabel } : {},
        },
      };
    }),
    setMetadata: vi.fn().mockResolvedValue({}),
    createAuthConnection: vi.fn().mockResolvedValue({}),
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

describe("planAuthConnections", () => {
  beforeEach(() => {
    mockLoadSecretsState.mockReset();
    mockLoadSecretsState.mockReturnValue({ vaults: {}, connections: {} });
  });

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
      workspaceId,
      appName,
      undefined,
      emptyAuths,
    );

    expect(changeSet.deletes.map((d) => d.name)).toEqual(["owned-connection"]);
    expect(resourceOwners.has("other-app")).toBe(true);
  });

  test("addresses connections via the `auth_connection` TRN segment", async () => {
    const client = createMockClient({
      connections: [{ name: "owned-connection", ownerLabel: appName }],
    });

    await planAuthConnections(client, workspaceId, appName, undefined, emptyAuths);

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

    const { changeSet, unmanaged } = await planAuthConnections(
      client,
      workspaceId,
      appName,
      undefined,
      authsWith(["adopted-connection"]),
    );

    expect(unmanaged.map((u) => u.resourceName)).toEqual(["adopted-connection"]);
    expect(changeSet.updates.map((u) => u.name)).toEqual(["adopted-connection"]);
    expect(changeSet.unchanged.map((u) => u.name)).toEqual([]);
    expect(changeSet.replaces.map((r) => r.name)).toEqual([]);
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
      workspaceId,
      appName,
      undefined,
      authsWith(["owned-connection"]),
    );

    expect(changeSet.unchanged.map((u) => u.name)).toEqual(["owned-connection"]);
    expect(changeSet.updates.map((u) => u.name)).toEqual([]);
    expect(unmanaged.map((u) => u.resourceName)).toEqual([]);
  });
});

describe("applyAuthConnections", () => {
  beforeEach(() => {
    mockLoadSecretsState.mockReset();
    mockLoadSecretsState.mockReturnValue({ vaults: {}, connections: {} });
  });

  test("delete phase removes connections via deleteAuthConnection", async () => {
    const client = createMockClient({
      connections: [{ name: "owned-connection", ownerLabel: appName }],
    });
    const result = await planAuthConnections(client, workspaceId, appName, undefined, emptyAuths);
    expect(result.changeSet.deletes.map((d) => d.name)).toEqual(["owned-connection"]);

    await applyAuthConnections(client, result, "delete-resources");

    expect(client.deleteAuthConnection).toHaveBeenCalledWith({
      workspaceId,
      connectionName: "owned-connection",
    });
  });

  test("replace deletes then recreates the connection", async () => {
    const client = createMockClient({
      connections: [{ name: "conn", ownerLabel: appName }],
    });
    const result = await planAuthConnections(
      client,
      workspaceId,
      appName,
      undefined,
      authsWith(["conn"]),
    );
    expect(result.changeSet.replaces.map((r) => r.name)).toEqual(["conn"]);

    await applyAuthConnections(client, result, "create-update");

    expect(client.deleteAuthConnection).toHaveBeenCalledWith({
      workspaceId,
      connectionName: "conn",
    });
    expect(client.createAuthConnection).toHaveBeenCalled();
  });
});
