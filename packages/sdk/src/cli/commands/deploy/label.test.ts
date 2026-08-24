import * as fs from "node:fs";
import * as path from "pathe";
import { describe, expect, test, vi } from "vitest";
import {
  buildMetaRequest,
  hasMatchingSdkVersion,
  isOwnedByApp,
  resolverTrn,
  resourceTrn,
  tailorDBTypeTrn,
  withMetadataWriteBatch,
  writeMetadataLabels,
} from "./label";
import type { MetadataLabelClient } from "./label";

describe("isOwnedByApp", () => {
  test("returns false when labels are undefined", () => {
    expect(isOwnedByApp(undefined, "my-app", "id-1")).toBe(false);
  });

  test("returns true when sdk-app-id matches the provided id with app- prefix applied", () => {
    const labels = { "sdk-app-id": "app-id-1", "sdk-name": "different-name" };
    expect(isOwnedByApp(labels, "my-app", "id-1")).toBe(true);
  });

  test("returns false when sdk-app-id mismatches even if name matches", () => {
    const labels = { "sdk-app-id": "app-id-2", "sdk-name": "my-app" };
    expect(isOwnedByApp(labels, "my-app", "id-1")).toBe(false);
  });

  test("falls back to sdk-name when no app id is provided", () => {
    const labels = { "sdk-name": "my-app" };
    expect(isOwnedByApp(labels, "my-app", undefined)).toBe(true);
  });

  test("falls back to sdk-name when label has no sdk-app-id", () => {
    const labels = { "sdk-name": "my-app" };
    expect(isOwnedByApp(labels, "my-app", "id-1")).toBe(true);
  });

  test("returns false when neither id nor name matches", () => {
    const labels = { "sdk-name": "other-app", "sdk-app-id": "app-id-2" };
    expect(isOwnedByApp(labels, "my-app", "id-1")).toBe(false);
  });
});

describe("hasMatchingSdkVersion", () => {
  test("returns true when both labels carry the same sdk-version", () => {
    expect(hasMatchingSdkVersion({ "sdk-version": "v1-0-0" }, { "sdk-version": "v1-0-0" })).toBe(
      true,
    );
  });

  test("returns false when sdk-version differs", () => {
    expect(hasMatchingSdkVersion({ "sdk-version": "v1-0-0" }, { "sdk-version": "v1-1-0" })).toBe(
      false,
    );
  });

  test("returns false when one side is missing the label", () => {
    expect(hasMatchingSdkVersion(undefined, { "sdk-version": "v1-0-0" })).toBe(false);
    expect(hasMatchingSdkVersion({ "sdk-version": "v1-0-0" }, undefined)).toBe(false);
  });
});

describe("buildMetaRequest", () => {
  function createClient(labels: Record<string, string>) {
    return {
      getMetadata: vi.fn().mockResolvedValue({ metadata: { labels } }),
      setMetadata: vi.fn().mockResolvedValue({}),
    } satisfies MetadataLabelClient & {
      getMetadata: ReturnType<typeof vi.fn>;
      setMetadata: ReturnType<typeof vi.fn>;
    };
  }

  test("drops an app id left over from a previous deploy when the config has none", async () => {
    // sdk-app-id decides ownership on its own, so a stale one left in place
    // makes every later deploy ask to re-tag the resource again.
    const client = createClient({
      "sdk-app-id": "app-id-1",
      "sdk-name": "my-app",
      "sdk-version": "v1-0-0",
      team: "billing",
    });

    const write = await buildMetaRequest({ trn: "trn:x", appName: "my-app" });
    await writeMetadataLabels(client, write);

    const written = client.setMetadata.mock.calls[0]?.[0].labels;
    expect(written).not.toHaveProperty("sdk-app-id");
    expect(written).toMatchObject({ "sdk-name": "my-app", team: "billing" });
  });

  test("replaces an app id from a previous deploy with the current one", async () => {
    const client = createClient({ "sdk-app-id": "app-id-1", "sdk-name": "my-app" });

    const write = await buildMetaRequest({ trn: "trn:x", appName: "my-app", appId: "id-2" });
    await writeMetadataLabels(client, write);

    expect(client.setMetadata.mock.calls[0]?.[0].labels).toMatchObject({
      "sdk-app-id": "app-id-2",
    });
  });
});

