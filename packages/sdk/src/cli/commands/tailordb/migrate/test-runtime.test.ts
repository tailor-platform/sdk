import * as fs from "node:fs";
import * as os from "node:os";
import { CloneOperationStatus } from "@tailor-platform/tailor-proto/application_pb";
import * as path from "pathe";
import { afterEach, describe, expect, test, vi } from "vitest";
import { normalizeSchemaSnapshot } from "./snapshot";
import {
  assertCloneTargetRegion,
  createMigrationTestBaselineSnapshots,
  loadSnapshotSeedData,
  sortSeedTypesForSnapshot,
  waitForCloneApplicationData,
} from "./test-runtime";
import type { OperatorClient } from "#/cli/shared/client";

describe("migration test runtime", () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("orders seed types by baseline foreign-key dependencies", () => {
    const snapshot = normalizeSchemaSnapshot({
      version: 1,
      namespace: "tailordb",
      createdAt: "2026-08-05T00:00:00.000Z",
      types: {
        Order: {
          name: "Order",
          pluralForm: "Orders",
          fields: {
            customerId: {
              type: "uuid",
              required: true,
              foreignKey: true,
              foreignKeyType: "Customer",
            },
          },
        },
        Customer: {
          name: "Customer",
          pluralForm: "Customers",
          fields: {},
        },
      },
    });

    expect(sortSeedTypesForSnapshot(snapshot)).toEqual({
      order: ["Customer", "Order"],
      selfRefTypes: [],
    });
  });

  test("loads JSONL for baseline types, removes pending fields, and treats a missing file as empty", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "migration-test-seed-"));
    temporaryDirectories.push(dataDir);
    fs.writeFileSync(
      path.join(dataDir, "Customer.jsonl"),
      '{"id":"customer-1","name":"Ada","email":"pending@example.com","createdAt":"2026-08-05T00:00:00Z","updatedAt":"2026-08-05T00:00:00Z","profile":{"displayName":"Ada","timezone":"UTC"},"addresses":[{"city":"Tokyo","country":"JP"}]}\n',
    );
    const snapshot = normalizeSchemaSnapshot({
      version: 1,
      namespace: "tailordb",
      createdAt: "2026-08-05T00:00:00.000Z",
      types: {
        Customer: {
          name: "Customer",
          pluralForm: "Customers",
          fields: {
            name: { type: "string", required: true },
            profile: {
              type: "nested",
              required: true,
              fields: { displayName: { type: "string", required: true } },
            },
            addresses: {
              type: "nested",
              required: true,
              array: true,
              fields: { city: { type: "string", required: true } },
            },
          },
        },
        Order: {
          name: "Order",
          pluralForm: "Orders",
          fields: {},
        },
      },
    });

    expect(loadSnapshotSeedData(dataDir, ["Customer", "Order"], snapshot)).toEqual({
      Customer: [
        {
          id: "customer-1",
          name: "Ada",
          profile: { displayName: "Ada" },
          addresses: [{ city: "Tokyo" }],
        },
      ],
      Order: [],
    });
  });

  test("rejects a designated clone target in a different region", () => {
    expect(() => assertCloneTargetRegion("asia-northeast", "us-west")).toThrow(/same region/i);
    expect(() => assertCloneTargetRegion("asia-northeast", "asia-northeast")).not.toThrow();
  });

  test("reproduces source schemas for clone namespaces without migrations", async () => {
    const migrationSnapshot = normalizeSchemaSnapshot({
      version: 1,
      namespace: "primary",
      createdAt: "2026-08-05T00:00:00.000Z",
      types: {},
    });
    const client = {
      listTailorDBTypes: vi.fn().mockResolvedValue({ tailordbTypes: [], nextPageToken: "" }),
      listTailorDBGQLPermissions: vi.fn().mockResolvedValue({ permissions: [], nextPageToken: "" }),
    } as unknown as OperatorClient;

    const snapshots = await createMigrationTestBaselineSnapshots({
      client,
      workspaceId: "source",
      dataMode: "clone",
      inputs: [
        { namespace: "primary", config: { files: [] }, types: {} },
        {
          namespace: "audit",
          config: { files: [] },
          types: {
            LocalOnly: {
              name: "LocalOnly",
              pluralForm: "LocalOnly",
              fields: {},
            },
          },
        },
      ],
      baselines: new Map([["primary", { migrationNumber: 0, snapshot: migrationSnapshot }]]),
    });

    expect(snapshots.get("primary")).toBe(migrationSnapshot);
    expect(snapshots.get("audit")?.types).toEqual({});
    expect(client.listTailorDBTypes).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "source", namespaceName: "audit" }),
    );
    expect(client.listTailorDBTypes).toHaveBeenCalledTimes(1);
  });

  test("rejects malformed baseline seed rows with their file and line", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "migration-test-seed-"));
    temporaryDirectories.push(dataDir);
    fs.writeFileSync(path.join(dataDir, "Customer.jsonl"), "not-json\n");

    expect(() => loadSnapshotSeedData(dataDir, ["Customer"])).toThrow(/Customer\.jsonl.*line 1/);
  });

  test("polls a clone operation until it completes", async () => {
    const getOperation = vi
      .fn()
      .mockResolvedValueOnce({ status: CloneOperationStatus.PENDING, errorMessage: "" })
      .mockResolvedValueOnce({ status: CloneOperationStatus.PROCESSING, errorMessage: "" })
      .mockResolvedValueOnce({ status: CloneOperationStatus.COMPLETED, errorMessage: "" });
    const client = { getCloneApplicationDataOperation: getOperation } as unknown as OperatorClient;

    await expect(
      waitForCloneApplicationData(client, {
        sourceWorkspaceId: "source",
        targetWorkspaceId: "target",
        operationId: "operation",
        pollInterval: 0,
        timeout: 1_000,
      }),
    ).resolves.toBeUndefined();
    expect(getOperation).toHaveBeenCalledTimes(3);
  });

  test("reports a failed clone operation", async () => {
    const client = {
      getCloneApplicationDataOperation: vi.fn().mockResolvedValue({
        status: CloneOperationStatus.FAILED,
        errorMessage: "namespace mismatch",
      }),
    } as unknown as OperatorClient;

    await expect(
      waitForCloneApplicationData(client, {
        sourceWorkspaceId: "source",
        targetWorkspaceId: "target",
        operationId: "operation",
        pollInterval: 0,
        timeout: 1_000,
      }),
    ).rejects.toThrow("namespace mismatch");
  });
});
