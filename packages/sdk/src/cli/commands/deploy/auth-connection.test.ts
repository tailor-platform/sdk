import { Code, ConnectError } from "@connectrpc/connect";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { planAuthConnections } from "./auth-connection";
import type { AuthService } from "@/cli/services/auth/service";
import type { OperatorClient } from "@/cli/shared/client";
import type { AuthConnectionConfig } from "@/types/auth-connection.generated";

const mockLoadSecretsState = vi.fn();

vi.mock("./secrets-state", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = (await importOriginal()) as typeof import("./secrets-state");
  return {
    ...actual,
    loadSecretsState: (...args: unknown[]) => mockLoadSecretsState(...args),
    saveSecretsState: vi.fn(),
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

const workspaceId = "ws-1";

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

function createMockClient(connectionNames: string[]): OperatorClient {
  return {
    listAuthConnections: vi.fn().mockResolvedValue({
      connections: connectionNames.map((name) => oauth2Connection(name)),
      nextPageToken: "",
    }),
    // getMetadata is intentionally not provided: the platform does not support
    // metadata for auth connections, so planAuthConnections must never call it.
    getMetadata: vi.fn().mockImplementation(() => {
      throw new ConnectError("metadata not supported", Code.InvalidArgument);
    }),
  } as unknown as OperatorClient;
}

/** Auth service with no desired connections, so every existing one is a deletion candidate. */
const emptyAuths: ReadonlyArray<Readonly<AuthService>> = [
  { name: "auth-a", connections: {} } as unknown as AuthService,
];

// Auth service carrying the given desired connection configs.
function authsWith(
  connections: Record<string, AuthConnectionConfig>,
): ReadonlyArray<Readonly<AuthService>> {
  return [{ name: "auth-a", connections } as unknown as AuthService];
}

// Desired config whose non-secret fields match what `oauth2Connection` returns from the server.
const baseConfig: AuthConnectionConfig = {
  type: "oauth2",
  providerUrl: "https://idp.example.com",
  issuerUrl: "https://idp.example.com",
  clientId: "client-id",
  clientSecret: "client-secret",
};

describe("planAuthConnections deletion safety", () => {
  beforeEach(() => {
    mockLoadSecretsState.mockReset();
  });

  test("does NOT delete externally-managed connections absent from secrets-state", async () => {
    // Connection exists remotely but was never created by this SDK (not in state).
    mockLoadSecretsState.mockReturnValue({ vaults: {}, connections: {} });
    const client = createMockClient(["external-connection"]);

    const { changeSet } = await planAuthConnections(client, workspaceId, emptyAuths);

    expect(changeSet.deletes.map((d) => d.name)).toEqual([]);
  });

  test("deletes only connections this SDK previously created (tracked in secrets-state)", async () => {
    mockLoadSecretsState.mockReturnValue({
      vaults: {},
      connections: { "sdk-connection": "some-hash" },
    });
    const client = createMockClient(["sdk-connection", "external-connection"]);

    const { changeSet } = await planAuthConnections(client, workspaceId, emptyAuths);

    expect(changeSet.deletes.map((d) => d.name)).toEqual(["sdk-connection"]);
  });

  test("does not call getMetadata (connection metadata is unsupported by the platform)", async () => {
    mockLoadSecretsState.mockReturnValue({ vaults: {}, connections: {} });
    const client = createMockClient(["external-connection"]);

    await planAuthConnections(client, workspaceId, emptyAuths);

    expect(client.getMetadata).not.toHaveBeenCalled();
  });
});

describe("planAuthConnections create/replace planning", () => {
  beforeEach(() => {
    mockLoadSecretsState.mockReset();
    mockLoadSecretsState.mockReturnValue({ vaults: {}, connections: {} });
  });

  test("creates a desired connection that does not exist remotely", async () => {
    const client = createMockClient([]); // no existing connections

    const { changeSet } = await planAuthConnections(
      client,
      workspaceId,
      authsWith({ "new-conn": baseConfig }),
    );

    expect(changeSet.creates.map((c) => c.name)).toEqual(["new-conn"]);
    expect(changeSet.replaces).toEqual([]);
    expect(changeSet.deletes).toEqual([]);
  });

  test("replaces when a non-secret field differs from the remote connection", async () => {
    const client = createMockClient(["c1"]); // remote c1 has clientId "client-id"

    const { changeSet } = await planAuthConnections(
      client,
      workspaceId,
      authsWith({ c1: { ...baseConfig, clientId: "changed-client-id" } }),
    );

    expect(changeSet.replaces.map((r) => r.name)).toEqual(["c1"]);
    expect(changeSet.creates).toEqual([]);
    expect(changeSet.deletes).toEqual([]);
  });

  test("replaces an in-config connection whose secret hash is unknown (state lost / external)", async () => {
    // Non-secret fields match the remote connection, but secrets-state has no hash for it,
    // so the secret is treated as changed and the connection is revoked + recreated.
    // This pins the declarative behavior: a name present in config is always managed,
    // even when the SDK has no local record of having created it.
    const client = createMockClient(["c1"]);

    const { changeSet } = await planAuthConnections(
      client,
      workspaceId,
      authsWith({ c1: baseConfig }),
    );

    expect(changeSet.replaces.map((r) => r.name)).toEqual(["c1"]);
    expect(changeSet.deletes).toEqual([]);
  });
});
