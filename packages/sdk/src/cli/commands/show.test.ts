import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { aroundEach, describe, expect, test, vi, type Mock } from "vitest";
import { initOperatorClient } from "#/cli/shared/client";
import { loadConfig } from "#/cli/shared/config-loader";
import { loadAccessToken, loadWorkspaceId } from "#/cli/shared/context";
import { logger } from "#/cli/shared/logger";
import { show } from "./show";

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

type GetAIGateway = (args: { workspaceId: string; aigatewayName: string }) => Promise<{
  aigateway: { name: string; url: string };
}>;

type GetStaticWebsite = (args: { workspaceId: string; name: string }) => Promise<{
  staticwebsite?: { name: string; url: string; description: string; allowedIpAddresses: string[] };
}>;

type ListAuthOAuth2Clients = (args: {
  workspaceId: string;
  namespaceName: string;
  pageToken: string;
  pageSize: number;
}) => Promise<{
  oauth2Clients: { name: string; clientId: string; clientSecret: string }[];
  nextPageToken: string;
}>;

function mockConfig(config: Record<string, unknown>) {
  vi.mocked(loadConfig).mockResolvedValue({
    config: { name: "my-app", ...config },
  } as unknown as Awaited<ReturnType<typeof loadConfig>>);
}

describe("show", () => {
  let getWorkspaceMock: ReturnType<typeof vi.fn>;
  let getApplicationMock: ReturnType<typeof vi.fn>;
  let getAIGatewayMock: Mock<GetAIGateway>;
  let getStaticWebsiteMock: Mock<GetStaticWebsite>;
  let listAuthOAuth2ClientsMock: Mock<ListAuthOAuth2Clients>;

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
  };

  aroundEach(async (runTest) => {
    vi.mocked(loadAccessToken).mockResolvedValue("mock-token");
    vi.mocked(loadWorkspaceId).mockResolvedValue("workspace-1");
    vi.mocked(loadConfig).mockResolvedValue({
      config: {
        name: "my-app",
        aiGateways: [{ name: "gateway-a" }, { name: "gateway-b" }],
      },
    } as unknown as Awaited<ReturnType<typeof loadConfig>>);

    getWorkspaceMock = vi.fn().mockResolvedValue({
      workspace: { name: "my-workspace", region: "us" },
    });
    getApplicationMock = vi.fn().mockResolvedValue({ application });
    getAIGatewayMock = vi.fn<GetAIGateway>();
    getStaticWebsiteMock = vi.fn<GetStaticWebsite>();
    listAuthOAuth2ClientsMock = vi.fn<ListAuthOAuth2Clients>();
    vi.mocked(initOperatorClient).mockResolvedValue({
      getWorkspace: getWorkspaceMock,
      getApplication: getApplicationMock,
      getAIGateway: getAIGatewayMock,
      getStaticWebsite: getStaticWebsiteMock,
      listAuthOAuth2Clients: listAuthOAuth2ClientsMock,
    } as unknown as Awaited<ReturnType<typeof initOperatorClient>>);
    await runTest();
  });

  test("includes the URL of every configured AI Gateway", async () => {
    getAIGatewayMock.mockImplementation(({ aigatewayName }) =>
      Promise.resolve({
        aigateway: { name: aigatewayName, url: `https://${aigatewayName}.example.com` },
      }),
    );

    const info = await show();

    expect(info.aiGateways).toEqual([
      { name: "gateway-a", url: "https://gateway-a.example.com" },
      { name: "gateway-b", url: "https://gateway-b.example.com" },
    ]);
    expect(getAIGatewayMock).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      aigatewayName: "gateway-a",
    });
    expect(getAIGatewayMock).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      aigatewayName: "gateway-b",
    });
    expect(getAIGatewayMock).toHaveBeenCalledTimes(2);
  });

  test("omits AI Gateways that have not been deployed yet", async () => {
    vi.when(getAIGatewayMock, {
      onUnmatched: () => Promise.reject(new ConnectError("not found", Code.NotFound)),
    })
      .calledWith(expect.objectContaining({ aigatewayName: "gateway-a" }))
      .thenResolve({ aigateway: { name: "gateway-a", url: "https://gateway-a.example.com" } });

    const info = await show();

    expect(info.aiGateways).toEqual([{ name: "gateway-a", url: "https://gateway-a.example.com" }]);
    expect(getAIGatewayMock).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      aigatewayName: "gateway-a",
    });
    expect(getAIGatewayMock).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      aigatewayName: "gateway-b",
    });
    expect(getAIGatewayMock).toHaveBeenCalledTimes(2);
  });

  test("de-duplicates AI Gateway names before fetching", async () => {
    vi.mocked(loadConfig).mockResolvedValue({
      config: {
        name: "my-app",
        aiGateways: [{ name: "gateway-a" }, { name: "gateway-a" }],
      },
    } as unknown as Awaited<ReturnType<typeof loadConfig>>);
    getAIGatewayMock.mockResolvedValue({
      aigateway: { name: "gateway-a", url: "https://gateway-a.example.com" },
    });

    const info = await show();

    expect(info.aiGateways).toEqual([{ name: "gateway-a", url: "https://gateway-a.example.com" }]);
    expect(getAIGatewayMock).toHaveBeenCalledTimes(1);
  });

  test("returns an empty array when no AI Gateway is configured", async () => {
    vi.mocked(loadConfig).mockResolvedValue({
      config: { name: "my-app" },
    } as unknown as Awaited<ReturnType<typeof loadConfig>>);

    const info = await show();

    expect(info.aiGateways).toEqual([]);
    expect(getAIGatewayMock).not.toHaveBeenCalled();
  });

  test("returns empty static websites and OAuth2 clients when none are configured", async () => {
    mockConfig({});

    const info = await show();

    expect(info.staticWebsites).toEqual([]);
    expect(info.oauth2Clients).toEqual([]);
    expect(getStaticWebsiteMock).not.toHaveBeenCalled();
    expect(listAuthOAuth2ClientsMock).not.toHaveBeenCalled();
  });

  describe("static websites", () => {
    test("includes the URL and description of every configured static website", async () => {
      mockConfig({ staticWebsites: [{ name: "site-a" }, { name: "site-b" }] });
      getStaticWebsiteMock.mockImplementation(({ name }) =>
        Promise.resolve({
          staticwebsite: {
            name,
            url: `https://${name}.example.com`,
            description: `${name} frontend`,
            allowedIpAddresses: ["10.0.0.0/8"],
          },
        }),
      );

      const info = await show();

      expect(info.staticWebsites).toEqual([
        { name: "site-a", url: "https://site-a.example.com", description: "site-a frontend" },
        { name: "site-b", url: "https://site-b.example.com", description: "site-b frontend" },
      ]);
      expect(getStaticWebsiteMock).toHaveBeenCalledWith({
        workspaceId: "workspace-1",
        name: "site-a",
      });
      expect(getStaticWebsiteMock).toHaveBeenCalledWith({
        workspaceId: "workspace-1",
        name: "site-b",
      });
      expect(getStaticWebsiteMock).toHaveBeenCalledTimes(2);
    });

    test("omits static websites that have not been deployed yet", async () => {
      mockConfig({ staticWebsites: [{ name: "site-a" }, { name: "site-b" }] });
      vi.when(getStaticWebsiteMock, {
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
      expect(getStaticWebsiteMock).toHaveBeenCalledTimes(2);
    });

    test("de-duplicates static website names before fetching", async () => {
      mockConfig({ staticWebsites: [{ name: "site-a" }, { name: "site-a" }] });
      getStaticWebsiteMock.mockResolvedValue({
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
      expect(getStaticWebsiteMock).toHaveBeenCalledTimes(1);
    });

    test("fails when a static website cannot be read", async () => {
      mockConfig({ staticWebsites: [{ name: "site-a" }] });
      getStaticWebsiteMock.mockRejectedValue(
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
      listAuthOAuth2ClientsMock.mockResolvedValue({
        oauth2Clients: [
          { name: "mobile", clientId: "mobile-id", clientSecret: "mobile-secret" },
          { name: "unmanaged", clientId: "unmanaged-id", clientSecret: "unmanaged-secret" },
          { name: "web", clientId: "web-id", clientSecret: "web-secret" },
        ],
        nextPageToken: "",
      });

      const info = await show();

      expect(info.oauth2Clients).toEqual([
        { name: "web", clientId: "web-id" },
        { name: "mobile", clientId: "mobile-id" },
      ]);
      expect(listAuthOAuth2ClientsMock).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: "workspace-1", namespaceName: "my-auth" }),
      );
    });

    test("never returns client secrets and redacts them from diagnostics", async () => {
      using registerSecretSpy = vi.spyOn(logger, "registerSecret").mockImplementation(() => {});
      mockConfig({ auth: { name: "local-auth", oauth2Clients } });
      listAuthOAuth2ClientsMock.mockResolvedValue({
        oauth2Clients: [{ name: "web", clientId: "web-id", clientSecret: "web-secret" }],
        nextPageToken: "",
      });

      const info = await show();

      expect(JSON.stringify(info)).not.toContain("web-secret");
      expect(registerSecretSpy).toHaveBeenCalledWith("web-secret");
    });

    test("reads every page of OAuth2 clients", async () => {
      mockConfig({ auth: { name: "local-auth", oauth2Clients } });
      vi.when(listAuthOAuth2ClientsMock)
        .calledWith(expect.objectContaining({ pageToken: "" }))
        .thenResolve({
          oauth2Clients: [{ name: "web", clientId: "web-id", clientSecret: "web-secret" }],
          nextPageToken: "page-2",
        })
        .calledWith(expect.objectContaining({ pageToken: "page-2" }))
        .thenResolve({
          oauth2Clients: [{ name: "mobile", clientId: "mobile-id", clientSecret: "mobile-secret" }],
          nextPageToken: "",
        });

      const info = await show();

      expect(info.oauth2Clients).toEqual([
        { name: "web", clientId: "web-id" },
        { name: "mobile", clientId: "mobile-id" },
      ]);
      expect(listAuthOAuth2ClientsMock).toHaveBeenCalledTimes(2);
    });

    test("omits OAuth2 clients that have not been deployed yet", async () => {
      mockConfig({ auth: { name: "local-auth", oauth2Clients } });
      listAuthOAuth2ClientsMock.mockResolvedValue({
        oauth2Clients: [{ name: "web", clientId: "web-id", clientSecret: "web-secret" }],
        nextPageToken: "",
      });

      const info = await show();

      expect(info.oauth2Clients).toEqual([{ name: "web", clientId: "web-id" }]);
    });

    test("returns no OAuth2 clients when the deployed application has no auth namespace", async () => {
      mockConfig({ auth: { name: "local-auth", oauth2Clients } });
      getApplicationMock.mockResolvedValue({ application: { ...application, authNamespace: "" } });

      const info = await show();

      expect(info.oauth2Clients).toEqual([]);
      expect(listAuthOAuth2ClientsMock).not.toHaveBeenCalled();
    });

    test("returns no OAuth2 clients when the auth namespace is not found", async () => {
      mockConfig({ auth: { name: "local-auth", oauth2Clients } });
      listAuthOAuth2ClientsMock.mockRejectedValue(new ConnectError("not found", Code.NotFound));

      const info = await show();

      expect(info.oauth2Clients).toEqual([]);
      expect(listAuthOAuth2ClientsMock).toHaveBeenCalledTimes(1);
    });

    test("returns no OAuth2 clients for an external auth", async () => {
      mockConfig({ auth: { name: "my-auth", external: true } });

      const info = await show();

      expect(info.oauth2Clients).toEqual([]);
      expect(listAuthOAuth2ClientsMock).not.toHaveBeenCalled();
    });

    test("returns no OAuth2 clients when auth declares none", async () => {
      mockConfig({ auth: { name: "local-auth" } });

      const info = await show();

      expect(info.oauth2Clients).toEqual([]);
      expect(listAuthOAuth2ClientsMock).not.toHaveBeenCalled();
    });

    test("warns and returns no OAuth2 clients when the credentials cannot list them", async () => {
      using warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      mockConfig({ auth: { name: "local-auth", oauth2Clients } });
      listAuthOAuth2ClientsMock.mockRejectedValue(
        new ConnectError("permission denied", Code.PermissionDenied),
      );

      const info = await show();

      expect(info.oauth2Clients).toEqual([]);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('"my-auth"'));
    });

    test("fails when listing OAuth2 clients fails for another reason", async () => {
      mockConfig({ auth: { name: "local-auth", oauth2Clients } });
      listAuthOAuth2ClientsMock.mockRejectedValue(
        new ConnectError("unavailable", Code.Unavailable),
      );

      await expect(show()).rejects.toThrow("unavailable");
    });
  });
});