describe("writeMetadataLabels", () => {
  function createClient(labels: Record<string, string> | undefined) {
    return {
      getMetadata: vi.fn().mockResolvedValue(labels ? { metadata: { labels } } : {}),
      setMetadata: vi.fn().mockResolvedValue({}),
    } satisfies MetadataLabelClient & {
      getMetadata: ReturnType<typeof vi.fn>;
      setMetadata: ReturnType<typeof vi.fn>;
    };
  }

  test("keeps labels the caller did not mention", async () => {
    const client = createClient({ keep: "yes", "sdk-name": "old-app" });

    await writeMetadataLabels(client, { trn: "trn:x", labels: { "sdk-name": "new-app" } });

    expect(client.setMetadata).toHaveBeenCalledWith({
      trn: "trn:x",
      labels: { keep: "yes", "sdk-name": "new-app" },
    });
  });

  test("reads the labels at write time, not from state passed in", async () => {
    // A label written by someone else after this process last read the resource
    // survives, which is the whole point of going through this helper.
    const client = createClient({ "written-by-another-writer": "value" });

    await writeMetadataLabels(client, { trn: "trn:x", labels: { mine: "value" } });

    expect(client.getMetadata).toHaveBeenCalledWith({ trn: "trn:x" });
    expect(client.setMetadata).toHaveBeenCalledWith({
      trn: "trn:x",
      labels: { "written-by-another-writer": "value", mine: "value" },
    });
  });

  test("deletes only the keys named in remove", async () => {
    const client = createClient({ "sdk-name": "app", "sdk-version": "v1-0-0", custom: "value" });

    await writeMetadataLabels(client, {
      trn: "trn:x",
      remove: ["sdk-name", "sdk-version"],
    });

    expect(client.setMetadata).toHaveBeenCalledWith({ trn: "trn:x", labels: { custom: "value" } });
  });

  test("applies remove after labels, so a key can be set and dropped in one call", async () => {
    const client = createClient({ stale: "value" });

    await writeMetadataLabels(client, {
      trn: "trn:x",
      labels: { fresh: "value", stale: "rewritten" },
      remove: ["stale"],
    });

    expect(client.setMetadata).toHaveBeenCalledWith({ trn: "trn:x", labels: { fresh: "value" } });
  });

  test("treats a resource with no metadata yet as having no labels", async () => {
    const client = createClient(undefined);

    await writeMetadataLabels(client, { trn: "trn:x", labels: { mine: "value" } });

    expect(client.setMetadata).toHaveBeenCalledWith({ trn: "trn:x", labels: { mine: "value" } });
  });

  test.each([
    ["the labels are already set to the requested values", { labels: { keep: "yes" } }],
    ["the keys to remove are not there", { remove: ["gone"] }],
  ])("does not write when %s", async (_name, change) => {
    const client = createClient({ keep: "yes" });

    await writeMetadataLabels(client, { trn: "trn:x", ...change });

    expect(client.getMetadata).toHaveBeenCalledWith({ trn: "trn:x" });
    expect(client.setMetadata).not.toHaveBeenCalled();
  });

  test.each([
    ["nothing is requested", {}],
    ["the requested change is empty", { labels: {}, remove: [] }],
  ])("does not touch the resource when %s", async (_name, change) => {
    const client = createClient({ keep: "yes" });

    await writeMetadataLabels(client, { trn: "trn:x", ...change });

    expect(client.getMetadata).not.toHaveBeenCalled();
    expect(client.setMetadata).not.toHaveBeenCalled();
  });
});

