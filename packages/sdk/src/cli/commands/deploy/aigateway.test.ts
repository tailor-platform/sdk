import { describe, expect, test, vi } from "vitest";
import {
  mockOperatorClient,
  type OperatorClientMocks,
  withOperatorClientMocks,
} from "#/cli/shared/test-helpers/operator-client";
import { planAIGateway } from "./aigateway";
import { applicationOwner, buildMetaRequest } from "./label";
import type { Application } from "#/cli/services/application";
import type { OperatorClient } from "#/cli/shared/client";
import type { PlanContext } from "./types";
import type { MessageInitShape } from "@bufbuild/protobuf";
import type { AIGatewaySchema } from "@tailor-platform/tailor-proto/aigateway_resource_pb";

vi.mock("./label", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    buildMetaRequest: vi.fn().mockImplementation(async () => ({
      trn: "trn:v1:workspace:test-workspace:aigateway:gateway-a",
      labels: {
        "sdk-name": "test-app",
        "sdk-version": "v1-0-0",
      },
    })),
  };
});

vi.mock("./change-set", async (importOriginal) => importOriginal());

const workspaceId = "test-workspace";
const appName = "test-app";
const sdkVersion = "v1-0-0";

function createMockApplication(): Application {
  return {
    name: appName,
    staticWebsiteServices: [],
    aiGatewayServices: [
      {
        name: "gateway-a",
        authNamespace: "default",
        cors: ["https://example.com", "https://app.example.com"],
      },
    ],
  } as unknown as Application;
}

function createMockClient<K extends keyof OperatorClient = never>(
  gateways: Array<{
    name: string;
    authNamespace?: string;
    cors?: string[];
    label?: string | undefined;
    sdkVersion?: string;
  }>,
  overrides?: OperatorClientMocks<K>,
): OperatorClient {
  const client = mockOperatorClient({
    listAIGateways: {
      aigateways: gateways.map((gateway): MessageInitShape<typeof AIGatewaySchema> => ({
        name: gateway.name,
        authNamespace: gateway.authNamespace ?? "",
        cors: gateway.cors ?? [],
        domain: "",
      })),
      nextPageToken: "",
    },
    getMetadata: (request) => {
      const name = request.trn?.split(":").pop();
      const gateway = gateways.find((entry) => entry.name === name);
      const labels: Record<string, string> = gateway?.label
        ? { "sdk-name": gateway.label, "sdk-version": gateway.sdkVersion ?? sdkVersion }
        : {};
      return { metadata: { labels } };
    },
  });
  return withOperatorClientMocks(client, overrides);
}

function createContext(client: OperatorClient): PlanContext {
  return {
    client,
    workspaceId,
    application: createMockApplication(),
    applications: [],
    owner: applicationOwner(createMockApplication()),
    forRemoval: false,
    config: { path: "/test/tailor.config.ts" },
  };
}

