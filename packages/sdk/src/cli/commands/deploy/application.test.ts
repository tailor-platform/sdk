import { Code, ConnectError } from "@connectrpc/connect";
import { Subgraph_ServiceType } from "@tailor-proto/tailor/v1/application_resource_pb";
import { afterEach, describe, expect, test, vi } from "vitest";
import { logger } from "@/cli/shared/logger";
import { planApplication } from "./application";
import type { PlanContext } from "./deploy";
import type { Application } from "@/cli/services/application";
import type { OperatorClient } from "@/cli/shared/client";

vi.mock("./label", async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    buildMetaRequest: vi.fn().mockResolvedValue({
      trn: "trn:v1:workspace:test-workspace:application:test-app",
      labels: {
        "sdk-name": "test-app",
        "sdk-version": "v1-0-0",
      },
    }),
  };
});

vi.mock("./change-set", async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  const createChangeSet = original.createChangeSet as (title: string) => {
    print: () => void;
  };
  return {
    ...original,
    createChangeSet: (title: string) => ({
      ...createChangeSet(title),
      print: () => {},
    }),
  };
});

const workspaceId = "test-workspace";
const appName = "test-app";

function createMockApplication(
  overrides: {
    cors?: string[];
    staticWebsiteServices?: Array<{ name: string }>;
  } = {},
): Application {
  return {
    name: appName,
    subgraphs: [
      { Type: "pipeline", Name: "pipeline-a" },
      { Type: "tailordb", Name: "tailordb-a" },
    ],
    config: {
      cors: overrides.cors ?? ["https://b.example.com", "https://a.example.com"],
      allowedIpAddresses: ["2.2.2.2", "1.1.1.1"],
      disableIntrospection: true,
    },
    staticWebsiteServices: overrides.staticWebsiteServices ?? [],
    authService: {
      config: {
        name: "auth-a",
        idProvider: {
          name: "idp-a",
        },
      },
    },
  } as unknown as Application;
}

function createMockClient(
  applications: Array<{
    name: string;
    authNamespace?: string;
    authIdpConfigName?: string;
    cors?: string[];
    allowedIpAddresses?: string[];
    disableIntrospection?: boolean;
    disabled?: boolean;
    subgraphs?: Array<{ serviceType: number; serviceNamespace: string }>;
    sdkVersion?: string;
    label?: string;
  }>,
): OperatorClient {
  return {
    listApplications: vi.fn().mockResolvedValue({
      applications,
      nextPageToken: "",
    }),
    listAuthIDPConfigs: vi.fn().mockResolvedValue({
      idpConfigs: [],
      nextPageToken: "",
    }),
    getMetadata: vi.fn().mockImplementation(({ trn }: { trn: string }) => {
      const name = trn.split(":").pop();
      const application = applications.find((app) => app.name === name);
      return {
        metadata: {
          labels: application
            ? {
                "sdk-name": application.label ?? appName,
                "sdk-version": application.sdkVersion ?? "v1-0-0",
              }
            : {},
        },
      };
    }),
  } as unknown as OperatorClient;
}

function createContext(client: OperatorClient, application = createMockApplication()): PlanContext {
  return {
    client,
    workspaceId,
    application,
    forRemoval: false,
    config: { path: "/test/tailor.config.ts" } as PlanContext["config"],
  };
}

