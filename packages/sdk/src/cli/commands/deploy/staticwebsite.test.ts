import { describe, expect, test, vi } from "vitest";
import { planStaticWebsite } from "./staticwebsite";
import type { PlanContext } from "./types";
import type { Application } from "@/cli/services/application";
import type { OperatorClient } from "@/cli/shared/client";

vi.mock("./label", async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    buildMetaRequest: vi.fn().mockResolvedValue({
      trn: "trn:v1:workspace:test-workspace:staticwebsite:site-a",
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
    staticWebsiteServices: [
      {
        name: "site-a",
        description: "Marketing site",
        allowedIpAddresses: ["2.2.2.2", "1.1.1.1"],
      },
    ],
  } as unknown as Application;
}

function createMockClient(
  websites: Array<{
    name: string;
    description?: string;
    allowedIpAddresses?: string[];
    label?: string;
  }>,
): OperatorClient {
  return {
    listStaticWebsites: vi.fn().mockResolvedValue({
      staticwebsites: websites.map((website) => ({
        name: website.name,
        description: website.description ?? "",
        allowedIpAddresses: website.allowedIpAddresses ?? [],
        url: "",
      })),
      nextPageToken: "",
    }),
    getMetadata: vi.fn().mockImplementation(({ trn }: { trn: string }) => {
      const name = trn.split(":").pop();
      const website = websites.find((entry) => entry.name === name);
      return {
        metadata: {
          labels: website?.label ? { "sdk-name": website.label, "sdk-version": sdkVersion } : {},
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

describe("planStaticWebsite", () => {
  test("marks website unchanged when remote state matches desired state", async () => {
    const client = createMockClient([
      {
        name: "site-a",
        description: "Marketing site",
        allowedIpAddresses: ["1.1.1.1", "2.2.2.2"],
        label: appName,
      },
    ]);

    const result = await planStaticWebsite(createContext(client));

    expect(result.changeSet.unchanged).toHaveLength(1);
    expect(result.changeSet.unchanged[0].name).toBe("site-a");
    expect(result.changeSet.updates).toHaveLength(0);
  });

  test("marks website updated when remote state differs", async () => {
    const client = createMockClient([
      {
        name: "site-a",
        description: "Old site",
        allowedIpAddresses: ["1.1.1.1"],
        label: appName,
      },
    ]);

    const result = await planStaticWebsite(createContext(client));

    expect(result.changeSet.updates).toHaveLength(1);
    expect(result.changeSet.unchanged).toHaveLength(0);
  });

  test("marks website updated when config matches but ownership metadata is missing", async () => {
    const client = createMockClient([
      {
        name: "site-a",
        description: "Marketing site",
        allowedIpAddresses: ["1.1.1.1", "2.2.2.2"],
      },
    ]);

    const result = await planStaticWebsite(createContext(client));

    expect(result.changeSet.updates).toHaveLength(1);
    expect(result.changeSet.unchanged).toHaveLength(0);
    expect(result.unmanaged).toHaveLength(1);
  });

  test("marks website updated when config matches but resource is owned by another app", async () => {
    const client = createMockClient([
      {
        name: "site-a",
        description: "Marketing site",
        allowedIpAddresses: ["1.1.1.1", "2.2.2.2"],
        label: "other-app",
      },
    ]);

    const result = await planStaticWebsite(createContext(client));

    expect(result.changeSet.updates).toHaveLength(1);
    expect(result.changeSet.unchanged).toHaveLength(0);
    expect(result.conflicts).toHaveLength(1);
  });

  test("creates website when it does not exist", async () => {
    const client = createMockClient([]);

    const result = await planStaticWebsite(createContext(client));

    expect(result.changeSet.creates).toHaveLength(1);
    expect(result.changeSet.updates).toHaveLength(0);
    expect(result.changeSet.unchanged).toHaveLength(0);
  });
});