describe("planAIGateway", () => {
  test("marks gateway unchanged when remote state matches desired state", async () => {
    const client = createMockClient([
      {
        name: "gateway-a",
        authNamespace: "default",
        cors: ["https://app.example.com", "https://example.com"],
        label: appName,
      },
    ]);

    const result = await planAIGateway(createContext(client));

    expect(result.changeSet.creates).toHaveLength(0);
    expect(result.changeSet.updates).toHaveLength(0);
    expect(result.changeSet.unchanged).toHaveLength(1);
    expect(result.conflicts).toHaveLength(0);
    expect(result.unmanaged).toHaveLength(0);
    expect(result.changeSet.unchanged[0]!.name).toBe("gateway-a");
  });

  test("refreshes the labels of an unchanged gateway whose SDK labels differ", async () => {
    const client = createMockClient([
      {
        name: "gateway-a",
        authNamespace: "default",
        cors: ["https://app.example.com", "https://example.com"],
        label: appName,
      },
    ]);
    const desiredLabels = { "sdk-name": appName, "sdk-version": sdkVersion, "sdk-app-id": "app-1" };
    vi.mocked(buildMetaRequest).mockImplementationOnce(async ({ trn }) => ({
      trn,
      labels: desiredLabels,
    }));

    const result = await planAIGateway(createContext(client));

    expect(result.changeSet.updates).toEqual([]);
    expect(result.changeSet.unchanged).toEqual([
      { name: "gateway-a", labelRefresh: expect.objectContaining({ labels: desiredLabels }) },
    ]);
  });

  test.each([
    {
      name: "marks gateway updated when remote state differs",
      gateways: [
        {
          name: "gateway-a",
          authNamespace: "old-namespace",
          cors: ["https://example.com"],
          label: appName,
        },
      ],
      expected: { creates: 0, updates: 1, unchanged: 0, conflicts: 0, unmanaged: 0 },
    },
    {
      name: "updates unmanaged gateway",
      gateways: [
        {
          name: "gateway-a",
          authNamespace: "default",
          cors: ["https://example.com", "https://app.example.com"],
        },
      ],
      expected: { creates: 0, updates: 1, unchanged: 0, conflicts: 0, unmanaged: 1 },
    },
    {
      name: "updates gateway owned by another app",
      gateways: [
        {
          name: "gateway-a",
          authNamespace: "default",
          cors: ["https://example.com", "https://app.example.com"],
          label: "other-app",
        },
      ],
      expected: { creates: 0, updates: 1, unchanged: 0, conflicts: 1, unmanaged: 0 },
    },
    {
      name: "creates gateway when it does not exist",
      gateways: [],
      expected: { creates: 1, updates: 0, unchanged: 0, conflicts: 0, unmanaged: 0 },
    },
  ])("$name", async ({ gateways, expected }) => {
    const client = createMockClient(gateways);

    const result = await planAIGateway(createContext(client));

    expect(result.changeSet.creates).toHaveLength(expected.creates);
    expect(result.changeSet.updates).toHaveLength(expected.updates);
    expect(result.changeSet.unchanged).toHaveLength(expected.unchanged);
    expect(result.conflicts).toHaveLength(expected.conflicts);
    expect(result.unmanaged).toHaveLength(expected.unmanaged);
  });

  test("reports an unmanaged gateway with its resource type and label", async () => {
    const client = createMockClient([{ name: "gateway-a" }]);

    const result = await planAIGateway(createContext(client));

    expect(result.unmanaged).toEqual([
      { resourceType: "aigateway", resourceLabel: "AIGateway", resourceName: "gateway-a" },
    ]);
  });

  test.each([
    { name: "only its sdk-version differs", overrides: { sdkVersion: "v0-9-0" }, forced: true },
    {
      name: "its config also differs",
      overrides: { sdkVersion: "v0-9-0", authNamespace: "old-namespace" },
      forced: false,
    },
    { name: "it is unmanaged", overrides: { label: undefined }, forced: false },
    { name: "another app owns it", overrides: { label: "other-app" }, forced: false },
  ])(
    "marks a gateway update forced by the SDK version only when $name",
    async ({ overrides, forced }) => {
      const client = createMockClient([
        {
          name: "gateway-a",
          authNamespace: "default",
          cors: ["https://app.example.com", "https://example.com"],
          label: appName,
          ...overrides,
        },
      ]);

      const result = await planAIGateway(createContext(client));

      expect(result.changeSet.updates).toHaveLength(1);
      expect(result.changeSet.updates[0]?.forcedBySdkVersion).toBe(forced ? true : undefined);
    },
  );

  test("resolves staticwebsite :url placeholder in cors against deployed URL", async () => {
    const client = createMockClient(
      [
        {
          name: "gateway-a",
          authNamespace: "default",
          cors: ["https://my-frontend.example.com"],
          label: appName,
        },
      ],
      {
        getStaticWebsite: {
          staticwebsite: { name: "my-frontend", url: "https://my-frontend.example.com" },
        },
      },
    );

    const application = {
      name: appName,
      staticWebsiteServices: [{ name: "my-frontend" }],
      aiGatewayServices: [
        {
          name: "gateway-a",
          authNamespace: "default",
          cors: ["my-frontend:url"],
        },
      ],
    } as unknown as Application;

    const result = await planAIGateway({
      client,
      workspaceId,
      application,
      applications: [],
      owner: applicationOwner(application),
      forRemoval: false,
      config: { path: "/test/tailor.config.ts" },
    });

    expect(result.changeSet.unchanged).toHaveLength(1);
    expect(result.changeSet.updates).toHaveLength(0);
  });
});