describe("withMetadataWriteBatch", () => {
  function createClient(labels: Record<string, string> = {}) {
    return {
      getMetadata: vi.fn().mockResolvedValue({ metadata: { labels } }),
      setMetadata: vi.fn().mockResolvedValue({}),
      bulkSetMetadata: vi.fn().mockResolvedValue({ results: [] }),
    };
  }

  async function queueMetadataWrites(client: MetadataLabelClient, count: number): Promise<void> {
    await Promise.all(
      Array.from({ length: count }, (_, index) =>
        writeMetadataLabels(client, {
          trn: `trn:${String(index).padStart(3, "0")}`,
          labels: { mine: "value" },
        }),
      ),
    );
  }

  test("folds queued changes for one TRN into one bulk request", async () => {
    const client = createClient({ keep: "yes" });

    await withMetadataWriteBatch(client as never, async (batchClient) => {
      await writeMetadataLabels(batchClient, { trn: "trn:x", labels: { first: "value" } });
      await writeMetadataLabels(batchClient, {
        trn: "trn:x",
        labels: { second: "value" },
        remove: ["keep"],
      });
    });

    expect(client.getMetadata).toHaveBeenCalledTimes(1);
    expect(client.setMetadata).not.toHaveBeenCalled();
    expect(client.bulkSetMetadata).toHaveBeenCalledWith({
      requests: [
        {
          trn: "trn:x",
          labels: { first: "value", second: "value" },
        },
      ],
    });
  });

  test("splits more than 100 changed TRNs into valid batches", async () => {
    const client = createClient();

    await withMetadataWriteBatch(client as never, (batchClient) =>
      queueMetadataWrites(batchClient, 101),
    );

    expect(client.getMetadata).toHaveBeenCalledTimes(101);
    expect(client.setMetadata).not.toHaveBeenCalled();
    expect(client.bulkSetMetadata).toHaveBeenCalledTimes(2);
    expect(client.bulkSetMetadata.mock.calls.map(([request]) => request.requests.length)).toEqual([
      100, 1,
    ]);
  });

  test("preserves a concurrent label written between bulk chunks", async () => {
    const labelsByTrn = new Map<string, Record<string, string>>();
    const client = createClient();
    let bulkCall = 0;
    client.getMetadata.mockImplementation(async ({ trn }: { trn: string }) => ({
      metadata: { labels: { ...labelsByTrn.get(trn) } },
    }));
    client.bulkSetMetadata.mockImplementation(
      async ({
        requests,
      }: {
        requests: Array<{ trn: string; labels: Record<string, string> }>;
      }) => {
        bulkCall += 1;
        for (const request of requests) {
          labelsByTrn.set(request.trn, { ...request.labels });
        }
        if (bulkCall === 1) {
          labelsByTrn.set("trn:100", {
            ...labelsByTrn.get("trn:100"),
            external: "value",
          });
        }
        return { results: [] };
      },
    );

    await withMetadataWriteBatch(client as never, (batchClient) =>
      queueMetadataWrites(batchClient, 101),
    );

    expect(labelsByTrn.get("trn:100")).toEqual({ external: "value", mine: "value" });
  });

  test("rereads changes collected across multiple read waves", async () => {
    const labelsByTrn = new Map<string, Record<string, string>>(
      Array.from({ length: 201 }, (_, index) => {
        const trn = `trn:${String(index).padStart(3, "0")}`;
        const labels: Record<string, string> = index % 100 === 0 ? {} : { mine: "value" };
        return [trn, labels] as const;
      }),
    );
    const client = createClient();
    client.getMetadata.mockImplementation(async ({ trn }: { trn: string }) => {
      if (trn === "trn:200") {
        labelsByTrn.set("trn:000", {
          ...labelsByTrn.get("trn:000"),
          external: "value",
        });
      }
      return { metadata: { labels: { ...labelsByTrn.get(trn) } } };
    });
    client.bulkSetMetadata.mockImplementation(
      async ({
        requests,
      }: {
        requests: Array<{ trn: string; labels: Record<string, string> }>;
      }) => {
        for (const request of requests) {
          labelsByTrn.set(request.trn, { ...request.labels });
        }
        return { results: [] };
      },
    );

    await withMetadataWriteBatch(client as never, (batchClient) =>
      queueMetadataWrites(batchClient, 201),
    );

    expect(labelsByTrn.get("trn:000")).toEqual({ external: "value", mine: "value" });
    expect(client.getMetadata).toHaveBeenCalledTimes(204);
    expect(client.bulkSetMetadata).toHaveBeenCalledTimes(1);
    expect(client.bulkSetMetadata.mock.calls[0]?.[0].requests).toHaveLength(3);
  });

  test("packs changed TRNs across read waves", async () => {
    const client = createClient();
    client.getMetadata.mockImplementation(async ({ trn }: { trn: string }) => ({
      metadata: {
        labels: Number(trn.slice(-3)) % 3 === 0 ? {} : { mine: "value" },
      },
    }));

    await withMetadataWriteBatch(client as never, (batchClient) =>
      queueMetadataWrites(batchClient, 301),
    );

    expect(client.getMetadata).toHaveBeenCalledTimes(401);
    expect(client.bulkSetMetadata).toHaveBeenCalledTimes(2);
    expect(client.bulkSetMetadata.mock.calls.map(([request]) => request.requests.length)).toEqual([
      100, 1,
    ]);
  });

  test("keeps later metadata reads in parallel when a batch is nearly full", async () => {
    const client = createClient();
    let activeTailReads = 0;
    let maxActiveTailReads = 0;
    client.getMetadata.mockImplementation(async ({ trn }: { trn: string }) => {
      const index = Number(trn.slice(-3));
      if (index >= 100) {
        activeTailReads += 1;
        maxActiveTailReads = Math.max(maxActiveTailReads, activeTailReads);
        await Promise.resolve();
        activeTailReads -= 1;
      }
      return {
        metadata: { labels: index < 99 ? {} : { mine: "value" } },
      };
    });

    await withMetadataWriteBatch(client as never, (batchClient) =>
      queueMetadataWrites(batchClient, 301),
    );

    expect(maxActiveTailReads).toBe(100);
    expect(client.bulkSetMetadata).toHaveBeenCalledTimes(1);
    expect(client.bulkSetMetadata.mock.calls[0]?.[0].requests).toHaveLength(99);
  });

  test("rereads overflow candidates after an earlier bulk", async () => {
    const labelsByTrn = new Map<string, Record<string, string>>(
      Array.from({ length: 201 }, (_, index) => {
        const labels: Record<string, string> = index === 99 ? { mine: "value" } : {};
        return [`trn:${String(index).padStart(3, "0")}`, labels] as const;
      }),
    );
    const client = createClient();
    let bulkCall = 0;
    client.getMetadata.mockImplementation(async ({ trn }: { trn: string }) => ({
      metadata: { labels: { ...labelsByTrn.get(trn) } },
    }));
    client.bulkSetMetadata.mockImplementation(
      async ({
        requests,
      }: {
        requests: Array<{ trn: string; labels: Record<string, string> }>;
      }) => {
        bulkCall += 1;
        for (const request of requests) {
          labelsByTrn.set(request.trn, { ...request.labels });
        }
        if (bulkCall === 1) {
          labelsByTrn.set("trn:101", {
            ...labelsByTrn.get("trn:101"),
            external: "value",
          });
        }
        return { results: [] };
      },
    );

    await withMetadataWriteBatch(client as never, (batchClient) =>
      queueMetadataWrites(batchClient, 201),
    );

    expect(labelsByTrn.get("trn:101")).toEqual({ external: "value", mine: "value" });
    expect(client.bulkSetMetadata).toHaveBeenCalledTimes(2);
    expect(client.bulkSetMetadata.mock.calls.map(([request]) => request.requests.length)).toEqual([
      100, 100,
    ]);
  });

  test("does not reread changes that only appear in the final read wave", async () => {
    const client = createClient();
    client.getMetadata.mockImplementation(async ({ trn }: { trn: string }) => ({
      metadata: {
        labels: Number(trn.slice(-3)) < 100 ? { mine: "value" } : {},
      },
    }));

    await withMetadataWriteBatch(client as never, (batchClient) =>
      queueMetadataWrites(batchClient, 200),
    );

    expect(client.getMetadata).toHaveBeenCalledTimes(200);
    expect(client.bulkSetMetadata).toHaveBeenCalledTimes(1);
    expect(client.bulkSetMetadata.mock.calls[0]?.[0].requests).toHaveLength(100);
  });

  test("leaves completed bulk chunks applied when a later metadata read fails", async () => {
    const client = createClient();
    client.getMetadata.mockImplementation(async ({ trn }: { trn: string }) => {
      if (trn === "trn:100") throw new Error("later read failed");
      return { metadata: { labels: {} } };
    });

    await expect(
      withMetadataWriteBatch(client as never, (batchClient) =>
        queueMetadataWrites(batchClient, 201),
      ),
    ).rejects.toThrow("later read failed");

    expect(client.getMetadata).toHaveBeenCalledTimes(200);
    expect(client.bulkSetMetadata).toHaveBeenCalledTimes(1);
    expect(client.bulkSetMetadata.mock.calls[0]?.[0].requests).toHaveLength(100);
  });

  test("does not bulk-write queued changes that already hold", async () => {
    const client = createClient({ mine: "value" });

    await withMetadataWriteBatch(client as never, async (batchClient) => {
      await writeMetadataLabels(batchClient, { trn: "trn:x", labels: { mine: "value" } });
    });

    expect(client.getMetadata).toHaveBeenCalledTimes(1);
    expect(client.bulkSetMetadata).not.toHaveBeenCalled();
  });

  test("flushes queued changes when the apply callback fails", async () => {
    const client = createClient();

    await expect(
      withMetadataWriteBatch(client as never, async (batchClient) => {
        await writeMetadataLabels(batchClient, { trn: "trn:x", labels: { mine: "value" } });
        throw new Error("apply failed");
      }),
    ).rejects.toThrow("apply failed");

    expect(client.getMetadata).toHaveBeenCalledTimes(1);
    expect(client.bulkSetMetadata).toHaveBeenCalledWith({
      requests: [{ trn: "trn:x", labels: { mine: "value" } }],
    });
  });

  test("writes changes queued by an apply sibling after recovery flush starts", async () => {
    const client = createClient();
    let releaseBulkWrite!: () => void;
    const allowBulkWrite = new Promise<void>((resolve) => {
      releaseBulkWrite = resolve;
    });
    let signalBulkWriteStarted!: () => void;
    const bulkWriteStarted = new Promise<void>((resolve) => {
      signalBulkWriteStarted = resolve;
    });
    client.bulkSetMetadata.mockImplementationOnce(async () => {
      signalBulkWriteStarted();
      await allowBulkWrite;
      return { results: [] };
    });
    let releaseLateWrite!: () => void;
    const allowLateWrite = new Promise<void>((resolve) => {
      releaseLateWrite = resolve;
    });
    let signalLateWriteStarted!: () => void;
    const lateWriteStarted = new Promise<void>((resolve) => {
      signalLateWriteStarted = resolve;
    });
    let lateWrite!: Promise<void>;

    const result = withMetadataWriteBatch(client as never, async (batchClient) => {
      await writeMetadataLabels(batchClient, {
        trn: "trn:early",
        labels: { mine: "early" },
      });
      lateWrite = (async () => {
        await allowLateWrite;
        signalLateWriteStarted();
        await writeMetadataLabels(batchClient, {
          trn: "trn:late",
          labels: { mine: "late" },
        });
      })();
      await Promise.all([Promise.reject(new Error("apply failed")), lateWrite]);
    });
    const rejection = (async () => {
      await expect(result).rejects.toThrow("apply failed");
    })();

    await bulkWriteStarted;
    releaseLateWrite();
    await lateWriteStarted;

    expect(client.getMetadata).toHaveBeenCalledTimes(1);
    expect(client.setMetadata).not.toHaveBeenCalled();

    releaseBulkWrite();
    await rejection;
    await lateWrite;

    expect(client.bulkSetMetadata).toHaveBeenCalledWith({
      requests: [{ trn: "trn:early", labels: { mine: "early" } }],
    });
    expect(client.setMetadata).toHaveBeenCalledWith({
      trn: "trn:late",
      labels: { mine: "late" },
    });
  });

  test("reports both errors when the recovery flush also fails", async () => {
    const client = createClient();
    const applyError = new Error("apply failed");
    const flushError = new Error("bulk write failed");
    client.bulkSetMetadata.mockRejectedValueOnce(flushError);

    await expect(
      withMetadataWriteBatch(client as never, async (batchClient) => {
        await writeMetadataLabels(batchClient, { trn: "trn:x", labels: { mine: "value" } });
        throw applyError;
      }),
    ).rejects.toMatchObject({
      name: "AggregateError",
      message:
        "Resource apply failed: apply failed\nQueued metadata recovery failed: bulk write failed",
      cause: flushError,
      errors: [applyError, flushError],
    });
  });

  test("does not issue a bulk write when a metadata read fails", async () => {
    const client = createClient();
    client.getMetadata.mockRejectedValueOnce(new Error("metadata read failed"));

    await expect(
      withMetadataWriteBatch(client as never, async (batchClient) => {
        await writeMetadataLabels(batchClient, { trn: "trn:x", labels: { mine: "value" } });
      }),
    ).rejects.toThrow("metadata read failed");

    expect(client.bulkSetMetadata).not.toHaveBeenCalled();
  });

  test("stops reading and writing after the first failed bulk chunk", async () => {
    const client = createClient();
    client.bulkSetMetadata.mockRejectedValueOnce(new Error("bulk write failed"));

    await expect(
      withMetadataWriteBatch(client as never, (batchClient) =>
        queueMetadataWrites(batchClient, 101),
      ),
    ).rejects.toThrow("bulk write failed");

    expect(client.getMetadata).toHaveBeenCalledTimes(100);
    expect(client.bulkSetMetadata).toHaveBeenCalledTimes(1);
    expect(client.bulkSetMetadata.mock.calls[0]?.[0].requests).toHaveLength(100);
  });
});

