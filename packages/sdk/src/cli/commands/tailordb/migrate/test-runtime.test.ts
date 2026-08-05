import * as fs from "node:fs";
import * as os from "node:os";
import { CloneOperationStatus } from "@tailor-platform/tailor-proto/application_pb";
import * as path from "pathe";
import { afterEach, describe, expect, test, vi } from "vitest";
import { normalizeSchemaSnapshot } from "./snapshot";
import {
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
      '{"id":"customer-1","name":"Ada","email":"pending@example.com"}\n',
    );
    const snapshot = normalizeSchemaSnapshot({
      version: 1,
      namespace: "tailordb",
      createdAt: "2026-08-05T00:00:00.000Z",
      types: {
        Customer: {
          name: "Customer",
          pluralForm: "Customers",
          fields: { name: { type: "string", required: true } },
        },
        Order: {
          name: "Order",
          pluralForm: "Orders",
          fields: {},
        },
      },
    });

    expect(loadSnapshotSeedData(dataDir, ["Customer", "Order"], snapshot)).toEqual({
      Customer: [{ id: "customer-1", name: "Ada" }],
      Order: [],
    });
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
