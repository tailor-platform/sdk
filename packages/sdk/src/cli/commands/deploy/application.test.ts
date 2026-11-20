import { Code, ConnectError } from "@connectrpc/connect";
import { Subgraph_ServiceType } from "@tailor-platform/tailor-proto/application_resource_pb";
import { describe, expect, test, vi } from "vitest";
import { logger, symbols } from "#/cli/shared/logger";
import {
  mockOperatorClient,
  type OperatorClientMocks,
  withOperatorClientMocks,
} from "#/cli/shared/test-helpers/operator-client";
import {
  applicationLabelLimitError,
  applyApplication,
  diffHttpAdapterDisplay,
  planApplication,
  recomposeApplication,
} from "./application";
import { applicationOwner, withMetadataWriteBatch } from "./label";
import {
  applicationLabelRejection,
  labelCountRejection,
} from "./test-helpers/label-count-rejection";
import type { Application } from "#/cli/services/application";
import type { OperatorClient } from "#/cli/shared/client";
import type { DeployOwner } from "./label";
import type { PlanContext } from "./types";
import type { MessageInitShape } from "@bufbuild/protobuf";
import type {
  ApplicationSchema,
  SubgraphSchema,
} from "@tailor-platform/tailor-proto/application_resource_pb";

vi.mock("./label", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    buildMetaRequest: vi
      .fn()
      .mockImplementation(async ({ trn, owner }: { trn: string; owner: DeployOwner }) => {
        const { name, id } = owner.kind === "application" ? owner : { name: "", id: undefined };
        return {
          trn,
          labels: {
            "sdk-name": name,
            "sdk-version": "v1-0-0",
            ...(id ? { "sdk-app-id": `app-${id}` } : {}),
          },
          // Mirrors the real buildMetaRequest: a config with no id asks for the
          // stale sdk-app-id to be dropped.
          remove: id ? undefined : ["sdk-app-id"],
        };
      }),
  };
});

vi.mock("./change-set", async (importOriginal) => importOriginal());

const workspaceId = "test-workspace";
const labelEntries = (prefix: string, count: number) =>
  Object.fromEntries(Array.from({ length: count }, (_, index) => [`${prefix}-${index}`, "v1"]));
const appName = "test-app";
const matchingSubgraphs = [
  { serviceType: Subgraph_ServiceType.TAILORDB, serviceNamespace: "tailordb-a" },
  { serviceType: Subgraph_ServiceType.PIPELINE, serviceNamespace: "pipeline-a" },
] satisfies Array<MessageInitShape<typeof SubgraphSchema>>;

