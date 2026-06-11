import { describe, expect, test, vi } from "vitest";
import { planAIGateway } from "./aigateway";
import type { PlanContext } from "./types";
import type { Application } from "@/cli/services/application";
import type { OperatorClient } from "@/cli/shared/client";

vi.mock("./label", async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    buildMetaRequest: vi.fn().mockResolvedValue({
      trn: "trn:v1:workspace:test-workspace:aigateway:gateway-a",
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

function createMockClient(
  gateways: Array<{
    name: string;
    authNamespace?: string;
    cors?: string[];
    label?: string;
  }>,
): OperatorClient {
  return {
    listAIGateways: vi.fn().mockResolvedValue({
      aigateways: gateways.map((gateway) => ({
        name: gateway.name,
        authNamespace: gateway.authNamespace ?? "",
        cors: gateway.cors ?? [],
        domain: "",
      })),
      nextPageToken: "",
    }),
    getMetadata: vi.fn().mockImplementation(({ trn }: { trn: string }) => {
      const name = trn.split(":").pop();
      const gateway = gateways.find((entry) => entry.name === name);
      return {
        metadata: {
          labels: gateway?.label ? { "sdk-name": gateway.label, "sdk-version": sdkVersion } : {},
        },
      };
    }),
  } as unknown as OperatorClient;
}

function createContext(client: OperatorClient): PlanContext {
  return {
    client,
    workspaceId,
    application: createMockApplication(),
    forRemoval: false,
    config: { path: "/test/tailor.config.ts" } as PlanContext["config"],
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

    expect(result.changeSet.unchanged).toHaveLength(1);
    expect(result.changeSet.unchanged[0]!.name).toBe("gateway-a");
    expect(result.changeSet.updates).toHaveLength(0);
  });

  test("marks gateway updated when remote state differs", async () => {
    const client = createMockClient([
      {
        name: "gateway-a",
        authNamespace: "old-namespace",
        cors: ["https://example.com"],
        label: appName,
      },
    ]);

    const result = await planAIGateway(createContext(client));

    expect(result.changeSet.updates).toHaveLength(1);
    expect(result.changeSet.unchanged).toHaveLength(0);
  });

  test("marks gateway updated when config matches but ownership metadata is missing", async () => {
    const client = createMockClient([
      {
        name: "gateway-a",
        authNamespace: "default",
        cors: ["https://example.com", "https://app.example.com"],
      },
    ]);

    const result = await planAIGateway(createContext(client));

    expect(result.changeSet.updates).toHaveLength(1);
    expect(result.changeSet.unchanged).toHaveLength(0);
    expect(result.unmanaged).toHaveLength(1);
  });

  test("marks gateway updated when config matches but resource is owned by another app", async () => {
    const client = createMockClient([
      {
        name: "gateway-a",
        authNamespace: "default",
        cors: ["https://example.com", "https://app.example.com"],
        label: "other-app",
      },
    ]);

    const result = await planAIGateway(createContext(client));

    expect(result.changeSet.updates).toHaveLength(1);
    expect(result.changeSet.unchanged).toHaveLength(0);
    expect(result.conflicts).toHaveLength(1);
  });

  test("creates gateway when it does not exist", async () => {
    const client = createMockClient([]);

    const result = await planAIGateway(createContext(client));

    expect(result.changeSet.creates).toHaveLength(1);
    expect(result.changeSet.updates).toHaveLength(0);
    expect(result.changeSet.unchanged).toHaveLength(0);
  });

  test("resolves staticwebsite :url placeholder in cors against deployed URL", async () => {
    const client = createMockClient([
      {
        name: "gateway-a",
        authNamespace: "default",
        cors: ["https://my-frontend.example.com"],
        label: appName,
      },
    ]);
    (client as unknown as { getStaticWebsite: ReturnType<typeof vi.fn> }).getStaticWebsite = vi
      .fn()
      .mockResolvedValue({
        staticwebsite: { name: "my-frontend", url: "https://my-frontend.example.com" },
      });

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
      forRemoval: false,
      config: { path: "/test/tailor.config.ts" } as PlanContext["config"],
    });

    expect(result.changeSet.unchanged).toHaveLength(1);
    expect(result.changeSet.updates).toHaveLength(0);
  });
});
