import { describe, expect, test, vi } from "vitest";
import { planStaticWebsite } from "./staticwebsite";
import type { Application } from "#/cli/services/application";
import type { OperatorClient } from "#/cli/shared/client";
import type { PlanContext } from "./types";

vi.mock("./label", async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    buildMetaRequest: vi.fn().mockImplementation(({ trn }: { trn: string }) => ({
      trn,
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

type MockCustomDomain = {
  domain: string;
  sdkManaged?: boolean;
};

type MockWebsite = {
  name: string;
  description?: string;
  allowedIpAddresses?: string[];
  label?: string;
  customDomains?: MockCustomDomain[];
};

function createMockApplication(overrides?: Partial<{ customDomains: string[] }>): Application {
  return {
    name: appName,
    id: "test-id",
    staticWebsiteServices: [
      {
        name: "site-a",
        description: "Marketing site",
        allowedIpAddresses: ["2.2.2.2", "1.1.1.1"],
        ...overrides,
      },
    ],
  } as unknown as Application;
}

function createMockClient(websites: MockWebsite[]): OperatorClient {
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
      // Static website metadata
      const websiteMatch = trn.match(/:staticwebsite:([^:]+)$/);
      if (websiteMatch) {
        const name = websiteMatch[1];
        const website = websites.find((entry) => entry.name === name);
        return {
          metadata: {
            labels: website?.label ? { "sdk-name": website.label, "sdk-version": sdkVersion } : {},
          },
        };
      }
      // Custom domain metadata
      const domainMatch = trn.match(/:staticwebsite:([^:]+):custom_domain:(.+)$/);
      if (domainMatch) {
        const [, websiteName, domain] = domainMatch;
        const website = websites.find((w) => w.name === websiteName);
        const customDomain = website?.customDomains?.find((d) => d.domain === domain);
        return {
          metadata: {
            labels: customDomain?.sdkManaged
              ? { "sdk-name": appName, "sdk-version": sdkVersion, "sdk-app-id": "app-test-id" }
              : {},
          },
        };
      }
      return { metadata: { labels: {} } };
    }),
    listCustomDomains: vi
      .fn()
      .mockImplementation(({ staticWebsiteName }: { staticWebsiteName: string }) => {
        const website = websites.find((w) => w.name === staticWebsiteName);
        return {
          customDomains: (website?.customDomains ?? []).map((d) => ({ domain: d.domain })),
        };
      }),
    setMetadata: vi.fn().mockResolvedValue({}),
  } as unknown as OperatorClient;
}

function createContext(
  client: OperatorClient,
  application?: Application,
  forRemoval = false,
): PlanContext {
  return {
    client,
    workspaceId,
    application: application ?? createMockApplication(),
    forRemoval,
    config: { path: "/test/tailor.config.ts" } as PlanContext["config"],
  };
}

describe("planStaticWebsite", () => {
  test.each([
    {
      name: "marks website unchanged when remote state matches desired state",
      website: {
        name: "site-a",
        description: "Marketing site",
        allowedIpAddresses: ["1.1.1.1", "2.2.2.2"],
        label: appName,
      },
      updates: 0,
      unchanged: 1,
      unmanaged: 0,
      conflicts: 0,
    },
    {
      name: "marks website updated when remote state differs",
      website: {
        name: "site-a",
        description: "Old site",
        allowedIpAddresses: ["1.1.1.1"],
        label: appName,
      },
      updates: 1,
      unchanged: 0,
      unmanaged: 0,
      conflicts: 0,
    },
    {
      name: "marks website updated when config matches but ownership metadata is missing",
      website: {
        name: "site-a",
        description: "Marketing site",
        allowedIpAddresses: ["1.1.1.1", "2.2.2.2"],
      },
      updates: 1,
      unchanged: 0,
      unmanaged: 1,
      conflicts: 0,
    },
    {
      name: "marks website updated when config matches but resource is owned by another app",
      website: {
        name: "site-a",
        description: "Marketing site",
        allowedIpAddresses: ["1.1.1.1", "2.2.2.2"],
        label: "other-app",
      },
      updates: 1,
      unchanged: 0,
      unmanaged: 0,
      conflicts: 1,
    },
  ])("$name", async ({ website, updates, unchanged, unmanaged, conflicts }) => {
    const client = createMockClient([website]);

    const result = await planStaticWebsite(createContext(client));

    expect(result.changeSet.updates).toHaveLength(updates);
    expect(result.changeSet.unchanged).toHaveLength(unchanged);
    expect(result.changeSet.unchanged.at(0)?.name).toBe(unchanged > 0 ? "site-a" : undefined);
    expect(result.unmanaged).toHaveLength(unmanaged);
    expect(result.conflicts).toHaveLength(conflicts);
  });

  test("creates website when it does not exist", async () => {
    const client = createMockClient([]);

    const result = await planStaticWebsite(createContext(client));

    expect(result.changeSet.creates).toHaveLength(1);
    expect(result.changeSet.updates).toHaveLength(0);
    expect(result.changeSet.unchanged).toHaveLength(0);
  });

  test("adds custom domains for new website", async () => {
    const client = createMockClient([]);
    const app = createMockApplication({ customDomains: ["example.com", "www.example.com"] });

    const result = await planStaticWebsite(createContext(client, app));

    expect(result.customDomainChangeSet.creates).toHaveLength(2);
    expect(result.customDomainChangeSet.creates.map((c) => c.name)).toEqual([
      "example.com",
      "www.example.com",
    ]);
    expect(result.customDomainChangeSet.deletes).toHaveLength(0);
  });

  test("adds new custom domains and removes stale SDK-owned ones", async () => {
    const client = createMockClient([
      {
        name: "site-a",
        label: appName,
        customDomains: [
          { domain: "old.example.com", sdkManaged: true },
          { domain: "example.com", sdkManaged: true },
        ],
      },
    ]);
    const app = createMockApplication({ customDomains: ["example.com", "new.example.com"] });

    const result = await planStaticWebsite(createContext(client, app));

    expect(result.customDomainChangeSet.creates).toHaveLength(1);
    expect(result.customDomainChangeSet.creates[0]!.name).toBe("new.example.com");
    expect(result.customDomainChangeSet.deletes).toHaveLength(1);
    expect(result.customDomainChangeSet.deletes[0]!.name).toBe("old.example.com");
    expect(result.customDomainChangeSet.unchanged).toHaveLength(1);
    expect(result.customDomainChangeSet.unchanged[0]!.name).toBe("example.com");
  });

  test("does not manage custom domains for unowned websites", async () => {
    const client = createMockClient([
      {
        name: "site-a",
        label: "other-app",
        customDomains: [{ domain: "other.example.com", sdkManaged: false }],
      },
    ]);
    const app = createMockApplication({ customDomains: ["example.com"] });

    const result = await planStaticWebsite(createContext(client, app));

    expect(result.customDomainChangeSet.creates).toHaveLength(0);
    expect(result.customDomainChangeSet.deletes).toHaveLength(0);
  });

  test("removes all SDK-owned domains when customDomains is empty array", async () => {
    const client = createMockClient([
      {
        name: "site-a",
        label: appName,
        customDomains: [
          { domain: "old.example.com", sdkManaged: true },
          { domain: "another.example.com", sdkManaged: true },
        ],
      },
    ]);
    const app = createMockApplication({ customDomains: [] });

    const result = await planStaticWebsite(createContext(client, app));

    expect(result.customDomainChangeSet.creates).toHaveLength(0);
    expect(result.customDomainChangeSet.deletes).toHaveLength(2);
    expect(result.customDomainChangeSet.deletes.map((d) => d.name).toSorted()).toEqual([
      "another.example.com",
      "old.example.com",
    ]);
  });

  test("does not remove existing domains when customDomains is not specified", async () => {
    const client = createMockClient([
      {
        name: "site-a",
        label: appName,
        customDomains: [{ domain: "console-added.example.com", sdkManaged: true }],
      },
    ]);
    const app = createMockApplication();

    const result = await planStaticWebsite(createContext(client, app));

    expect(result.customDomainChangeSet.creates).toHaveLength(0);
    expect(result.customDomainChangeSet.deletes).toHaveLength(0);
  });

  test("does not remove console-added domains even when customDomains is specified", async () => {
    const client = createMockClient([
      {
        name: "site-a",
        label: appName,
        customDomains: [
          { domain: "sdk.example.com", sdkManaged: true },
          { domain: "console.example.com", sdkManaged: false },
        ],
      },
    ]);
    const app = createMockApplication({ customDomains: ["new.example.com"] });

    const result = await planStaticWebsite(createContext(client, app));

    // sdk.example.com (SDK-owned, not in desired) → deleted
    expect(result.customDomainChangeSet.deletes).toHaveLength(1);
    expect(result.customDomainChangeSet.deletes[0]!.name).toBe("sdk.example.com");
    // new.example.com (not existing) → created
    expect(result.customDomainChangeSet.creates).toHaveLength(1);
    expect(result.customDomainChangeSet.creates[0]!.name).toBe("new.example.com");
    // console.example.com (not SDK-owned) → untouched
  });

  test("handles multiple websites with different custom domains", async () => {
    const client = createMockClient([
      {
        name: "site-a",
        label: appName,
        customDomains: [{ domain: "a.example.com", sdkManaged: true }],
      },
      {
        name: "site-b",
        label: appName,
        customDomains: [{ domain: "old-b.example.com", sdkManaged: true }],
      },
    ]);
    const app = {
      name: appName,
      id: "test-id",
      staticWebsiteServices: [
        { name: "site-a", customDomains: ["a.example.com"] },
        { name: "site-b", customDomains: ["b.example.com"] },
      ],
    } as unknown as Application;

    const result = await planStaticWebsite(createContext(client, app));

    // site-a: a.example.com unchanged
    // site-b: old-b.example.com deleted, b.example.com added
    expect(result.customDomainChangeSet.unchanged).toHaveLength(1);
    expect(result.customDomainChangeSet.unchanged[0]!.name).toBe("a.example.com");
    expect(result.customDomainChangeSet.creates).toHaveLength(1);
    expect(result.customDomainChangeSet.creates[0]!.name).toBe("b.example.com");
    expect(result.customDomainChangeSet.deletes).toHaveLength(1);
    expect(result.customDomainChangeSet.deletes[0]!.name).toBe("old-b.example.com");
  });

  test("produces empty custom domain changeset when forRemoval is true", async () => {
    const client = createMockClient([
      {
        name: "site-a",
        label: appName,
        customDomains: [{ domain: "example.com", sdkManaged: true }],
      },
    ]);

    const app = createMockApplication({ customDomains: ["example.com"] });
    const result = await planStaticWebsite(createContext(client, app, true));

    expect(result.customDomainChangeSet.creates).toHaveLength(0);
    expect(result.customDomainChangeSet.deletes).toHaveLength(0);
    expect(result.customDomainChangeSet.unchanged).toHaveLength(0);
  });
});