function createMockApplication(
  overrides: {
    name?: string;
    id?: string;
    cors?: string[];
    metadata?: Record<string, string>;
    subgraphs?: Array<{ Type: string; Name: string }>;
    staticWebsiteServices?: Array<{ name: string }>;
  } = {},
): Application {
  return {
    name: overrides.name ?? appName,
    id: overrides.id,
    subgraphs: overrides.subgraphs ?? [
      { Type: "pipeline", Name: "pipeline-a" },
      { Type: "tailordb", Name: "tailordb-a" },
    ],
    config: {
      cors: overrides.cors ?? ["https://b.example.com", "https://a.example.com"],
      allowedIpAddresses: ["2.2.2.2", "1.1.1.1"],
      disableIntrospection: true,
      metadata: overrides.metadata,
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

type RemoteApplication = MessageInitShape<typeof ApplicationSchema> & {
  name: string;
  sdkVersion?: string;
  label?: string;
  sdkAppId?: string;
  extraLabels?: Record<string, string>;
};

function createMockClient<K extends keyof OperatorClient = never>(
  applications: RemoteApplication[],
  overrides?: OperatorClientMocks<K>,
): OperatorClient {
  const client = mockOperatorClient({
    listApplications: {
      applications: applications.map(
        ({
          sdkVersion: _sdkVersion,
          label: _label,
          sdkAppId: _sdkAppId,
          extraLabels: _extraLabels,
          ...application
        }): MessageInitShape<typeof ApplicationSchema> => application,
      ),
      nextPageToken: "",
    },
    listAuthIDPConfigs: {
      idpConfigs: [],
      nextPageToken: "",
    },
    getStaticWebsite: () => Promise.reject(new ConnectError("not found", Code.NotFound)),
    getMetadata: (request) => {
      const name = request.trn?.split(":").pop();
      const application = applications.find((app) => app.name === name);
      const labels: Record<string, string> = application
        ? {
            "sdk-name": application.label ?? appName,
            "sdk-version": application.sdkVersion ?? "v1-0-0",
            ...(application.sdkAppId ? { "sdk-app-id": `app-${application.sdkAppId}` } : {}),
            ...application.extraLabels,
          }
        : {};
      return { metadata: { labels } };
    },
  });
  return withOperatorClientMocks(client, overrides);
}

function createContext(client: OperatorClient, application = createMockApplication()): PlanContext {
  return {
    client,
    workspaceId,
    application,
    owner: applicationOwner(application),
    forRemoval: false,
    config: { path: "/test/tailor.config.ts" } as PlanContext["config"],
  };
}

async function planForRemoval(client: OperatorClient, application: Application) {
  return planApplication({ ...createContext(client, application), forRemoval: true });
}

async function planWithoutSubgraphs(client: OperatorClient, application: Application) {
  return planApplication(createContext(client, { ...application, subgraphs: [] }));
}

describe("planApplication", () => {
  test("carries the sdk-app-id removal through for a config with no id", async () => {
    const client = createMockClient([
      {
        name: appName,
        authNamespace: "auth-a",
        authIdpConfigName: "idp-a",
        cors: ["https://a.example.com", "https://b.example.com"],
        allowedIpAddresses: ["1.1.1.1", "2.2.2.2"],
        disableIntrospection: true,
        disabled: false,
        subgraphs: matchingSubgraphs,
        sdkAppId: "stale-id",
      },
    ]);

    // sdk-app-id decides ownership on its own, so a stale one left in place makes
    // every later deploy ask to re-tag the resource again.
    const result = await planApplication(
      createContext(client, createMockApplication({ id: undefined })),
    );

    const [entry] = [...result.updates, ...result.unchanged];
    expect(entry?.metaRequest.remove).toContain("sdk-app-id");
  });

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
        subgraphs: matchingSubgraphs,
      },
    ]);

    const result = await planApplication(createContext(client));

    expect(result.unchanged).toHaveLength(1);
    expect(result.unchanged[0]!.name).toBe(appName);
    expect(result.updates).toHaveLength(0);
  });

  describe("config metadata", () => {
    const matchingApplication = {
      name: appName,
      authNamespace: "auth-a",
      authIdpConfigName: "idp-a",
      cors: ["https://a.example.com", "https://b.example.com"],
      allowedIpAddresses: ["1.1.1.1", "2.2.2.2"],
      disableIntrospection: true,
      disabled: false,
      subgraphs: matchingSubgraphs,
    } satisfies RemoteApplication;

    test("carries config metadata next to the application's SDK labels", async () => {
      const client = createMockClient([]);

      const result = await planApplication(
        createContext(client, createMockApplication({ metadata: { "erp-kit-version": "v1-2-3" } })),
      );

      expect(result.creates[0]?.metaRequest.labels).toMatchObject({ "sdk-name": appName });
      expect(result.creates[0]?.metadata).toEqual({ "erp-kit-version": "v1-2-3" });
    });

    test("marks application updated when a metadata entry is missing remotely", async () => {
      const client = createMockClient([matchingApplication]);

      const result = await planApplication(
        createContext(client, createMockApplication({ metadata: { "erp-kit-version": "v1-2-3" } })),
      );

      expect(result.unchanged).toHaveLength(0);
      expect(result.updates).toHaveLength(1);
      expect(result.updates[0]?.details).toEqual([`${symbols.create} erp-kit-version (metadata)`]);
    });

    test("does not mark a metadata change as forced by the SDK version", async () => {
      const client = createMockClient([{ ...matchingApplication, sdkVersion: "v0-9-0" }]);

      const result = await planApplication(
        createContext(client, createMockApplication({ metadata: { "erp-kit-version": "v1-2-3" } })),
      );

      expect(result.updates).toHaveLength(1);
      expect(result.updates[0]).not.toHaveProperty("forcedBySdkVersion");
    });

    test("marks application updated when a metadata entry differs remotely", async () => {
      const client = createMockClient([
        { ...matchingApplication, extraLabels: { "erp-kit-version": "v1-0-0", tier: "gold" } },
      ]);

      const result = await planApplication(
        createContext(
          client,
          createMockApplication({ metadata: { "erp-kit-version": "v1-2-3", tier: "gold" } }),
        ),
      );

      expect(result.unchanged).toHaveLength(0);
      expect(result.updates[0]?.details).toEqual([`${symbols.update} erp-kit-version (metadata)`]);
    });

    test("marks application unchanged when the stored labels already carry the metadata", async () => {
      const client = createMockClient([
        { ...matchingApplication, extraLabels: { "erp-kit-version": "v1-2-3" } },
      ]);

      const result = await planApplication(
        createContext(client, createMockApplication({ metadata: { "erp-kit-version": "v1-2-3" } })),
      );

      expect(result.unchanged).toHaveLength(1);
      expect(result.updates).toHaveLength(0);
    });

    test("treats a key named like an Object.prototype member as absent remotely", async () => {
      const client = createMockClient([matchingApplication]);

      const result = await planApplication(
        createContext(client, createMockApplication({ metadata: { constructor: "v1" } })),
      );

      expect(result.updates[0]?.details).toEqual([`${symbols.create} constructor (metadata)`]);
    });

    test("ignores stored labels the config metadata does not name", async () => {
      // A label removed from the config, or one set by another tool, is kept as-is.
      const client = createMockClient([
        { ...matchingApplication, extraLabels: { team: "billing" } },
      ]);

      for (const metadata of [undefined, {}]) {
        const result = await planApplication(
          createContext(client, createMockApplication({ metadata })),
        );

        expect(result.unchanged).toHaveLength(1);
        expect(result.updates).toHaveLength(0);
      }
    });

    test("plans labels past the platform's limit, leaving the count to the platform", async () => {
      // sdk-name and sdk-version are stored, so the config's id adds a 21st label.
      const client = createMockClient([
        { ...matchingApplication, extraLabels: labelEntries("other", 18) },
      ]);

      const result = await planApplication(
        createContext(client, createMockApplication({ id: "id-1", metadata: { team: "billing" } })),
      );

      expect(result.updates).toHaveLength(1);
    });

    test("plans no metadata write when the application has no subgraphs", async () => {
      const client = createMockClient([]);

      const result = await planWithoutSubgraphs(
        client,
        createMockApplication({ metadata: { "app-version": "v1-2-3" } }),
      );

      expect(result.creates).toHaveLength(0);
      expect(result.updates).toHaveLength(0);
      expect(result.unchanged).toHaveLength(0);
    });
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
        subgraphs: matchingSubgraphs,
      },
    ]);

    const result = await planApplication(createContext(client));

    expect(result.updates).toHaveLength(1);
    expect(result.updates[0]).not.toHaveProperty("forcedBySdkVersion");
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
        subgraphs: matchingSubgraphs,
      },
    ]);

    const result = await planApplication(createContext(client));

    expect(result.updates).toHaveLength(1);
    expect(result.updates[0]!.name).toBe(appName);
    expect(result.unchanged).toHaveLength(0);
  });

  test("uses planned external Auth IDP config names before remote lookup", async () => {
    const client = createMockClient([]);
    const baseApplication = createMockApplication();
    const application = {
      ...baseApplication,
      authService: undefined,
      config: {
        ...baseApplication.config,
        auth: { name: "peer-auth", external: true },
      },
      subgraphs: [{ Type: "auth", Name: "peer-auth" }],
    } as unknown as Application;

    const result = await planApplication({
      ...createContext(client, application),
      externalAuthIdpConfigNames: new Map([["peer-auth", "peer-idp"]]),
    });

    expect(client.listAuthIDPConfigs).not.toHaveBeenCalled();
    expect(result.creates[0]?.request.authIdpConfigName).toBe("peer-idp");
  });

  test("does not fall back to remote Auth IDP configs when peer Auth has no IDP config", async () => {
    const client = createMockClient([]);
    const baseApplication = createMockApplication();
    const application = {
      ...baseApplication,
      authService: undefined,
      config: {
        ...baseApplication.config,
        auth: { name: "peer-auth", external: true },
      },
      subgraphs: [{ Type: "auth", Name: "peer-auth" }],
    } as unknown as Application;

    const result = await planApplication({
      ...createContext(client, application),
      externalAuthIdpConfigNames: new Map([["peer-auth", undefined]]),
    });

    expect(client.listAuthIDPConfigs).not.toHaveBeenCalled();
    expect(result.creates[0]?.request.authIdpConfigName).toBeUndefined();
  });

  test("keeps peer static website URL patterns when the site is planned in the same deploy", async () => {
    const client = createMockClient([]);
    const application = createMockApplication({
      cors: ["peer-site:url/oauth/callback"],
    });

    const result = await planApplication({
      ...createContext(client, application),
      expectedLocalStaticWebsiteNames: new Set(["peer-site"]),
    });

    expect(client.getStaticWebsite).toHaveBeenCalledWith({
      workspaceId,
      name: "peer-site",
    });
    expect(result.creates[0]?.request.cors).toEqual(["peer-site:url/oauth/callback"]);
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
        subgraphs: matchingSubgraphs,
        sdkVersion: "v0-9-0",
      },
    ]);

    const result = await planApplication(createContext(client));

    expect(result.updates).toHaveLength(1);
    expect(result.updates[0]!.name).toBe(appName);
    expect(result.updates[0]?.forcedBySdkVersion).toBe(true);
    expect(result.unchanged).toHaveLength(0);
  });

  test("does not mark an sdk-version update whose config also differs as forced", async () => {
    const client = createMockClient([
      {
        name: appName,
        authNamespace: "auth-a",
        authIdpConfigName: "idp-a",
        cors: ["https://a.example.com"],
        allowedIpAddresses: ["1.1.1.1", "2.2.2.2"],
        disableIntrospection: true,
        disabled: false,
        subgraphs: matchingSubgraphs,
        sdkVersion: "v0-9-0",
      },
    ]);

    const result = await planApplication(createContext(client));

    expect(result.updates).toHaveLength(1);
    expect(result.updates[0]).not.toHaveProperty("forcedBySdkVersion");
  });

  test("creates application when it does not exist", async () => {
    const client = createMockClient([]);

    const result = await planApplication(createContext(client));

    expect(result.creates).toHaveLength(1);
    expect(result.creates[0]!.name).toBe(appName);
    expect(result.updates).toHaveLength(0);
    expect(result.unchanged).toHaveLength(0);
  });

  test("reports a conflict for a same-name application this config does not own", async () => {
    // Without a conflict the take-over is never confirmed, and the id label is
    // rewritten (or dropped) on an application that belongs to someone else.
    const client = createMockClient([
      {
        name: appName,
        authNamespace: "auth-a",
        authIdpConfigName: "idp-a",
        subgraphs: matchingSubgraphs,
        sdkAppId: "id-1",
      },
    ]);

    const result = await planApplication(
      createContext(client, createMockApplication({ name: appName, id: "id-2" })),
    );

    expect(result.conflicts).toEqual([
      {
        resourceType: "application",
        resourceLabel: "Application",
        resourceName: appName,
        currentOwner: appName,
      },
    ]);
    expect(result.updates.map((u) => u.name)).toEqual([appName]);
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
          subgraphs: matchingSubgraphs,
          sdkAppId: appId,
        },
      ]);
      const application = createMockApplication({ name: appName, id: appId });

      const result = await planApplication(createContext(client, application));

      expect(result.creates).toHaveLength(1);
      expect(result.creates[0]!.name).toBe(appName);
      expect(result.deletes).toHaveLength(1);
      expect(result.deletes[0]!.name).toBe(oldName);
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
          subgraphs: matchingSubgraphs,
          sdkAppId: appId,
        },
      ]);
      const application = createMockApplication({ name: appName, id: appId });

      const result = await planApplication(createContext(client, application));

      expect(result.unchanged).toHaveLength(1);
      expect(result.creates).toHaveLength(0);
      expect(result.deletes).toHaveLength(0);
    });

    test("refreshes the labels of an unchanged app that lacks its sdk-app-id", async () => {
      const client = createMockClient([
        {
          name: appName,
          authNamespace: "auth-a",
          authIdpConfigName: "idp-a",
          cors: ["https://a.example.com", "https://b.example.com"],
          allowedIpAddresses: ["1.1.1.1", "2.2.2.2"],
          disableIntrospection: true,
          disabled: false,
          subgraphs: matchingSubgraphs,
        },
      ]);
      const application = createMockApplication({ name: appName, id: "stable-id" });

      const result = await planApplication(createContext(client, application));

      expect(result.updates).toHaveLength(0);
      expect(result.unchanged).toEqual([
        expect.objectContaining({
          name: appName,
          labelRefresh: expect.objectContaining({
            labels: expect.objectContaining({ "sdk-app-id": "app-stable-id" }),
          }),
        }),
      ]);
    });

    test("does not delete unrelated apps when only sdk-name matches a different app", async () => {
      const client = createMockClient([
        {
          name: "other-app",
          authNamespace: "auth-a",
          authIdpConfigName: "idp-a",
          subgraphs: matchingSubgraphs,
          label: "other-app",
          sdkAppId: "different-id",
        },
      ]);
      const application = createMockApplication({ name: appName, id: "stable-id" });

      const result = await planApplication(createContext(client, application));

      expect(result.creates).toHaveLength(1);
      expect(result.deletes).toHaveLength(0);
    });
  });

  describe.each([
    ["forRemoval", planForRemoval, ["other-app"]],
    ["a config without subgraphs", planWithoutSubgraphs, []],
  ])("ownership check when %s deletes the application (issue #1279)", (_case, plan, owners) => {
    test.each([
      ["legacy sdk-name (no sdk-app-id)", undefined, undefined],
      ["matching sdk-app-id", "stable-id", "stable-id"],
    ])("deletes a same-name app owned via %s", async (_owner, remoteAppId, localAppId) => {
      const client = createMockClient([{ name: appName, label: appName, sdkAppId: remoteAppId }]);
      const application = createMockApplication({ name: appName, id: localAppId });

      const result = await plan(client, application);

      expect(result.deletes).toHaveLength(1);
      expect(result.deletes[0]!.name).toBe(appName);
      expect(result.creates).toHaveLength(0);
      expect(result.updates).toHaveLength(0);
    });

    test("deletes id-matched renamed apps", async () => {
      const appId = "stable-id";
      const oldName = "old-app-name";
      const client = createMockClient([
        {
          name: oldName,
          authNamespace: "auth-a",
          authIdpConfigName: "idp-a",
          subgraphs: matchingSubgraphs,
          sdkAppId: appId,
        },
      ]);
      const application = createMockApplication({ name: appName, id: appId });

      const result = await plan(client, application);

      expect(result.deletes).toHaveLength(1);
      expect(result.deletes[0]!.name).toBe(oldName);
      expect(result.creates).toHaveLength(0);
    });

    test("does not delete a same-name app owned by a different id", async () => {
      const client = createMockClient([
        { name: appName, label: appName, sdkAppId: "someone-elses-id" },
      ]);
      const application = createMockApplication({ name: appName, id: "my-id" });

      const result = await plan(client, application);

      expect(result.deletes).toHaveLength(0);
    });

    test("does not delete a same-name app that carries no SDK labels", async () => {
      const client = createMockClient([{ name: appName }], {
        getMetadata: { metadata: { labels: {} } },
      });
      const application = createMockApplication({ name: appName });

      const result = await plan(client, application);

      expect(result.deletes).toHaveLength(0);
    });

    test("does not fetch metadata for unrelated apps when no id is configured", async () => {
      const client = createMockClient([
        { name: appName, label: appName },
        { name: "other-app", label: "other-app" },
        { name: "another-app", label: appName },
      ]);
      const application = createMockApplication({ name: appName });

      const result = await plan(client, application);

      expect(result.deletes).toHaveLength(1);
      expect(result.deletes[0]!.name).toBe(appName);
      expect(client.getMetadata).toHaveBeenCalledTimes(1);
    });

    test("records another id's app as a resource owner only when removing", async () => {
      const client = createMockClient([
        { name: "other-app", label: "other-app", sdkAppId: "other-id" },
      ]);
      const application = createMockApplication({ name: appName, id: "stable-id" });

      const result = await plan(client, application);

      expect(result.deletes).toHaveLength(0);
      expect([...result.resourceOwners]).toEqual(owners);
    });
  });

  describe("CORS resolution on first deployment (issue #1030)", () => {
    test("does not warn when CORS references a locally-defined static website that is not yet on the platform", async () => {
      using warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      const client = createMockClient([], {
        getStaticWebsite: () => Promise.reject(new ConnectError("not found", Code.NotFound)),
      });
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
      const client = createMockClient([], {
        getStaticWebsite: () => Promise.reject(new ConnectError("not found", Code.NotFound)),
      });
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

  describe("previous reuse", () => {
    test("skips re-listing applications/labels when a prior fetch is provided, still re-resolving cors", async () => {
      const client = createMockClient([
        {
          name: appName,
          authNamespace: "auth-a",
          authIdpConfigName: "idp-a",
          cors: ["https://a.example.com", "https://b.example.com"],
          allowedIpAddresses: ["1.1.1.1", "2.2.2.2"],
          disableIntrospection: true,
          disabled: false,
          subgraphs: matchingSubgraphs,
        },
      ]);
      const application = createMockApplication({
        cors: ["https://a.example.com", "https://b.example.com"],
      });

      const first = await planApplication(createContext(client, application));
      expect(client.listApplications).toHaveBeenCalledTimes(1);
      expect(client.getMetadata).toHaveBeenCalledTimes(1);
      expect(first.unchanged).toHaveLength(1);

      const second = await planApplication(createContext(client, application), undefined, {
        existingApplications: first.existingApplications,
        existingLabels: first.existingLabels,
      });

      // The application list/labels aren't re-fetched, but cors is re-resolved
      // regardless (getStaticWebsite is mocked as always-NotFound here, which
      // is why cors isn't itself asserted -- the point is the calls below).
      expect(client.listApplications).toHaveBeenCalledTimes(1);
      expect(client.getMetadata).toHaveBeenCalledTimes(1);
      expect(second.unchanged).toHaveLength(1);
    });

    test("treats a legitimately-undefined previous.existingLabels as already fetched, not a cache miss", async () => {
      const client = createMockClient(
        [
          {
            name: appName,
            authNamespace: "auth-a",
            authIdpConfigName: "idp-a",
            cors: ["https://a.example.com", "https://b.example.com"],
            allowedIpAddresses: ["1.1.1.1", "2.2.2.2"],
            disableIntrospection: true,
            disabled: false,
            subgraphs: matchingSubgraphs,
          },
        ],
        {
          // No metadata found for this app's own trn, e.g. a brand new resource.
          getMetadata: () => Promise.reject(new ConnectError("not found", Code.NotFound)),
        },
      );
      const application = createMockApplication({
        cors: ["https://a.example.com", "https://b.example.com"],
      });

      const first = await planApplication(createContext(client, application));
      expect(client.getMetadata).toHaveBeenCalledTimes(1);
      expect(first.existingLabels).toBeUndefined();

      const second = await planApplication(createContext(client, application), undefined, {
        existingApplications: first.existingApplications,
        existingLabels: first.existingLabels,
      });

      // `previous` was given, so the cached `undefined` is honored as-is
      // instead of being treated as "no previous fetch happened".
      expect(client.getMetadata).toHaveBeenCalledTimes(1);
      expect(second.existingLabels).toBeUndefined();
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

describe("recomposeApplication", () => {
  test("updates every application the deploy created, updated, or left unchanged", async () => {
    const client = mockOperatorClient({ updateApplication: {} });
    const entry = (applicationName: string) => ({
      name: applicationName,
      request: { workspaceId: "ws", applicationName },
      metaRequest: { trn: `trn:${applicationName}`, labels: {} },
    });

    await recomposeApplication(client, {
      creates: [entry("created")],
      updates: [entry("updated")],
      unchanged: [entry("unchanged")],
      deletes: [entry("deleted")],
    } as never);

    expect(client.updateApplication.mock.calls.map(([request]) => request.applicationName)).toEqual(
      ["created", "updated", "unchanged"],
    );
  });
});

describe("applyApplication label writes", () => {
  const trn = `trn:v1:workspace:${workspaceId}:application:${appName}`;
  const sdkLabels = { "sdk-name": appName, "sdk-version": "v1-0-0", "sdk-app-id": "app-id-1" };
  // 20 labels, so the SDK's sdk-app-id makes a 21st.
  const { "sdk-app-id": _, ...withoutAppId } = sdkLabels;
  const fullWithoutAppId = { ...withoutAppId, ...labelEntries("other", 18) };

  function labelStore(
    initial: Record<string, string>,
    onReject: (stored: Record<string, string>) => Record<string, string> = (stored) => stored,
  ) {
    let stored = { ...initial };
    const client = mockOperatorClient({
      updateApplication: {},
      getMetadata: async () => ({ metadata: { labels: { ...stored } } }),
      setMetadata: async ({ labels = {} }) => {
        if (Object.keys(labels).length > 20) {
          stored = onReject(stored);
          throw labelCountRejection();
        }
        stored = { ...labels };
        return {};
      },
      bulkSetMetadata: {},
    });
    return { client, stored: () => stored };
  }

  function updateWith(metadata?: Record<string, string>) {
    return {
      creates: [],
      updates: [
        {
          name: appName,
          request: { workspaceId, applicationName: appName },
          metaRequest: { trn, labels: sdkLabels },
          metadata,
        },
      ],
      unchanged: [],
      deletes: [],
    } as never;
  }

  test("writes config metadata together with the SDK labels", async () => {
    const { client, stored } = labelStore(sdkLabels);

    const rejections = await applyApplication(client, updateWith({ "erp-kit-version": "v1-2-3" }));

    expect(rejections).toEqual([]);
    expect(stored()).toEqual({ ...sdkLabels, "erp-kit-version": "v1-2-3" });
  });

  test("writes the SDK labels without metadata when the platform rejects the label count", async () => {
    const storedMetadata = { "key-0": "v1", "key-1": "v0" };
    const { client, stored } = labelStore(
      { ...sdkLabels, "sdk-version": "v0-9-0", ...storedMetadata },
      // Another tool writes a label while the first write is being rejected.
      (labels) => ({ ...labels, team: "billing" }),
    );
    const metadata = labelEntries("key", 18);

    const rejections = await applyApplication(client, updateWith(metadata));

    expect(stored()).toEqual({ ...sdkLabels, ...storedMetadata, team: "billing" });
    expect(rejections).toEqual([
      {
        name: appName,
        violation: "map must be at most 20 entries",
        sdkLabelsInPlace: true,
        unwrittenMetadata: Object.keys(metadata).filter((key) => key !== "key-0"),
        otherLabels: ["key-0", "key-1", "team"],
      },
    ]);
    expect(applicationLabelLimitError(rejections)).toMatchObject({
      code: "DEPLOY_LABEL_LIMIT_EXCEEDED",
      message: `The platform rejected the labels of application '${appName}': map must be at most 20 entries`,
      suggestion: expect.stringContaining("Remove unwritten entries from 'metadata'"),
      context: { resourceType: "application", applications: rejections },
    });
  });

  test("reports the SDK labels missing when the platform rejects them too", async () => {
    const { client, stored } = labelStore(fullWithoutAppId);

    const rejections = await applyApplication(client, updateWith({ extra: "v1" }));

    expect(client.setMetadata).toHaveBeenCalledTimes(2);
    expect(stored()).toEqual(fullWithoutAppId);
    expect(rejections).toMatchObject([
      { name: appName, sdkLabelsInPlace: false, unwrittenMetadata: ["extra"] },
    ]);
    expect(applicationLabelLimitError(rejections).suggestion).toContain(
      "Delete labels the application no longer needs",
    );
  });

  test("tries once when there is no metadata to leave out", async () => {
    const { client } = labelStore(fullWithoutAppId);

    const rejections = await applyApplication(client, updateWith(undefined));

    expect(client.setMetadata).toHaveBeenCalledTimes(1);
    expect(rejections).toMatchObject([{ sdkLabelsInPlace: false, unwrittenMetadata: [] }]);
  });

  test("rethrows a failure other than the label count", async () => {
    const failure = new ConnectError("unavailable", Code.Unavailable);
    const client = mockOperatorClient({
      updateApplication: {},
      getMetadata: { metadata: { labels: {} } },
      setMetadata: () => Promise.reject(failure),
    });

    await expect(applyApplication(client, updateWith({ team: "billing" }))).rejects.toBe(failure);
  });

  test("writes the application's labels on their own inside a metadata batch", async () => {
    const { client } = labelStore({});

    await withMetadataWriteBatch(client, (batchClient) =>
      applyApplication(batchClient, updateWith({ team: "billing" })),
    );

    expect(client.setMetadata).toHaveBeenCalledTimes(1);
    expect(client.bulkSetMetadata).not.toHaveBeenCalled();
  });
});

describe("applicationLabelLimitError", () => {
  test("suggests trimming metadata while any application kept its SDK labels", () => {
    const error = applicationLabelLimitError([
      applicationLabelRejection("a", true),
      applicationLabelRejection("b", false),
    ]);

    expect(error.message.split("\n")).toHaveLength(2);
    expect(error.suggestion).toContain("Remove unwritten entries from 'metadata'");
    expect(error.details).toContain("Every other change of the deploy was applied.");
  });
});
