import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { runCommand } from "@politty/zod";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { initOperatorClient } from "#/cli/shared/client";
import { loadConfig } from "#/cli/shared/config-loader";
import { loadAccessToken, loadWorkspaceId } from "#/cli/shared/context";
import { logger } from "#/cli/shared/logger";
import { mockOperatorClient } from "#/cli/shared/test-helpers/operator-client";
import { silenceLogger } from "#/cli/shared/test-helpers/silence-logger";
import { show, showCommand } from "./show";
import type { MessageInitShape } from "@bufbuild/protobuf";
import type { ApplicationSchema } from "@tailor-platform/tailor-proto/application_resource_pb";

vi.mock("#/cli/shared/context", () => ({
  loadAccessToken: vi.fn(),
  loadWorkspaceId: vi.fn(),
}));

vi.mock("#/cli/shared/client", async (importOriginal) => ({
  ...(await importOriginal()),
  initOperatorClient: vi.fn(),
}));

vi.mock("#/cli/shared/config-loader", () => ({
  loadConfig: vi.fn(),
}));

function mockConfig(config: Record<string, unknown>) {
  vi.mocked(loadConfig).mockResolvedValue({
    config: { name: "my-app", ...config },
  } as unknown as Awaited<ReturnType<typeof loadConfig>>);
}

