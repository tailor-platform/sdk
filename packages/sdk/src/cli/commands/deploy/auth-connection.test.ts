import { Code, ConnectError } from "@connectrpc/connect";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { planAuthConnections } from "./auth-connection";
import type { AuthService } from "@/cli/services/auth/service";
import type { OperatorClient } from "@/cli/shared/client";

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
  /** sdk-name label value, when the connection carries SDK metadata */
  ownerLabel?: string;
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

function createMockClient(opts: {
  connections: ConnectionFixture[];
  metadataSupported: boolean;
}): OperatorClient {
  return {
    listAuthConnections: vi.fn().mockResolvedValue({
      connections: opts.connections.map((c) => oauth2Connection(c.name)),
      nextPageToken: "",
    }),
    getMetadata: vi.fn().mockImplementation(({ trn }: { trn: string }) => {
      if (!opts.metadataSupported) {
        throw new ConnectError("metadata not supported", Code.InvalidArgument);
      }
      const name = trn.split(":").pop();
      const fixture = opts.connections.find((c) => c.name === name);
      return {
        metadata: {
          labels: fixture?.ownerLabel
            ? { "sdk-name": fixture.ownerLabel, "sdk-version": "v1-0-0" }
            : {},
        },
      };
    }),
  } as unknown as OperatorClient;
}

/** Auth service with no desired connections, so every existing one is a deletion candidate. */
const emptyAuths: ReadonlyArray<Readonly<AuthService>> = [
  { name: "auth-a", connections: {} } as unknown as AuthService,
];

describe("planAuthConnections deletion safety when metadata is not supported", () => {
  beforeEach(() => {
    mockLoadSecretsState.mockReset();
  });

  test("does NOT delete externally-managed connections absent from secrets-state", async () => {
    // Connection exists remotely but was never created by this SDK (not in state).
    mockLoadSecretsState.mockReturnValue({ vaults: {}, connections: {} });
    const client = createMockClient({
      connections: [{ name: "external-connection" }],
      metadataSupported: false,
    });

    const { changeSet } = await planAuthConnections(
      client,
      workspaceId,
      appName,
      undefined,
      emptyAuths,
    );

    expect(changeSet.deletes.map((d) => d.name)).toEqual([]);
  });

  test("deletes connections this SDK previously created (tracked in secrets-state)", async () => {
    mockLoadSecretsState.mockReturnValue({
      vaults: {},
      connections: { "sdk-connection": "some-hash" },
    });
    const client = createMockClient({
      connections: [{ name: "sdk-connection" }, { name: "external-connection" }],
      metadataSupported: false,
    });

    const { changeSet } = await planAuthConnections(
      client,
      workspaceId,
      appName,
      undefined,
      emptyAuths,
    );

    expect(changeSet.deletes.map((d) => d.name)).toEqual(["sdk-connection"]);
  });
});

describe("planAuthConnections deletion when metadata is supported", () => {
  beforeEach(() => {
    mockLoadSecretsState.mockReturnValue({ vaults: {}, connections: {} });
  });

  test("deletes connections owned by this app and keeps others", async () => {
    const client = createMockClient({
      connections: [
        { name: "owned-connection", ownerLabel: appName },
        { name: "other-app-connection", ownerLabel: "other-app" },
        { name: "unmanaged-connection" },
      ],
      metadataSupported: true,
    });

    const { changeSet, resourceOwners } = await planAuthConnections(
      client,
      workspaceId,
      appName,
      undefined,
      emptyAuths,
    );

    expect(changeSet.deletes.map((d) => d.name)).toEqual(["owned-connection"]);
    // Connections owned by another app are tracked, not deleted.
    expect(resourceOwners.has("other-app")).toBe(true);
  });
});
