import * as fs from "node:fs";
import * as os from "node:os";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { runCommand } from "@politty/zod";
import { Subgraph_ServiceType } from "@tailor-platform/tailor-proto/application_resource_pb";
import * as path from "pathe";
import { afterEach, aroundEach, describe, expect, test, vi } from "vitest";
import { initOperatorClient } from "#/cli/shared/client";
import { loadConfigFile } from "#/cli/shared/config-loader";
import { loadAccessToken, loadWorkspaceId } from "#/cli/shared/context";
import { logger } from "#/cli/shared/logger";
import { captureStdout } from "#/cli/shared/test-helpers/capture-output";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
import { mockOperatorClient } from "#/cli/shared/test-helpers/operator-client";
import { silenceLogger } from "#/cli/shared/test-helpers/silence-logger";
import { brandedDefault } from "#/cli/shared/test-helpers/workspace-config";
import { show, showCommand } from "./show";
import type * as ConfigLoader from "#/cli/shared/config-loader";
import type { MessageInitShape } from "@bufbuild/protobuf";
import type { ApplicationSchema } from "@tailor-platform/tailor-proto/application_resource_pb";

vi.mock("#/cli/shared/context", async (importOriginal) => ({
  ...(await importOriginal()),
  loadAccessToken: vi.fn(),
  loadWorkspaceId: vi.fn(),
}));

vi.mock("#/cli/shared/client", async (importOriginal) => ({
  ...(await importOriginal()),
  initOperatorClient: vi.fn(),
}));

vi.mock(import("#/cli/shared/config-loader"), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, loadConfigFile: vi.fn(actual.loadConfigFile) };
});

function mockConfig(config: Record<string, unknown>) {
  vi.mocked(loadConfigFile).mockResolvedValue({
    kind: "config",
    config: { name: "my-app", ...config },
    plugins: [],
  } as unknown as Awaited<ReturnType<typeof loadConfigFile>>);
}

