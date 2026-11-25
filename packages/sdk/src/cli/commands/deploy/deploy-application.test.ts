import { describe, expect, test } from "vitest";
import {
  applicationsListing,
  configAuthNamespaces,
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
    dbReplicationDestinations: [],
    dbReplications: [],
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

describe("configAuthNamespaces", () => {
  const authService = (name: string) =>
    ({ config: { name } }) as Application["authServices"][number];
  const app = (authNamespace: string | undefined): DeployApplication => ({
    name: "shop",
    subgraphs: [],
    authNamespace,
    settings: {},
  });

  test("lists the Auth services the config defines and the external Auth its application uses", () => {
    expect(
      configAuthNamespaces({
        application: { authServices: [authService("shop-auth")] },
        applications: [app("shop-auth")],
      }),
    ).toEqual(["shop-auth"]);
    expect(
      configAuthNamespaces({
        application: { authServices: [] },
        applications: [app("shared-auth")],
      }),
    ).toEqual(["shared-auth"]);
    expect(
      configAuthNamespaces({ application: { authServices: [] }, applications: [app(undefined)] }),
    ).toEqual([]);
  });

  test("lists every Auth service of a workspace config, including ones no application uses", () => {
    expect(
      configAuthNamespaces({
        application: { authServices: [authService("shop-auth"), authService("admin-auth")] },
        applications: [app("shop-auth"), app(undefined)],
      }),
    ).toEqual(["shop-auth", "admin-auth"]);
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

describe("applicationsListing", () => {
  test("names the applications whose subgraphs list a service, in config order", () => {
    const app = (name: string, subgraphs: DeployApplication["subgraphs"]): DeployApplication => ({
      name,
      subgraphs,
      authNamespace: undefined,
      settings: {},
    });
    const applications = [
      app("shop", [
        { Type: "tailordb", Name: "main" },
        { Type: "pipeline", Name: "main" },
      ]),
      app("admin", [{ Type: "tailordb", Name: "main" }]),
      app("landing", [{ Type: "pipeline", Name: "main" }]),
    ];

    expect(applicationsListing(applications, "tailordb", "main")).toEqual(["shop", "admin"]);
    expect(applicationsListing(applications, "pipeline", "main")).toEqual(["shop", "landing"]);
    expect(applicationsListing(applications, "idp", "main")).toEqual([]);
  });
});
