import * as http from "node:http";
import * as net from "node:net";
import { runCommand } from "@politty/zod";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { logger } from "#/cli/shared/logger";
import { authorizeAuthConnectionCommand } from "./authorize";
import type * as ClientModule from "#/cli/shared/client";

const fetchMock = vi.fn();
const listAuthConnectionsMock = vi.fn();
const openMock = vi.hoisted(() => vi.fn());
const clientMocks = vi.hoisted(() => ({
  initOperatorClient: vi.fn(),
}));

vi.mock("open", () => ({ default: openMock }));

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
  });

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

  test("registers the returned authorization code before exchanging it", async () => {
    listAuthConnectionsMock.mockResolvedValue({
      connections: [
        {
          name: "my-connection",
          config: {
            case: "oauth2",
            value: {
              providerUrl,
              clientId: "client-id",
              authUrl: "https://idp.example.com/authorize",
            },
          },
        },
      ],
      nextPageToken: "",
    });
    const exchangeMock = vi.fn().mockResolvedValue({});
    clientMocks.initOperatorClient.mockResolvedValue({
      listAuthConnections: listAuthConnectionsMock,
      exchangeAuthConnectionAuthorizationCode: exchangeMock,
    });
    using registerSecretSpy = vi.spyOn(logger, "registerSecret").mockImplementation(() => {});
    openMock.mockImplementation(async (authorizeUrl: string) => {
      const state = new URL(authorizeUrl).searchParams.get("state");
      // Uses node:http directly (not the globally stubbed `fetch`, which is reserved
      // for mocking the OIDC discovery request in other tests in this file).
      await new Promise<void>((resolve, reject) => {
        http
          .get(
            `http://localhost:8080/callback?code=test-authorization-code&state=${state}`,
            (res) => {
              res.resume();
              res.on("end", resolve);
            },
          )
          .on("error", reject);
      });
    });

    const result = await runCommand(authorizeAuthConnectionCommand, ["--name", "my-connection"]);

    expect(result.success).toBe(true);
    expect(registerSecretSpy).toHaveBeenCalledWith("test-authorization-code");
    const registerOrder = registerSecretSpy.mock.invocationCallOrder[0];
    const exchangeOrder = vi.mocked(exchangeMock).mock.invocationCallOrder[0];
    expect(registerOrder).toBeDefined();
    expect(exchangeOrder).toBeDefined();
    expect(registerOrder).toBeLessThan(exchangeOrder as number);
    expect(exchangeMock).toHaveBeenCalledWith({
      workspaceId: "workspace-id",
      connectionName: "my-connection",
      authorizationCode: "test-authorization-code",
      redirectUri: "http://localhost:8080/callback",
    });
  });

  test("names the run's profile and workspace in the Console fallback when the callback port is taken", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ authorization_endpoint: `${providerUrl}/authorize` }),
    });
    const blocker = net.createServer();
    await new Promise<void>((resolve, reject) => {
      blocker.once("error", reject);
      blocker.listen(0, resolve);
    });
    const { port } = blocker.address() as net.AddressInfo;
    using warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);

    try {
      const result = await runCommand(authorizeAuthConnectionCommand, [
        "--name",
        "my-connection",
        "--port",
        String(port),
        "--profile",
        "dev",
        "--workspace-id",
        "workspace-id",
      ]);

      expect(result.success).toBe(false);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining(
          "tailor authconnection open --workspace-id=workspace-id --profile=dev",
        ),
      );
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  });
});
