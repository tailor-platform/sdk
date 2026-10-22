import * as http from "node:http";
import * as net from "node:net";
import { runCommand } from "@politty/zod";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { logger } from "#/cli/shared/logger";
import { captureStdout } from "#/cli/shared/test-helpers/capture-output";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
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

type CallbackResponse = { status: number; contentType: string | undefined; body: string };

function getCallback(path: string): Promise<CallbackResponse> {
  return new Promise((resolve, reject) => {
    http
      .get(`http://localhost:8080${path}`, { agent: false }, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (body += chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, contentType: res.headers["content-type"], body }),
        );
      })
      .on("error", reject);
  });
}

function mockOAuth2Connection(exchangeMock: ReturnType<typeof vi.fn>) {
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
  clientMocks.initOperatorClient.mockResolvedValue({
    listAuthConnections: listAuthConnectionsMock,
    exchangeAuthConnectionAuthorizationCode: exchangeMock,
  });
}

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

  test("registers the returned authorization code before exchanging it and prints the result", async () => {
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
    using _json = jsonMode();
    using stdout = captureStdout();
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
    expect(JSON.parse(stdout.output)).toEqual({
      changed: true,
      workspaceId: "workspace-id",
      name: "my-connection",
    });
  });

  test("returns an HTML page telling the user to close the tab after a successful authorization", async () => {
    mockOAuth2Connection(vi.fn().mockResolvedValue({}));
    let pending: Promise<CallbackResponse> | undefined;
    openMock.mockImplementation(async (authorizeUrl: string) => {
      const state = new URL(authorizeUrl).searchParams.get("state");
      pending = getCallback(`/callback?code=c&state=${state}`);
      await pending;
    });

    const result = await runCommand(authorizeAuthConnectionCommand, ["--name", "my-connection"]);
    const response = await pending;

    expect(result.success).toBe(true);
    expect(response?.status).toBe(200);
    expect(response?.contentType).toContain("text/html");
    expect(response?.body).toContain("Authorization successful");
    expect(response?.body).toContain("close this tab");
    expect(response?.body).toContain("window.close()");
  });

  test("returns an escaped HTML failure page with 400 when the provider reports an error", async () => {
    mockOAuth2Connection(vi.fn());
    let pending: Promise<CallbackResponse> | undefined;
    openMock.mockImplementation(async () => {
      pending = getCallback(`/callback?error=${encodeURIComponent("<script>x</script>")}`);
      await pending;
    });

    const result = await runCommand(authorizeAuthConnectionCommand, ["--name", "my-connection"]);
    const response = await pending;

    expect(result.success).toBe(false);
    expect(response?.status).toBe(400);
    expect(response?.contentType).toContain("text/html");
    expect(response?.body).toContain("Authorization failed");
    expect(response?.body).toContain("&lt;script&gt;x&lt;/script&gt;");
    expect(response?.body).not.toContain("<script>x");
  });

  test("does not expose internal error messages on the failure page", async () => {
    mockOAuth2Connection(vi.fn().mockRejectedValue(new Error("secret-internal-detail")));
    let pending: Promise<CallbackResponse> | undefined;
    openMock.mockImplementation(async (authorizeUrl: string) => {
      const state = new URL(authorizeUrl).searchParams.get("state");
      pending = getCallback(`/callback?code=c&state=${state}`);
      await pending;
    });

    const result = await runCommand(authorizeAuthConnectionCommand, ["--name", "my-connection"]);
    const response = await pending;

    expect(result.success).toBe(false);
    expect(response?.body).toContain("Authorization failed");
    expect(response?.body).not.toContain("secret-internal-detail");
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

  test("names a PowerShell and a cmd.exe Console fallback when the Windows shells quote the profile differently", async () => {
    using _platform = vi.spyOn(process, "platform", "get").mockReturnValue("win32");
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
        "dev$1",
        "--workspace-id",
        "workspace-id",
      ]);

      expect(result.success).toBe(false);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining(
          `instead:\n  \`tailor authconnection open --workspace-id=workspace-id '--profile=dev$1'\` in PowerShell or \`tailor authconnection open --workspace-id=workspace-id "--profile=dev$1"\` in cmd.exe`,
        ),
      );
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  });
});