describe("setMetadata call sites", () => {
  const srcDir = path.resolve(__dirname, "../../..");

  function sourceFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      // Service tests create and delete temporary source trees while this runs;
      // they are fixtures, not production call sites.
      if (entry.name.startsWith(".") || entry.name.startsWith("__test_")) return [];
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(full);
      return entry.isFile() && full.endsWith(".ts") && !full.endsWith(".test.ts") ? [full] : [];
    });
  }

  function callsSetMetadata(file: string): boolean {
    try {
      // \s so a call the formatter wrapped across lines still counts.
      return /\.\s*setMetadata\s*\(/.test(fs.readFileSync(file, "utf-8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  test("only the helper calls setMetadata directly", () => {
    // SetMetadata replaces the whole label map, so a call that does not re-read
    // first can delete labels written since this process last looked. Route new
    // writes through writeMetadataLabels instead of adding a call site here.
    const files = sourceFiles(srcDir);
    const relativeFiles = files.map((file) => path.relative(srcDir, file));
    expect(relativeFiles).toContain("cli/commands/deploy/label.ts");

    const offenders = files
      .filter(callsSetMetadata)
      .map((file) => path.relative(srcDir, file))
      .filter((file) => file !== "cli/commands/deploy/label.ts");

    expect(offenders).toEqual([]);
  });
});

describe("nested resource TRNs", () => {
  const ws = "0191b0f4-1c4e-7d3a-9f2b-8c5a4e6d7b81";

  // The platform reads everything after the workspace id as alternating
  // key/value pairs (pkg/trn ParseWorkspace) and matches the pair list against
  // one resource type: tailordb_type is [tailordb, type], pipeline_resolver is
  // [pipeline, resolver]. A wrong shape parses as a different type or not at all.
  test("names a TailorDB table as the namespace pair followed by the type pair", () => {
    expect(tailorDBTypeTrn(ws, "db", "Order")).toBe(
      `trn:v1:workspace:${ws}:tailordb:db:type:Order`,
    );
  });

  test("names a resolver as the namespace pair followed by the resolver pair", () => {
    expect(resolverTrn(ws, "pipeline", "processOrder")).toBe(
      `trn:v1:workspace:${ws}:pipeline:pipeline:resolver:processOrder`,
    );
  });

  test("keeps a namespace TRN distinct from a type TRN inside it", () => {
    expect(tailorDBTypeTrn(ws, "db", "Order")).not.toBe(resourceTrn(ws, "tailordb", "db"));
    expect(tailorDBTypeTrn(ws, "db", "Order")).toContain(`${resourceTrn(ws, "tailordb", "db")}:`);
  });
});
