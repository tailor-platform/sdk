import { Code, ConnectError } from "@connectrpc/connect";
import {
  CustomDomainStatus,
  CustomDomainTransferStatus,
} from "@tailor-platform/tailor-proto/staticwebsite_resource_pb";
import { describe, expect, test, vi } from "vitest";
import { createChangeSet } from "./change-set";
import { applyStaticWebsite, planStaticWebsite } from "./staticwebsite";
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
  status?: CustomDomainStatus;
};

type MockTransfer = {
  domain: string;
  status: CustomDomainTransferStatus;
  targetWorkspaceId: string;
  sourceWorkspaceId?: string;
  requestPurgedAt?: boolean;
};

type CustomDomainEntry = string | { domain: string; transferTo: { workspaceId: string } };

type MockWebsite = {
  name: string;
  description?: string;
  allowedIpAddresses?: string[];
  label?: string;
  sdkVersion?: string;
  customDomains?: MockCustomDomain[];
};

function createMockApplication(
  overrides?: Partial<{ customDomains: CustomDomainEntry[] }>,
): Application {
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

function createMockClient(
  websites: MockWebsite[],
  transfers: MockTransfer[] = [],
  opts: { transfersUnimplemented?: boolean } = {},
): OperatorClient {
  const asTransfer = (t: MockTransfer) => ({
    domain: t.domain,
    status: t.status,
    sourceWorkspaceId: t.sourceWorkspaceId ?? workspaceId,
    targetWorkspaceId: t.targetWorkspaceId,
    sourceStaticWebsiteName: "site-a",
    targetStaticWebsiteName: "",
    requestPurgedAt: t.requestPurgedAt === false ? undefined : {},
  });
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
            labels: website?.label
              ? { "sdk-name": website.label, "sdk-version": website.sdkVersion ?? sdkVersion }
              : {},
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
          customDomains: (website?.customDomains ?? []).map((d) => ({
            domain: d.domain,
            status: d.status ?? CustomDomainStatus.ACTIVE,
          })),
        };
      }),
    setMetadata: vi.fn().mockResolvedValue({}),
    listCustomDomainTransfers: vi
      .fn()
      .mockImplementation(({ status }: { status: CustomDomainTransferStatus }) => {
        if (opts.transfersUnimplemented) {
          throw new ConnectError("unimplemented", Code.Unimplemented);
        }
        return {
          transfers: transfers.filter((t) => t.status === status).map(asTransfer),
          nextPageToken: "",
          totalCount: 0n,
        };
      }),
    getCustomDomainTransfer: vi.fn().mockImplementation(({ domain }: { domain: string }) => {
      const found = transfers.find((t) => t.domain === domain);
      if (!found) {
        throw new ConnectError("not found", Code.NotFound);
      }
      return { transfer: asTransfer(found) };
    }),
    requestCustomDomainTransfer: vi.fn().mockResolvedValue({}),
    cancelCustomDomainTransfer: vi.fn().mockResolvedValue({}),
    addCustomDomain: vi.fn().mockResolvedValue({}),
    removeCustomDomain: vi.fn().mockResolvedValue({}),
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
  test("keeps static websites but omits custom domains stripped for migration-test deployments", async () => {
    const client = createMockClient([]);
    const application = createMockApplication({ customDomains: ["example.com"] });
    const context = createContext(client, {
      ...application,
      staticWebsiteServices: application.staticWebsiteServices.map((website) => ({
        ...website,
        customDomains: undefined,
      })),
    });

    const result = await planStaticWebsite(context);

    expect(result.changeSet.creates).toHaveLength(1);
    expect(result.customDomainChangeSet.creates).toHaveLength(0);
  });

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
      unchangedNames: ["site-a"],
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
      unchangedNames: [],
      unmanaged: 0,
      conflicts: 0,
    },
    {
      name: "updates unmanaged website",
      website: {
        name: "site-a",
        description: "Marketing site",
        allowedIpAddresses: ["1.1.1.1", "2.2.2.2"],
      },
      updates: 1,
      unchangedNames: [],
      unmanaged: 1,
      conflicts: 0,
    },
    {
      name: "updates website owned by another app",
      website: {
        name: "site-a",
        description: "Marketing site",
        allowedIpAddresses: ["1.1.1.1", "2.2.2.2"],
        label: "other-app",
      },
      updates: 1,
      unchangedNames: [],
      unmanaged: 0,
      conflicts: 1,
    },
  ])("$name", async ({ website, updates, unchangedNames, unmanaged, conflicts }) => {
    const client = createMockClient([website]);

    const result = await planStaticWebsite(createContext(client));

    expect(result.changeSet.updates).toHaveLength(updates);
    expect(result.changeSet.unchanged.map(({ name }) => name)).toEqual(unchangedNames);
    expect(result.unmanaged).toHaveLength(unmanaged);
    expect(result.conflicts).toHaveLength(conflicts);
  });

  test("reports an unmanaged website with its resource type and label", async () => {
    const client = createMockClient([{ name: "site-a" }]);

    const result = await planStaticWebsite(createContext(client));

    expect(result.unmanaged).toEqual([
      { resourceType: "staticwebsite", resourceLabel: "StaticWebsite", resourceName: "site-a" },
    ]);
  });

  test.each([
    { name: "only its sdk-version differs", overrides: { sdkVersion: "v0-9-0" }, forced: true },
    {
      name: "its config also differs",
      overrides: { sdkVersion: "v0-9-0", description: "Old site" },
      forced: false,
    },
    { name: "another app owns it", overrides: { label: "other-app" }, forced: false },
  ])(
    "marks a website update forced by the SDK version only when $name",
    async ({ overrides, forced }) => {
      const client = createMockClient([
        {
          name: "site-a",
          description: "Marketing site",
          allowedIpAddresses: ["2.2.2.2", "1.1.1.1"],
          label: appName,
          ...overrides,
        },
      ]);

      const result = await planStaticWebsite(createContext(client));

      expect(result.changeSet.updates).toHaveLength(1);
      expect(result.changeSet.updates[0]?.forcedBySdkVersion).toBe(forced ? true : undefined);
    },
  );

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