describe("show", () => {
  let client: ReturnType<typeof createClient>;

  const application = {
    name: "my-app",
    domain: "my-app.example.com",
    url: "https://my-app.example.com",
    authNamespace: "my-auth",
    subgraphs: [],
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
    mockConfig({ aiGateways: [{ name: "gateway-a" }, { name: "gateway-b" }] });

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

    expect(loadConfigFile).toHaveBeenCalledWith(configPath);
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
    mockConfig({ aiGateways: [{ name: "gateway-a" }, { name: "gateway-a" }] });
    client.getAIGateway.mockResolvedValue({
      aigateway: { name: "gateway-a", url: "https://gateway-a.example.com" },
    });

    const info = await show();

    expect(info.aiGateways).toEqual([{ name: "gateway-a", url: "https://gateway-a.example.com" }]);
    expect(client.getAIGateway).toHaveBeenCalledTimes(1);
  });

  test("returns an empty array when no AI Gateway is configured", async () => {
    mockConfig({});

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

  test("lists the subgraphs of the application", async () => {
    client.getApplication.mockResolvedValue({
      application: {
        ...application,
        subgraphs: [
          { serviceType: Subgraph_ServiceType.TAILORDB, serviceNamespace: "main-db" },
          { serviceType: Subgraph_ServiceType.AUTH, serviceNamespace: "my-auth" },
        ],
      },
    });

    const info = await show();

    expect(info.subgraphs).toEqual([
      { type: "tailordb", namespace: "main-db" },
      { type: "auth", namespace: "my-auth" },
    ]);
  });

  test("names an unknown subgraph type unspecified", async () => {
    client.getApplication.mockResolvedValue({
      application: {
        ...application,
        subgraphs: [{ serviceType: 99 as Subgraph_ServiceType, serviceNamespace: "future" }],
      },
    });

    const info = await show();

    expect(info.subgraphs).toEqual([{ type: "unspecified", namespace: "future" }]);
  });

  test("fails with one error when the application and an AI Gateway cannot be read", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      client.getApplication.mockRejectedValue(new ConnectError("unavailable", Code.Unavailable));
      client.getAIGateway.mockRejectedValue(new ConnectError("unavailable", Code.Unavailable));

      await expect(show()).rejects.toThrow("unavailable");
      await new Promise((resolve) => setImmediate(resolve));

      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  test("rejects --app that is not the application of a defineConfig() config", async () => {
    const result = await runCommand(showCommand, ["--app", "other-app"]);

    expect(result.error).toMatchObject({ code: "CONFIG_APP_NOT_FOUND" });
    expect(client.getApplication).not.toHaveBeenCalled();
  });

  describe("workspace config", () => {
    const tempDirs: string[] = [];

    afterEach(() => {
      for (const dir of tempDirs.splice(0)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    async function writeWorkspaceConfig(apps: string): Promise<string> {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tailor-show-"));
      tempDirs.push(dir);
      const configPath = path.join(dir, "tailor.config.ts");
      fs.writeFileSync(
        configPath,
        brandedDefault(
          "workspace-config",
          `{
            db: { "customer-db": { files: [] }, "order-db": { files: [] } },
            auth: {
              "shop-auth": {
                name: "shop-auth",
                oauth2Clients: {
                  web: { redirectURIs: ["https://web.example.com"], grantTypes: ["authorization_code"] },
                },
              },
              "admin-auth": { name: "admin-auth" },
            },
            staticWebsites: [{ name: "shop-front" }],
            apps: ${apps},
          }`,
        ),
      );
      const actual = await vi.importActual<typeof ConfigLoader>("#/cli/shared/config-loader");
      vi.mocked(loadConfigFile).mockImplementation(actual.loadConfigFile);
      return configPath;
    }

    const twoApps = `{
      shop: { db: ["customer-db", "order-db"], auth: "shop-auth" },
      backoffice: { db: ["customer-db"], auth: "admin-auth" },
    }`;

    function serveApplications() {
      client.getApplication.mockImplementation((request) =>
        Promise.resolve({
          application: {
            ...application,
            name: request.applicationName,
            url: `https://${request.applicationName ?? ""}.example.com`,
            authNamespace: request.applicationName === "shop" ? "shop-auth" : "admin-auth",
          },
        }),
      );
      client.getStaticWebsite.mockResolvedValue({
        staticwebsite: { name: "shop-front", url: "https://front.example.com", description: "" },
      });
      client.listAuthOAuth2Clients.mockResolvedValue({
        oauth2Clients: [{ name: "web", clientId: "web-id" }],
        nextPageToken: "",
      });
    }

    test("prints the workspace and every application without --app when the config defines several", async () => {
      const configPath = await writeWorkspaceConfig(twoApps);
      serveApplications();
      using stdout = captureStdout();
      using _json = jsonMode();

      const result = await runCommand(showCommand, ["--config", configPath]);

      expect(result.error).toBeUndefined();
      const output = JSON.parse(stdout.output);
      expect(output).toEqual({
        workspaceId: "workspace-1",
        workspaceName: "my-workspace",
        workspaceRegion: "us",
        applications: [
          expect.objectContaining({
            name: "shop",
            url: "https://shop.example.com",
            auth: "shop-auth",
            aiGateways: [],
            staticWebsites: [
              { name: "shop-front", url: "https://front.example.com", description: "" },
            ],
            oauth2Clients: [{ name: "web", clientId: "web-id" }],
          }),
          expect.objectContaining({
            name: "backoffice",
            url: "https://backoffice.example.com",
            auth: "admin-auth",
            oauth2Clients: [],
          }),
        ],
      });
      expect(output.applications[0]).not.toHaveProperty("workspaceId");
    });

    test.each(["shop", "backoffice"])(
      "prints the application --app %s names as show does for one application",
      async (app) => {
        const configPath = await writeWorkspaceConfig(twoApps);
        serveApplications();

        const info = await show({ configPath, app });

        expect(info).toEqual(
          expect.objectContaining({
            name: app,
            url: `https://${app}.example.com`,
            workspaceId: "workspace-1",
          }),
        );
        expect(client.getApplication).toHaveBeenCalledWith({
          workspaceId: "workspace-1",
          applicationName: app,
        });
        expect(client.getApplication).toHaveBeenCalledTimes(1);
      },
    );

    test("prints the only application of a config without --app", async () => {
      const configPath = await writeWorkspaceConfig(`{ shop: { db: ["customer-db"] } }`);
      serveApplications();

      const info = await show({ configPath });

      expect(info).toEqual(expect.objectContaining({ name: "shop", workspaceId: "workspace-1" }));
    });

    test("rejects --app that the config does not define, listing the applications it does", async () => {
      const configPath = await writeWorkspaceConfig(twoApps);

      const result = await runCommand(showCommand, ["--config", configPath, "--app", "admin"]);

      expect(result.error).toMatchObject({
        code: "CONFIG_APP_NOT_FOUND",
        suggestion: expect.stringContaining("shop, backoffice"),
      });
      expect(client.getApplication).not.toHaveBeenCalled();
    });

    test("lists the OAuth2 clients of an auth namespace once for the applications that share it", async () => {
      using warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      const configPath = await writeWorkspaceConfig(`{
        shop: { db: ["customer-db"], auth: "shop-auth" },
        storefront: { db: ["order-db"], auth: "shop-auth" },
      }`);
      serveApplications();
      client.getApplication.mockImplementation((request) =>
        Promise.resolve({
          application: {
            ...application,
            name: request.applicationName,
            authNamespace: "shop-auth",
          },
        }),
      );
      client.listAuthOAuth2Clients.mockRejectedValue(
        new ConnectError("permission denied", Code.PermissionDenied),
      );
      using _stdout = captureStdout();
      using _json = jsonMode();

      const result = await runCommand(showCommand, ["--config", configPath]);

      expect(result.error).toBeUndefined();
      expect(client.listAuthOAuth2Clients).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    test("show() requires app when the config defines several applications", async () => {
      const configPath = await writeWorkspaceConfig(twoApps);

      await expect(show({ configPath })).rejects.toMatchObject({ code: "CONFIG_APP_REQUIRED" });
      expect(client.getApplication).not.toHaveBeenCalled();
    });
  });
});
