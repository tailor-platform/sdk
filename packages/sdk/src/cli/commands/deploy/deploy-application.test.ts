import { describe, expect, test } from "vitest";
import {
  configAuthNamespace,
  deployApplicationOf,
  workspaceDeployApplications,
} from "./deploy-application";
import type { Application } from "#/cli/services/application";
import type { DeployApplication } from "./deploy-application";

function application(overrides: Partial<Application>): Application {
  return {
    name: "shop",
    id: "app-id",
    config: { name: "shop" },
    subgraphs: [],
    tailorDBServices: [],
    externalTailorDBNamespaces: [],
    resolverServices: [],
    idpServices: [],
    authServices: [],
    executorService: undefined,
    workflowService: undefined,
    httpAdapterService: undefined,
    staticWebsiteServices: [],
    aiGatewayServices: [],
    secrets: [],
    ignoreNullishValues: false,
    env: {},
    ...overrides,
  };
}

describe("deployApplicationOf", () => {
  test("keeps the name, subgraphs, and application settings of a defineConfig application", () => {
    const subgraphs = [
      { Type: "tailordb", Name: "main" },
      { Type: "pipeline", Name: "api" },
    ];

    expect(
      deployApplicationOf(
        application({
          subgraphs,
          config: {
            name: "shop",
            cors: ["https://shop.example.com"],
            allowedIpAddresses: ["192.0.2.1/32"],
            disableIntrospection: true,
            metadata: { framework: "v1" },
            env: { FLAG: true },
          },
        }),
      ),
    ).toEqual({
      name: "shop",
      subgraphs,
      authNamespace: undefined,
      settings: {
        cors: ["https://shop.example.com"],
        allowedIpAddresses: ["192.0.2.1/32"],
        disableIntrospection: true,
        metadata: { framework: "v1" },
      },
    });
  });

  test("takes the Auth namespace from the config's Auth service, or from an external one", () => {
    const authService = { config: { name: "shop-auth" } } as Application["authServices"][number];

    expect(deployApplicationOf(application({ authServices: [authService] })).authNamespace).toBe(
      "shop-auth",
    );
    expect(
      deployApplicationOf(
        application({ config: { name: "shop", auth: { name: "shared-auth", external: true } } }),
      ).authNamespace,
    ).toBe("shared-auth");
  });
});

describe("configAuthNamespace", () => {
  const authService = { config: { name: "shop-auth" } } as Application["authServices"][number];
  const app = (authNamespace: string | undefined): DeployApplication => ({
    name: "shop",
    subgraphs: [],
    authNamespace,
    settings: {},
  });

  test("returns the Auth service the config defines, or the external Auth its application uses", () => {
    expect(
      configAuthNamespace({
        application: { authServices: [authService] },
        applications: [app("shop-auth")],
      }),
    ).toBe("shop-auth");
    expect(
      configAuthNamespace({
        application: { authServices: [] },
        applications: [app("shared-auth")],
      }),
    ).toBe("shared-auth");
    expect(
      configAuthNamespace({ application: { authServices: [] }, applications: [app(undefined)] }),
    ).toBeUndefined();
  });
});

describe("workspaceDeployApplications", () => {
  test("describes every application of a workspace config with the services it lists", () => {
    expect(
      workspaceDeployApplications({
        shop: {
          db: ["customer-db", "order-db"],
          resolver: ["shop-api"],
          idp: "shop-idp",
          auth: "shop-auth",
          cors: ["https://shop.example.com"],
          disableIntrospection: true,
        },
        admin: { db: ["order-db"], resolver: [] },
      }),
    ).toEqual([
      {
        name: "shop",
        subgraphs: [
          { Type: "tailordb", Name: "customer-db" },
          { Type: "tailordb", Name: "order-db" },
          { Type: "pipeline", Name: "shop-api" },
          { Type: "idp", Name: "shop-idp" },
          { Type: "auth", Name: "shop-auth" },
        ],
        authNamespace: "shop-auth",
        settings: { cors: ["https://shop.example.com"], disableIntrospection: true },
      },
      {
        name: "admin",
        subgraphs: [{ Type: "tailordb", Name: "order-db" }],
        authNamespace: undefined,
        settings: {},
      },
    ] satisfies DeployApplication[]);
  });
});
