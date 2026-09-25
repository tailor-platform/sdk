import { describe, expect, test, vi } from "vitest";
import { createMetadataLookupClient } from "./metadata-lookup";
import { fetchExistingResourcesWithLabels } from "./owned-resource";
import type { OperatorClient } from "#/cli/shared/client";

const workspaceId = "0191b0f4-1c4e-7d3a-9f2b-8c5a4e6d7b81";

describe("createMetadataLookupClient", () => {
  test("loads name and id matches through independently paginated ListMetadata queries", async () => {
    const listMetadata = vi.fn(
      async (request: { labels?: Record<string, string>; pageToken?: string }) => {
        const filter = Object.entries(request.labels ?? {})[0]?.join(":");
        if (filter === "sdk-name:billing" && !request.pageToken) {
          return {
            results: [
              {
                trn: "trn:name-page-1",
                metadata: { labels: { "sdk-name": "billing" } },
              },
            ],
            nextPageToken: "name-page-2",
          };
        }
        if (filter === "sdk-name:billing") {
          return {
            results: [
              {
                trn: "trn:name-page-2",
                metadata: {
                  labels: { "sdk-name": "billing", "sdk-app-id": "app-other-id" },
                },
              },
            ],
            nextPageToken: "",
          };
        }
        if (filter === "sdk-app-id:app-billing-id") {
          return {
            results: [
              {
                trn: "trn:renamed",
                metadata: {
                  labels: { "sdk-name": "old-billing", "sdk-app-id": "app-billing-id" },
                },
              },
            ],
            nextPageToken: "",
          };
        }
        return { results: [], nextPageToken: "" };
      },
    );
    const getMetadata = vi.fn().mockResolvedValue({
      metadata: { labels: { "sdk-name": "other-app" } },
    });
    const client = {
      listMetadata,
      getMetadata,
    } as unknown as OperatorClient;

    const lookup = await createMetadataLookupClient({
      client,
      workspaceId,
      applications: [
        { name: "billing", id: "billing-id" },
        { name: "billing", id: "billing-id" },
      ],
    });

    await expect(lookup.getMetadata({ trn: "trn:name-page-1" })).resolves.toMatchObject({
      metadata: { labels: { "sdk-name": "billing" } },
    });
    await expect(lookup.getMetadata({ trn: "trn:renamed" })).resolves.toMatchObject({
      metadata: { labels: { "sdk-app-id": "app-billing-id" } },
    });
    expect(getMetadata).not.toHaveBeenCalled();
    expect(listMetadata).toHaveBeenCalledTimes(3);
    expect(listMetadata.mock.calls.map(([request]) => request)).toEqual([
      {
        workspaceId,
        labels: { "sdk-name": "billing" },
        pageToken: "",
        pageSize: 1000,
      },
      {
        workspaceId,
        labels: { "sdk-app-id": "app-billing-id" },
        pageToken: "",
        pageSize: 1000,
      },
      {
        workspaceId,
        labels: { "sdk-name": "billing" },
        pageToken: "name-page-2",
        pageSize: 1000,
      },
    ]);
  });

  test("memoizes GetMetadata fallbacks without classifying ListMetadata misses", async () => {
    const getMetadata = vi.fn().mockResolvedValue({
      metadata: { labels: { "sdk-name": "other-app", custom: "keep" } },
    });
    const client = {
      listMetadata: vi.fn().mockResolvedValue({ results: [], nextPageToken: "" }),
      getMetadata,
    } as unknown as OperatorClient;
    const lookup = await createMetadataLookupClient({
      client,
      workspaceId,
      applications: [{ name: "billing", id: "billing-id" }],
    });

    const [first, second] = await Promise.all([
      lookup.getMetadata({ trn: "trn:other" }),
      lookup.getMetadata({ trn: "trn:other" }),
    ]);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      metadata: { labels: { "sdk-name": "other-app", custom: "keep" } },
    });
    expect(getMetadata).toHaveBeenCalledTimes(1);
  });

  test("replaces 47 ownership GetMetadata calls with one app-scoped list", async () => {
    const resources = Array.from({ length: 47 }, (_, index) => ({ name: `resource-${index}` }));
    const getMetadata = vi.fn(async ({ trn }: { trn?: string }) => ({
      metadata: { labels: { "sdk-name": "billing", trn: trn ?? "" } },
    }));
    const listMetadata = vi.fn().mockResolvedValue({
      results: resources.map(({ name }) => ({
        trn: `trn:${name}`,
        metadata: { labels: { "sdk-name": "billing" } },
      })),
      nextPageToken: "",
    });
    const client = { getMetadata, listMetadata } as unknown as OperatorClient;
    const params = {
      fetchPage: async () => [resources, ""] as [typeof resources, string],
      getName: (resource: { name: string }) => resource.name,
      getTrn: (name: string) => `trn:${name}`,
    };

    await fetchExistingResourcesWithLabels({ client, ...params });
    const baselineGetCount = getMetadata.mock.calls.length;
    expect(baselineGetCount).toBe(47);

    getMetadata.mockClear();
    const lookup = await createMetadataLookupClient({
      client,
      workspaceId,
      applications: [{ name: "billing" }],
    });
    await fetchExistingResourcesWithLabels({ client: lookup, ...params });

    expect(getMetadata).not.toHaveBeenCalled();
    expect(listMetadata).toHaveBeenCalledTimes(1);
  });
});
