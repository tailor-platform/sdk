import { runCommand } from "politty";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { authorizeAuthConnectionCommand } from "./authorize";
import type * as ClientModule from "#/cli/shared/client";

const fetchMock = vi.fn();
const listAuthConnectionsMock = vi.fn();
const clientMocks = vi.hoisted(() => ({
  initOperatorClient: vi.fn(),
}));

vi.mock("#/cli/shared/client", async (importOriginal) => {
  const actual = await importOriginal<typeof ClientModule>();
  return {
    ...actual,
    initOperatorClient: clientMocks.initOperatorClient,
  };
});

vi.mock("#/cli/shared/context", () => ({
  loadAccessToken: vi.fn().mockResolvedValue("access-token"),
  loadWorkspaceId: vi.fn().mockResolvedValue("workspace-id"),
}));

vi.mock("#/cli/shared/readonly-guard", () => ({
  assertWritable: vi.fn().mockResolvedValue(undefined),
}));

const providerUrl = "https://idp.example.com";
const discoveryUrl = `${providerUrl}/.well-known/openid-configuration`;

aroundEach(async (runTest) => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  listAuthConnectionsMock.mockResolvedValue({
    connections: [
      {
        name: "my-connection",
        config: {
          case: "oauth2",
          value: {
            providerUrl,
            clientId: "client-id",
            authUrl: "",
          },
        },
      },
    ],
    nextPageToken: "",
  });
  clientMocks.initOperatorClient.mockResolvedValue({
    listAuthConnections: listAuthConnectionsMock,
  } as unknown as ClientModule.OperatorClient);

  try {
    await runTest();
  } finally {
    vi.unstubAllGlobals();
  }
});

describe("authconnection authorize", () => {
  test("reports an OIDC discovery connection failure as a normal command error", async () => {
    const fetchError = new TypeError("fetch failed");
    fetchMock.mockRejectedValue(fetchError);

    const result = await runCommand(authorizeAuthConnectionCommand, ["--name", "my-connection"]);

    expect(result.success).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(discoveryUrl);
    const error = (result as { error?: Error }).error;
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(TypeError);
    expect(error?.message).toBe(
      `Failed to fetch OIDC discovery from ${discoveryUrl}: fetch failed`,
    );
    expect(error?.cause).toBe(fetchError);
  });
});