describe("planApplication", () => {
  test("marks application unchanged when remote state matches desired state", async () => {
    const client = createMockClient([
      {
        name: appName,
        authNamespace: "auth-a",
        authIdpConfigName: "idp-a",
        cors: ["https://a.example.com", "https://b.example.com"],
        allowedIpAddresses: ["1.1.1.1", "2.2.2.2"],
        disableIntrospection: true,
        disabled: false,
        subgraphs: [
          { serviceType: Subgraph_ServiceType.TAILORDB, serviceNamespace: "tailordb-a" },
          { serviceType: Subgraph_ServiceType.PIPELINE, serviceNamespace: "pipeline-a" },
        ],
      },
    ]);

    const result = await planApplication(createContext(client));

    expect(result.unchanged).toHaveLength(1);
    expect(result.unchanged[0].name).toBe(appName);
    expect(result.updates).toHaveLength(0);
  });

  test("marks application updated when remote state matches but ownership differs", async () => {
    const client = createMockClient([
      {
        name: appName,
        authNamespace: "auth-a",
        authIdpConfigName: "idp-a",
        cors: ["https://a.example.com", "https://b.example.com"],
        allowedIpAddresses: ["1.1.1.1", "2.2.2.2"],
        disableIntrospection: true,
        disabled: false,
        label: "other-app",
        subgraphs: [
          { serviceType: Subgraph_ServiceType.TAILORDB, serviceNamespace: "tailordb-a" },
          { serviceType: Subgraph_ServiceType.PIPELINE, serviceNamespace: "pipeline-a" },
        ],
      },
    ]);

    const result = await planApplication(createContext(client));

    expect(result.updates).toHaveLength(1);
    expect(result.unchanged).toHaveLength(0);
  });

  test("marks application updated when remote state differs", async () => {
    const client = createMockClient([
      {
        name: appName,
        authNamespace: "auth-a",
        authIdpConfigName: "idp-a",
        cors: ["https://a.example.com"],
        allowedIpAddresses: ["1.1.1.1"],
        disableIntrospection: false,
        disabled: false,
        subgraphs: [
          { serviceType: Subgraph_ServiceType.TAILORDB, serviceNamespace: "tailordb-a" },
          { serviceType: Subgraph_ServiceType.PIPELINE, serviceNamespace: "pipeline-a" },
        ],
      },
    ]);

    const result = await planApplication(createContext(client));

    expect(result.updates).toHaveLength(1);
    expect(result.updates[0].name).toBe(appName);
    expect(result.unchanged).toHaveLength(0);
  });

  test("marks application updated when sdk version differs", async () => {
    const client = createMockClient([
      {
        name: appName,
        authNamespace: "auth-a",
        authIdpConfigName: "idp-a",
        cors: ["https://a.example.com", "https://b.example.com"],
        allowedIpAddresses: ["1.1.1.1", "2.2.2.2"],
        disableIntrospection: true,
        disabled: false,
        subgraphs: [
          {
            serviceType: Subgraph_ServiceType.TAILORDB,
            serviceNamespace: "tailordb-a",
          },
          {
            serviceType: Subgraph_ServiceType.PIPELINE,
            serviceNamespace: "pipeline-a",
          },
        ],
        sdkVersion: "v0-9-0",
      },
    ]);

    const result = await planApplication(createContext(client));

    expect(result.updates).toHaveLength(1);
    expect(result.updates[0].name).toBe(appName);
    expect(result.unchanged).toHaveLength(0);
  });

  test("creates application when it does not exist", async () => {
    const client = createMockClient([]);

    const result = await planApplication(createContext(client));

    expect(result.creates).toHaveLength(1);
    expect(result.creates[0].name).toBe(appName);
    expect(result.updates).toHaveLength(0);
    expect(result.unchanged).toHaveLength(0);
  });

  describe("CORS resolution on first deployment (issue #1030)", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    test("does not warn when CORS references a locally-defined static website that is not yet on the platform", async () => {
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      const client = {
        ...createMockClient([]),
        getStaticWebsite: vi.fn().mockRejectedValue(new ConnectError("not found", Code.NotFound)),
      } as unknown as OperatorClient;
      const application = createMockApplication({
        cors: ["my-frontend:url"],
        staticWebsiteServices: [{ name: "my-frontend" }],
      });

      const result = await planApplication(createContext(client, application));

      expect(result.creates).toHaveLength(1);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    test("still warns when CORS references a static website that is not defined locally", async () => {
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      const client = {
        ...createMockClient([]),
        getStaticWebsite: vi.fn().mockRejectedValue(new ConnectError("not found", Code.NotFound)),
      } as unknown as OperatorClient;
      const application = createMockApplication({
        cors: ["typo-name:url"],
        staticWebsiteServices: [{ name: "my-frontend" }],
      });

      await planApplication(createContext(client, application));

      expect(warnSpy).toHaveBeenCalledWith(
        'Static website "typo-name" not found for CORS configuration. Excluding from CORS.',
      );
    });
  });
});
