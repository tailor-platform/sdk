import { Code, ConnectError } from "@connectrpc/connect";
import { Subgraph_ServiceType } from "@tailor-proto/tailor/v1/application_resource_pb";
import { describe, expect, test, vi } from "vitest";
import { logger, symbols } from "@/cli/shared/logger";
import { diffHttpAdapterDisplay, planApplication } from "./application";
import type { PlanContext } from "./deploy";
import type { Application } from "@/cli/services/application";
import type { OperatorClient } from "@/cli/shared/client";

vi.mock("./label", async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    buildMetaRequest: vi
      .fn()
      .mockImplementation(
        async ({ trn, appName, appId }: { trn: string; appName: string; appId?: string }) => ({
          trn,
          labels: {
            "sdk-name": appName,
            "sdk-version": "v1-0-0",
            ...(appId ? { "sdk-app-id": `app-${appId}` } : {}),
          },
        }),
      ),
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
    name?: string;
    id?: string;
    cors?: string[];
    staticWebsiteServices?: Array<{ name: string }>;
  } = {},
): Application {
  return {
    name: overrides.name ?? appName,
    id: overrides.id,
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
    sdkAppId?: string;
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
                ...(application.sdkAppId ? { "sdk-app-id": `app-${application.sdkAppId}` } : {}),
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

  describe("rename detection via sdk-app-id", () => {
    test("creates new app and deletes old when name changed but id matches", async () => {
      const appId = "stable-id";
      const oldName = "old-app-name";
      const client = createMockClient([
        {
          name: oldName,
          authNamespace: "auth-a",
          authIdpConfigName: "idp-a",
          subgraphs: [
            { serviceType: Subgraph_ServiceType.TAILORDB, serviceNamespace: "tailordb-a" },
            { serviceType: Subgraph_ServiceType.PIPELINE, serviceNamespace: "pipeline-a" },
          ],
          sdkAppId: appId,
        },
      ]);
      const application = createMockApplication({ name: appName, id: appId });

      const result = await planApplication(createContext(client, application));

      expect(result.creates).toHaveLength(1);
      expect(result.creates[0].name).toBe(appName);
      expect(result.deletes).toHaveLength(1);
      expect(result.deletes[0].name).toBe(oldName);
    });

    test("ignores apps with the same id when name still matches", async () => {
      const appId = "stable-id";
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
          sdkAppId: appId,
        },
      ]);
      const application = createMockApplication({ name: appName, id: appId });

      const result = await planApplication(createContext(client, application));

      expect(result.unchanged).toHaveLength(1);
      expect(result.creates).toHaveLength(0);
      expect(result.deletes).toHaveLength(0);
    });

    test("does not delete unrelated apps when only sdk-name matches a different app", async () => {
      const client = createMockClient([
        {
          name: "other-app",
          authNamespace: "auth-a",
          authIdpConfigName: "idp-a",
          subgraphs: [
            { serviceType: Subgraph_ServiceType.TAILORDB, serviceNamespace: "tailordb-a" },
            { serviceType: Subgraph_ServiceType.PIPELINE, serviceNamespace: "pipeline-a" },
          ],
          label: "other-app",
          sdkAppId: "different-id",
        },
      ]);
      const application = createMockApplication({ name: appName, id: "stable-id" });

      const result = await planApplication(createContext(client, application));

      expect(result.creates).toHaveLength(1);
      expect(result.deletes).toHaveLength(0);
    });

    test("forRemoval also deletes id-matched renamed apps", async () => {
      const appId = "stable-id";
      const oldName = "old-app-name";
      const client = createMockClient([
        {
          name: oldName,
          authNamespace: "auth-a",
          authIdpConfigName: "idp-a",
          subgraphs: [
            { serviceType: Subgraph_ServiceType.TAILORDB, serviceNamespace: "tailordb-a" },
            { serviceType: Subgraph_ServiceType.PIPELINE, serviceNamespace: "pipeline-a" },
          ],
          sdkAppId: appId,
        },
      ]);
      const application = createMockApplication({ name: appName, id: appId });

      const result = await planApplication({
        ...createContext(client, application),
        forRemoval: true,
      });

      expect(result.deletes).toHaveLength(1);
      expect(result.deletes[0].name).toBe(oldName);
      expect(result.creates).toHaveLength(0);
    });
  });

  describe("forRemoval ownership check (issue #1279)", () => {
    test("deletes a same-name app owned via legacy sdk-name (no sdk-app-id)", async () => {
      const client = createMockClient([
        {
          name: appName,
          label: appName,
        },
      ]);
      const application = createMockApplication({ name: appName });

      const result = await planApplication({
        ...createContext(client, application),
        forRemoval: true,
      });

      expect(result.deletes).toHaveLength(1);
      expect(result.deletes[0].name).toBe(appName);
    });

    test("deletes a same-name app owned via matching sdk-app-id", async () => {
      const appId = "stable-id";
      const client = createMockClient([
        {
          name: appName,
          label: appName,
          sdkAppId: appId,
        },
      ]);
      const application = createMockApplication({ name: appName, id: appId });

      const result = await planApplication({
        ...createContext(client, application),
        forRemoval: true,
      });

      expect(result.deletes).toHaveLength(1);
      expect(result.deletes[0].name).toBe(appName);
    });

    test("does not delete a same-name app owned by a different id", async () => {
      const client = createMockClient([
        {
          name: appName,
          label: appName,
          sdkAppId: "someone-elses-id",
        },
      ]);
      const application = createMockApplication({ name: appName, id: "my-id" });

      const result = await planApplication({
        ...createContext(client, application),
        forRemoval: true,
      });

      expect(result.deletes).toHaveLength(0);
    });

    test("does not delete a same-name app that carries no SDK labels", async () => {
      const client = {
        ...createMockClient([{ name: appName }]),
        getMetadata: vi.fn().mockResolvedValue({ metadata: { labels: {} } }),
      } as unknown as OperatorClient;
      const application = createMockApplication({ name: appName });

      const result = await planApplication({
        ...createContext(client, application),
        forRemoval: true,
      });

      expect(result.deletes).toHaveLength(0);
    });

    test("does not fetch metadata for unrelated apps when no id is configured", async () => {
      const client = createMockClient([
        { name: appName, label: appName },
        { name: "other-app", label: "other-app" },
        { name: "another-app", label: "another-app" },
      ]);
      const application = createMockApplication({ name: appName });

      const result = await planApplication({
        ...createContext(client, application),
        forRemoval: true,
      });

      // Only the same-name app is deleted, and metadata is fetched for it alone.
      expect(result.deletes).toHaveLength(1);
      expect(result.deletes[0].name).toBe(appName);
      expect(client.getMetadata).toHaveBeenCalledTimes(1);
    });
  });

  describe("CORS resolution on first deployment (issue #1030)", () => {
    test("does not warn when CORS references a locally-defined static website that is not yet on the platform", async () => {
      using warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
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
      using warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
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

describe("diffHttpAdapterDisplay", () => {
  function adapter(name: string, overrides: { pathPattern?: string; priority?: number } = {}) {
    return {
      name,
      pathPattern: overrides.pathPattern ?? `/${name}`,
      methods: ["GET"],
      inputScript: "input",
      outputScript: "",
      enabled: true,
      priority: overrides.priority ?? 0,
    };
  }

  test("treats every adapter as created when none exist remotely", () => {
    const lines = diffHttpAdapterDisplay(undefined, [adapter("a"), adapter("b")]);
    expect(lines).toEqual([
      `${symbols.create} a (httpAdapter)`,
      `${symbols.create} b (httpAdapter)`,
    ]);
  });

  test("classifies create / update / delete and sorts by name", () => {
    const existing = [adapter("keep"), adapter("change", { priority: 0 }), adapter("gone")];
    const desired = [adapter("keep"), adapter("change", { priority: 5 }), adapter("new")];

    const lines = diffHttpAdapterDisplay(existing, desired);

    // "keep" is identical → omitted; sorted by adapter name.
    expect(lines).toEqual([
      `${symbols.update} change (httpAdapter)`,
      `${symbols.delete} gone (httpAdapter)`,
      `${symbols.create} new (httpAdapter)`,
    ]);
  });

  test("returns no lines when adapters are unchanged", () => {
    const same = [adapter("a"), adapter("b")];
    expect(diffHttpAdapterDisplay(same, [...same])).toEqual([]);
  });
});