describe("planStaticWebsite custom domain transfers", () => {
  const target = "ws-target";
  const site = (customDomains: MockCustomDomain[]): MockWebsite[] => [
    { name: "site-a", label: appName, customDomains },
  ];
  const transferTo = (domain: string, workspaceIdOverride = target) => ({
    domain,
    transferTo: { workspaceId: workspaceIdOverride },
  });
  const plan = (client: OperatorClient, customDomains: CustomDomainEntry[]) =>
    planStaticWebsite(createContext(client, createMockApplication({ customDomains })));

  test("present, no live offer: requests the transfer", async () => {
    const client = createMockClient(site([{ domain: "example.com", sdkManaged: true }]));
    const result = await plan(client, [transferTo("example.com")]);

    expect(result.customDomainTransferChangeSet.creates).toHaveLength(1);
    const request = result.customDomainTransferChangeSet.creates[0]!;
    expect(request.name).toBe("example.com");
    expect(request.request.targetWorkspaceId).toBe(target);
    expect(result.customDomainTransferChangeSet.deletes).toHaveLength(0);
    expect(result.customDomainChangeSet.creates).toHaveLength(0);
    expect(result.customDomainNotes).toHaveLength(0);
  });

  test("present, historical record: still requests, and says what happened before", async () => {
    const client = createMockClient(site([{ domain: "example.com", sdkManaged: true }]), [
      {
        domain: "example.com",
        status: CustomDomainTransferStatus.EXPIRED,
        targetWorkspaceId: "ws-old",
      },
    ]);
    const result = await plan(client, [transferTo("example.com")]);

    expect(result.customDomainTransferChangeSet.creates).toHaveLength(1);
    expect(result.customDomainTransferChangeSet.creates[0]!.details).toContain(
      "a previous transfer to workspace ws-old expired",
    );
  });

  test("live offer to the same target: no change, reports it as pending", async () => {
    const client = createMockClient(site([{ domain: "example.com", sdkManaged: true }]), [
      {
        domain: "example.com",
        status: CustomDomainTransferStatus.PENDING,
        targetWorkspaceId: target,
      },
    ]);
    const result = await plan(client, [transferTo("example.com")]);

    expect(result.customDomainTransferChangeSet.creates).toHaveLength(0);
    expect(result.customDomainTransferChangeSet.deletes).toHaveLength(0);
    expect(result.customDomainNotes).toEqual([
      {
        kind: "transfer-pending",
        staticWebsiteName: "site-a",
        domain: "example.com",
        message: `transfer to workspace ${target} is pending`,
      },
    ]);
  });

  test("live offer whose purge is unconfirmed says the target cannot accept yet", async () => {
    const client = createMockClient(site([{ domain: "example.com", sdkManaged: true }]), [
      {
        domain: "example.com",
        status: CustomDomainTransferStatus.PENDING,
        targetWorkspaceId: target,
        requestPurgedAt: false,
      },
    ]);
    const result = await plan(client, [transferTo("example.com")]);

    expect(result.customDomainNotes[0]!.kind).toBe("transfer-purge-outstanding");
    expect(result.customDomainNotes[0]!.message).toContain("edge purge outstanding");
  });

  test("live offer to a different target: cancels, then requests", async () => {
    const client = createMockClient(site([{ domain: "example.com", sdkManaged: true }]), [
      {
        domain: "example.com",
        status: CustomDomainTransferStatus.PENDING,
        targetWorkspaceId: "ws-other",
      },
    ]);
    const result = await plan(client, [transferTo("example.com")]);

    expect(result.customDomainTransferChangeSet.deletes).toHaveLength(1);
    expect(result.customDomainTransferChangeSet.deletes[0]!.name).toBe("example.com");
    expect(result.customDomainTransferChangeSet.creates).toHaveLength(1);
    expect(result.customDomainTransferChangeSet.creates[0]!.request.targetWorkspaceId).toBe(target);
    expect(result.customDomainChangeSet.deletes).toHaveLength(0);
  });

  test("entry reverted to a plain string cancels the offer and keeps the domain", async () => {
    const client = createMockClient(site([{ domain: "example.com", sdkManaged: true }]), [
      {
        domain: "example.com",
        status: CustomDomainTransferStatus.PENDING,
        targetWorkspaceId: target,
      },
    ]);
    const result = await plan(client, ["example.com"]);

    expect(result.customDomainTransferChangeSet.deletes).toHaveLength(1);
    expect(result.customDomainTransferChangeSet.creates).toHaveLength(0);
    expect(result.customDomainChangeSet.deletes).toHaveLength(0);
    expect(result.customDomainChangeSet.unchanged).toHaveLength(1);
  });

  test("entry deleted while an offer is live plans the delete and surfaces the offer", async () => {
    const client = createMockClient(site([{ domain: "example.com", sdkManaged: true }]), [
      {
        domain: "example.com",
        status: CustomDomainTransferStatus.PENDING,
        targetWorkspaceId: target,
      },
    ]);
    const result = await plan(client, []);

    // The planner never cancels a domain it is also removing; the cross-deployment
    // guard turns this pair into a plan-time error.
    expect(result.customDomainChangeSet.deletes).toHaveLength(1);
    expect(result.customDomainTransferChangeSet.deletes).toHaveLength(0);
    expect(result.customDomainLiveOffers.get("example.com")).toBeDefined();
  });

  test("domain absent from the site: never created, reports the outcome", async () => {
    const client = createMockClient(site([]), [
      {
        domain: "example.com",
        status: CustomDomainTransferStatus.COMPLETED,
        targetWorkspaceId: target,
      },
    ]);
    const result = await plan(client, [transferTo("example.com")]);

    expect(result.customDomainChangeSet.creates).toHaveLength(0);
    expect(result.customDomainTransferChangeSet.creates).toHaveLength(0);
    expect(result.customDomainNotes[0]!.kind).toBe("transfer-completed");
    expect(result.customDomainNotes[0]!.message).toContain("remove this entry");
  });

  test("domain absent with no completed record says the transfer did not complete", async () => {
    const client = createMockClient(site([]));
    const result = await plan(client, [transferTo("example.com")]);

    expect(result.customDomainChangeSet.creates).toHaveLength(0);
    expect(result.customDomainNotes[0]!.kind).toBe("transfer-not-completed");
  });

  test("a removing domain is neither offered nor re-added", async () => {
    const client = createMockClient(
      site([{ domain: "example.com", sdkManaged: true, status: CustomDomainStatus.REMOVING }]),
    );
    const result = await plan(client, [transferTo("example.com")]);

    expect(result.customDomainTransferChangeSet.creates).toHaveLength(0);
    expect(result.customDomainChangeSet.creates).toHaveLength(0);
    expect(result.customDomainNotes[0]!.kind).toBe("transfer-source-removing");
  });

  test("a self-targeted transfer is planned like any other", async () => {
    const client = createMockClient(site([{ domain: "example.com", sdkManaged: true }]));
    const result = await plan(client, [transferTo("example.com", workspaceId)]);

    expect(result.customDomainTransferChangeSet.creates).toHaveLength(1);
    expect(result.customDomainTransferChangeSet.creates[0]!.request.targetWorkspaceId).toBe(
      workspaceId,
    );
  });

  test("an inbound offer is never cancelled by the source lane", async () => {
    const client = createMockClient(site([{ domain: "example.com", sdkManaged: true }]), [
      {
        domain: "example.com",
        status: CustomDomainTransferStatus.PENDING,
        targetWorkspaceId: workspaceId,
        sourceWorkspaceId: "ws-elsewhere",
      },
    ]);
    const result = await plan(client, ["example.com"]);

    expect(result.customDomainTransferChangeSet.deletes).toHaveLength(0);
    expect(result.customDomainLiveOffers.size).toBe(0);
  });

  test("an unlabelled existing domain is adopted rather than re-added", async () => {
    const client = createMockClient(site([{ domain: "example.com", sdkManaged: false }]));
    const result = await plan(client, ["example.com"]);

    expect(result.customDomainChangeSet.creates).toHaveLength(0);
    expect(result.customDomainChangeSet.updates).toHaveLength(1);
    expect(result.customDomainChangeSet.updates[0]!.metaRequest).toBeDefined();
    expect(result.unmanaged).toEqual([
      {
        resourceType: "staticwebsite.custom_domain",
        resourceLabel: "StaticWebsite custom domain",
        resourceName: "example.com",
      },
    ]);
  });

  test("forRemoval reads no transfers at all", async () => {
    const client = createMockClient(site([{ domain: "example.com", sdkManaged: true }]), [
      {
        domain: "example.com",
        status: CustomDomainTransferStatus.PENDING,
        targetWorkspaceId: target,
      },
    ]);
    const app = createMockApplication({ customDomains: ["example.com"] });
    const result = await planStaticWebsite(createContext(client, app, true));

    expect(client.listCustomDomainTransfers).not.toHaveBeenCalled();
    expect(result.customDomainTransferChangeSet.creates).toHaveLength(0);
    expect(result.customDomainTransferChangeSet.deletes).toHaveLength(0);
  });

  test("an older Platform keeps plain custom domains deploying", async () => {
    const client = createMockClient(site([{ domain: "example.com", sdkManaged: true }]), [], {
      transfersUnimplemented: true,
    });
    const result = await plan(client, ["example.com"]);

    expect(result.customDomainChangeSet.unchanged).toHaveLength(1);
    expect(result.customDomainTransferChangeSet.creates).toHaveLength(0);
  });

  test("an older Platform refuses a transfer intent", async () => {
    const client = createMockClient(site([{ domain: "example.com", sdkManaged: true }]), [], {
      transfersUnimplemented: true,
    });

    await expect(plan(client, [transferTo("example.com")])).rejects.toMatchObject({
      code: "CUSTOM_DOMAIN_TRANSFER_UNSUPPORTED",
    });
  });
});