describe("show", () => {
  let client: ReturnType<typeof createClient>;

  const application = {
    name: "my-app",
    domain: "my-app.example.com",
    url: "https://my-app.example.com",
    authNamespace: "my-auth",
    cors: [],
    allowedIpAddresses: [],
    disableIntrospection: false,
    createTime: timestampFromDate(new Date("2026-01-01T00:00:00Z")),
    updateTime: timestampFromDate(new Date("2026-02-01T00:00:00Z")),
  } satisfies MessageInitShape<typeof ApplicationSchema>;

  function createClient() {
    return mockOperatorClient({
      getWorkspace: {
        workspace: { name: "my-workspace", region: "us" },
      },
      getApplication: { application },
      getAIGateway: {},
      getStaticWebsite: {},
      listAuthOAuth2Clients: {},
    });
  }

  aroundEach(async (runTest) => {
    vi.mocked(loadAccessToken).mockResolvedValue("mock-token");
    vi.mocked(loadWorkspaceId).mockResolvedValue("workspace-1");
    vi.mocked(loadConfig).mockResolvedValue({
      config: {
        name: "my-app",
        aiGateways: [{ name: "gateway-a" }, { name: "gateway-b" }],
      },
    } as unknown as Awaited<ReturnType<typeof loadConfig>>);

    client = createClient();
    vi.mocked(initOperatorClient).mockResolvedValue(client);
    await runTest();
  });

  test.each([
    { args: [], configPath: undefined },
    { args: ["--config", "apps/shop/tailor.config.ts"], configPath: "apps/shop/tailor.config.ts" },
  ])("loads the config the command was given ($args)", async ({ args, configPath }) => {
    vi.stubEnv("TAILOR_CONFIG_PATH", undefined);
    using _logger = silenceLogger("out");
    client.getAIGateway.mockRejectedValue(new ConnectError("not found", Code.NotFound));

    try {
      const result = await runCommand(showCommand, args);
      expect(result.error).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
    }

    expect(loadConfig).toHaveBeenCalledWith(configPath);
  });

  test("includes the URL of every configured AI Gateway", async () => {
    client.getAIGateway.mockImplementation((request) =>
      Promise.resolve({
        aigateway: {
          name: request.aigatewayName,
          url: `https://${request.aigatewayName ?? ""}.example.com`,
        },
      }),
    );

    const info = await show();

    expect(info.aiGateways).toEqual([
      { name: "gateway-a", url: "https://gateway-a.example.com" },
      { name: "gateway-b", url: "https://gateway-b.example.com" },
    ]);
    expect(client.getAIGateway).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      aigatewayName: "gateway-a",
    });
    expect(client.getAIGateway).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      aigatewayName: "gateway-b",
    });
    expect(client.getAIGateway).toHaveBeenCalledTimes(2);
  });

  test("omits AI Gateways that have not been deployed yet", async () => {
    vi.when(client.getAIGateway, {
      onUnmatched: () => Promise.reject(new ConnectError("not found", Code.NotFound)),
    })
      .calledWith(expect.objectContaining({ aigatewayName: "gateway-a" }))
      .thenResolve({ aigateway: { name: "gateway-a", url: "https://gateway-a.example.com" } });

    const info = await show();

    expect(info.aiGateways).toEqual([{ name: "gateway-a", url: "https://gateway-a.example.com" }]);
    expect(client.getAIGateway).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      aigatewayName: "gateway-a",
    });
    expect(client.getAIGateway).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      aigatewayName: "gateway-b",
    });
    expect(client.getAIGateway).toHaveBeenCalledTimes(2);
  });

  test("de-duplicates AI Gateway names before fetching", async () => {
    vi.mocked(loadConfig).mockResolvedValue({
      config: {
        name: "my-app",
        aiGateways: [{ name: "gateway-a" }, { name: "gateway-a" }],
      },
    } as unknown as Awaited<ReturnType<typeof loadConfig>>);
    client.getAIGateway.mockResolvedValue({
      aigateway: { name: "gateway-a", url: "https://gateway-a.example.com" },
    });

    const info = await show();

    expect(info.aiGateways).toEqual([{ name: "gateway-a", url: "https://gateway-a.example.com" }]);
    expect(client.getAIGateway).toHaveBeenCalledTimes(1);
  });

  test("returns an empty array when no AI Gateway is configured", async () => {
    vi.mocked(loadConfig).mockResolvedValue({
      config: { name: "my-app" },
    } as unknown as Awaited<ReturnType<typeof loadConfig>>);

    const info = await show();

    expect(info.aiGateways).toEqual([]);
    expect(client.getAIGateway).not.toHaveBeenCalled();
  });

  test("returns empty static websites and OAuth2 clients when none are configured", async () => {
    mockConfig({});

    const info = await show();

    expect(info.staticWebsites).toEqual([]);
    expect(info.oauth2Clients).toEqual([]);
    expect(client.getStaticWebsite).not.toHaveBeenCalled();
    expect(client.listAuthOAuth2Clients).not.toHaveBeenCalled();
  });

  describe("static websites", () => {
    test("includes the URL and description of every configured static website", async () => {
      mockConfig({ staticWebsites: [{ name: "site-a" }, { name: "site-b" }] });
      client.getStaticWebsite.mockImplementation((request) =>
        Promise.resolve({
          staticwebsite: {
            name: request.name,
            url: `https://${request.name ?? ""}.example.com`,
            description: `${request.name ?? ""} frontend`,
            allowedIpAddresses: ["10.0.0.0/8"],
          },
        }),
      );

      const info = await show();

      expect(info.staticWebsites).toEqual([
        { name: "site-a", url: "https://site-a.example.com", description: "site-a frontend" },
        { name: "site-b", url: "https://site-b.example.com", description: "site-b frontend" },
      ]);
      expect(client.getStaticWebsite).toHaveBeenCalledWith({
        workspaceId: "workspace-1",
        name: "site-a",
      });
      expect(client.getStaticWebsite).toHaveBeenCalledWith({
        workspaceId: "workspace-1",
        name: "site-b",
      });
      expect(client.getStaticWebsite).toHaveBeenCalledTimes(2);
    });

    test("omits static websites that have not been deployed yet", async () => {
      mockConfig({ staticWebsites: [{ name: "site-a" }, { name: "site-b" }] });
      vi.when(client.getStaticWebsite, {
        onUnmatched: () => Promise.reject(new ConnectError("not found", Code.NotFound)),
      })
        .calledWith(expect.objectContaining({ name: "site-a" }))
        .thenResolve({
          staticwebsite: {
            name: "site-a",
            url: "https://site-a.example.com",
            description: "",
            allowedIpAddresses: [],
          },
        });

      const info = await show();

      expect(info.staticWebsites).toEqual([
        { name: "site-a", url: "https://site-a.example.com", description: "" },
      ]);
      expect(client.getStaticWebsite).toHaveBeenCalledTimes(2);
    });

    test("de-duplicates static website names before fetching", async () => {
      mockConfig({ staticWebsites: [{ name: "site-a" }, { name: "site-a" }] });
      client.getStaticWebsite.mockResolvedValue({
        staticwebsite: {
          name: "site-a",
          url: "https://site-a.example.com",
          description: "",
          allowedIpAddresses: [],
        },
      });

      const info = await show();

      expect(info.staticWebsites).toEqual([
        { name: "site-a", url: "https://site-a.example.com", description: "" },
      ]);
      expect(client.getStaticWebsite).toHaveBeenCalledTimes(1);
    });

    test("fails when a static website cannot be read", async () => {
      mockConfig({ staticWebsites: [{ name: "site-a" }] });
      client.getStaticWebsite.mockRejectedValue(
        new ConnectError("permission denied", Code.PermissionDenied),
      );

      await expect(show()).rejects.toThrow("permission denied");
    });
  });

  describe("OAuth2 clients", () => {
    const oauth2Clients = {
      web: { redirectURIs: ["https://web.example.com"], grantTypes: ["authorization_code"] },
      mobile: { redirectURIs: ["myapp://callback"], grantTypes: ["authorization_code"] },
    };

    test("includes the client ID of every OAuth2 client configured in auth, in config order", async () => {
      mockConfig({ auth: { name: "local-auth", oauth2Clients } });
      client.listAuthOAuth2Clients.mockResolvedValue({
        oauth2Clients: [
          { name: "mobile", clientId: "mobile-id" },
          { name: "unmanaged", clientId: "unmanaged-id" },
          { name: "web", clientId: "web-id" },
        ],
        nextPageToken: "",
      });

      const info = await show();

      expect(info.oauth2Clients).toEqual([
        { name: "web", clientId: "web-id" },
        { name: "mobile", clientId: "mobile-id" },
      ]);
      expect(client.listAuthOAuth2Clients).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: "workspace-1", namespaceName: "my-auth" }),
      );
    });

    test("reads every page of OAuth2 clients", async () => {
      mockConfig({ auth: { name: "local-auth", oauth2Clients } });
      vi.when(client.listAuthOAuth2Clients)
        .calledWith(expect.objectContaining({ pageToken: "" }))
        .thenResolve({
          oauth2Clients: [{ name: "web", clientId: "web-id" }],
          nextPageToken: "page-2",
        })
        .calledWith(expect.objectContaining({ pageToken: "page-2" }))
        .thenResolve({
          oauth2Clients: [{ name: "mobile", clientId: "mobile-id" }],
          nextPageToken: "",
        });

      const info = await show();

      expect(info.oauth2Clients).toEqual([
        { name: "web", clientId: "web-id" },
        { name: "mobile", clientId: "mobile-id" },
      ]);
      expect(client.listAuthOAuth2Clients).toHaveBeenCalledTimes(2);
    });

    test("omits OAuth2 clients that have not been deployed yet", async () => {
      mockConfig({ auth: { name: "local-auth", oauth2Clients } });
      client.listAuthOAuth2Clients.mockResolvedValue({
        oauth2Clients: [{ name: "web", clientId: "web-id" }],
        nextPageToken: "",
      });

      const info = await show();

      expect(info.oauth2Clients).toEqual([{ name: "web", clientId: "web-id" }]);
    });

    test("returns no OAuth2 clients when the deployed application has no auth namespace", async () => {
      mockConfig({ auth: { name: "local-auth", oauth2Clients } });
      client.getApplication.mockResolvedValue({
        application: { ...application, authNamespace: "" },
      });

      const info = await show();

      expect(info.oauth2Clients).toEqual([]);
      expect(client.listAuthOAuth2Clients).not.toHaveBeenCalled();
    });

    test("returns no OAuth2 clients when the auth namespace is not found", async () => {
      mockConfig({ auth: { name: "local-auth", oauth2Clients } });
      client.listAuthOAuth2Clients.mockRejectedValue(new ConnectError("not found", Code.NotFound));

      const info = await show();

      expect(info.oauth2Clients).toEqual([]);
      expect(client.listAuthOAuth2Clients).toHaveBeenCalledTimes(1);
    });

    test("returns no OAuth2 clients for an external auth", async () => {
      mockConfig({ auth: { name: "my-auth", external: true } });

      const info = await show();

      expect(info.oauth2Clients).toEqual([]);
      expect(client.listAuthOAuth2Clients).not.toHaveBeenCalled();
    });

    test("returns no OAuth2 clients when auth declares none", async () => {
      mockConfig({ auth: { name: "local-auth" } });

      const info = await show();

      expect(info.oauth2Clients).toEqual([]);
      expect(client.listAuthOAuth2Clients).not.toHaveBeenCalled();
    });

    test("warns and returns null OAuth2 clients when the credentials cannot list them", async () => {
      using warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      mockConfig({ auth: { name: "local-auth", oauth2Clients } });
      client.listAuthOAuth2Clients.mockRejectedValue(
        new ConnectError("permission denied", Code.PermissionDenied),
      );

      const info = await show();

      expect(info.oauth2Clients).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('"my-auth"'));
    });

    test("fails when listing OAuth2 clients fails for another reason", async () => {
      mockConfig({ auth: { name: "local-auth", oauth2Clients } });
      client.listAuthOAuth2Clients.mockRejectedValue(
        new ConnectError("unavailable", Code.Unavailable),
      );

      await expect(show()).rejects.toThrow("unavailable");
    });
  });
});