describe("applyStaticWebsite custom domains", () => {
  function createRecordingClient(calls: string[]): OperatorClient {
    const record = (name: string) =>
      vi.fn().mockImplementation(async () => {
        calls.push(name);
        return {};
      });
    return {
      createStaticWebsite: record("createStaticWebsite"),
      updateStaticWebsite: record("updateStaticWebsite"),
      deleteStaticWebsite: record("deleteStaticWebsite"),
      addCustomDomain: record("addCustomDomain"),
      removeCustomDomain: record("removeCustomDomain"),
      requestCustomDomainTransfer: record("requestCustomDomainTransfer"),
      cancelCustomDomainTransfer: record("cancelCustomDomainTransfer"),
      getMetadata: vi.fn().mockResolvedValue({ metadata: { labels: {} } }),
      setMetadata: vi.fn().mockResolvedValue({}),
    } as unknown as OperatorClient;
  }

  function planWith(overrides: Record<string, unknown>) {
    const changeSet = createChangeSet("StaticWebsites");
    const customDomainChangeSet = createChangeSet("CustomDomains");
    const customDomainTransferChangeSet = createChangeSet("CustomDomainTransfers");
    return {
      changeSet,
      customDomainChangeSet,
      customDomainTransferChangeSet,
      customDomainNotes: [],
      customDomainLiveOffers: new Map(),
      conflicts: [],
      unmanaged: [],
      resourceOwners: new Set<string>(),
      ...overrides,
    } as unknown as Awaited<ReturnType<typeof planStaticWebsite>>;
  }

  const meta = (trn: string) => ({ trn, labels: { "sdk-name": appName } });

  test("adds, then removes, then cancels, then requests", async () => {
    const calls: string[] = [];
    const client = createRecordingClient(calls);

    const result = planWith({});
    result.customDomainChangeSet.creates.push({
      name: "new.example.com",
      request: { workspaceId, staticWebsiteName: "site-a", domain: "new.example.com" },
      metaRequest: meta("trn-new"),
    });
    result.customDomainChangeSet.deletes.push({
      name: "old.example.com",
      request: { workspaceId, domain: "old.example.com" },
    });
    result.customDomainTransferChangeSet.deletes.push({
      name: "moving.example.com",
      staticWebsiteName: "site-a",
      request: { workspaceId, domain: "moving.example.com" },
    });
    result.customDomainTransferChangeSet.creates.push({
      name: "moving.example.com",
      staticWebsiteName: "site-a",
      request: { workspaceId, domain: "moving.example.com", targetWorkspaceId: "ws-b" },
    });

    await applyStaticWebsite(client, result, "create-update");

    expect(calls).toEqual([
      "addCustomDomain",
      "removeCustomDomain",
      "cancelCustomDomainTransfer",
      "requestCustomDomainTransfer",
    ]);
  });

  test("an adoption writes labels and never re-adds the domain", async () => {
    const calls: string[] = [];
    const client = createRecordingClient(calls);

    const result = planWith({});
    result.customDomainChangeSet.updates.push({
      name: "adopted.example.com",
      metaRequest: meta("trn-adopted"),
    });

    await applyStaticWebsite(client, result, "create-update");

    expect(calls).toEqual([]);
    expect(client.addCustomDomain).not.toHaveBeenCalled();
    expect(client.setMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ trn: "trn-adopted" }),
    );
  });
});
