import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { runCommand } from "@politty/zod";
import { GetTailorDBReplicationStatusResponseSchema } from "@tailor-platform/tailor-proto/tailordb_pb";
import {
  TailorDBReplicationDestination_State as DestinationState,
  TailorDBReplicationDestinationSchema,
  TailorDBReplicationSchema,
  TailorDBReplicationTableStatus_State as TableState,
} from "@tailor-platform/tailor-proto/tailordb_resource_pb";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { logger } from "#/cli/shared/logger";
import { prompt } from "#/cli/shared/prompt";
import { mockOperatorClient } from "#/cli/shared/test-helpers/operator-client";
import { listCommand as destinationListCommand } from "./destination/list";
import { listCommand } from "./list";
import { repairCommand } from "./repair";
import { statusCommand } from "./status";

const mocks = vi.hoisted(() => ({ client: undefined as unknown }));

vi.mock("#/cli/shared/operator-context", () => ({
  loadOperatorWorkspaceContext: vi.fn(async () => ({
    client: mocks.client,
    workspaceId: "workspace-id",
  })),
}));
vi.mock("#/cli/shared/readonly-guard", () => ({ assertWritable: vi.fn() }));
vi.mock("#/cli/shared/prompt", () => ({ prompt: { confirm: vi.fn() } }));

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(prompt.confirm).mockReset();
});

describe("tailordb replication list", () => {
  test("lists each replication with its source and destination", async () => {
    mocks.client = mockOperatorClient({
      listTailorDBReplications: {
        replications: [
          create(TailorDBReplicationSchema, {
            name: "analytics",
            source: { namespace: "main-db", types: [{ name: "User" }, { name: "Order" }] },
            destination: "warehouse",
            tablePrefix: "shop_",
            enabled: true,
          }),
          create(TailorDBReplicationSchema, {
            name: "lake",
            source: { namespace: "main-db", types: [] },
            destination: "warehouse",
            enabled: false,
          }),
        ],
        nextPageToken: "",
      },
    });
    const out = vi.spyOn(logger, "out").mockImplementation(() => {});

    const result = await runCommand(listCommand, []);

    expect(result.success).toBe(true);
    expect(out).toHaveBeenCalledWith([
      {
        name: "analytics",
        namespace: "main-db",
        destination: "warehouse",
        tablePrefix: "shop_",
        enabled: true,
        types: 2,
      },
      {
        name: "lake",
        namespace: "main-db",
        destination: "warehouse",
        tablePrefix: "",
        enabled: false,
        types: 0,
      },
    ]);
  });
});

describe("tailordb replication destination list", () => {
  test("lists each destination with its state and service account", async () => {
    mocks.client = mockOperatorClient({
      listTailorDBReplicationDestinations: {
        destinations: [
          create(TailorDBReplicationDestinationSchema, {
            name: "warehouse",
            kind: {
              case: "bigquery",
              value: {
                project: "acme-analytics",
                dataset: "tailor",
                serviceAccountEmail: "repl-abc@pool.iam.gserviceaccount.com",
              },
            },
            status: {
              state: DestinationState.PENDING_PERMISSION,
              message: "missing dataEditor",
              lastVerifiedAt: timestampFromDate(new Date("2026-11-01T00:00:00.000Z")),
            },
          }),
        ],
        nextPageToken: "",
      },
    });
    const out = vi.spyOn(logger, "out").mockImplementation(() => {});

    const result = await runCommand(destinationListCommand, []);

    expect(result.success).toBe(true);
    expect(out).toHaveBeenCalledWith([
      {
        name: "warehouse",
        dataset: "acme-analytics.tailor",
        serviceAccount: "repl-abc@pool.iam.gserviceaccount.com",
        state: "PENDING_PERMISSION",
        message: "missing dataEditor",
        lastVerifiedAt: "2026-11-01T00:00:00.000Z",
      },
    ]);
  });
});

describe("tailordb replication status", () => {
  test("lists the state of each table", async () => {
    mocks.client = mockOperatorClient({
      getTailorDBReplicationStatus: create(GetTailorDBReplicationStatusResponseSchema, {
        tables: [
          {
            type: "User",
            table: "shop_User",
            state: TableState.STREAMING,
            backfillCompletedAt: timestampFromDate(new Date("2026-11-01T00:00:00.000Z")),
          },
          {
            type: "Order",
            table: "shop_Order",
            state: TableState.ERROR,
            message: "table was deleted",
          },
        ],
      }),
    });
    const out = vi.spyOn(logger, "out").mockImplementation(() => {});

    const result = await runCommand(statusCommand, ["analytics"]);

    expect(result.success).toBe(true);
    expect(out).toHaveBeenCalledWith([
      {
        type: "User",
        table: "shop_User",
        state: "STREAMING",
        backfillCompletedAt: "2026-11-01T00:00:00.000Z",
        message: "",
      },
      {
        type: "Order",
        table: "shop_Order",
        state: "ERROR",
        backfillCompletedAt: null,
        message: "table was deleted",
      },
    ]);
  });

  test("reports a replication the workspace does not have", async () => {
    mocks.client = mockOperatorClient({
      getTailorDBReplicationStatus: () => {
        throw new ConnectError("not found", Code.NotFound);
      },
    });

    const result = await runCommand(statusCommand, ["missing"]);

    expect(result.success).toBe(false);
    expect(result.success ? undefined : result.error).toMatchObject({
      code: "TAILORDB_REPLICATION_NOT_FOUND",
    });
  });
});

describe("tailordb replication repair", () => {
  test("repairs the tables in ERROR without asking", async () => {
    const client = mockOperatorClient({ repairTailorDBReplication: { typeNames: ["Order"] } });
    mocks.client = client;
    const success = vi.spyOn(logger, "success").mockImplementation(() => {});

    const result = await runCommand(repairCommand, ["analytics"]);

    expect(result.success).toBe(true);
    expect(prompt.confirm).not.toHaveBeenCalled();
    expect(client.repairTailorDBReplication).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "workspace-id", name: "analytics", typeNames: [] }),
    );
    expect(success).toHaveBeenCalledWith(expect.stringContaining("Order"));
  });

  test("asks before rewriting the tables of named types", async () => {
    const client = mockOperatorClient({
      repairTailorDBReplication: { typeNames: ["User", "Order"] },
    });
    mocks.client = client;
    vi.mocked(prompt.confirm).mockResolvedValue(true);
    vi.spyOn(logger, "success").mockImplementation(() => {});

    const result = await runCommand(repairCommand, [
      "analytics",
      "--type",
      "User",
      "--type",
      "Order",
    ]);

    expect(result.success).toBe(true);
    expect(prompt.confirm).toHaveBeenCalledOnce();
    expect(client.repairTailorDBReplication).toHaveBeenCalledWith(
      expect.objectContaining({ typeNames: ["User", "Order"] }),
    );
  });

  test("stops when the confirmation is declined", async () => {
    const client = mockOperatorClient({ repairTailorDBReplication: { typeNames: [] } });
    mocks.client = client;
    vi.mocked(prompt.confirm).mockResolvedValue(false);

    const result = await runCommand(repairCommand, ["analytics", "--type", "User"]);

    expect(result.success).toBe(false);
    expect(result.success ? undefined : result.error).toMatchObject({
      code: "TAILORDB_REPLICATION_REPAIR_CANCELLED",
    });
    expect(client.repairTailorDBReplication).not.toHaveBeenCalled();
  });

  test("skips the confirmation with --yes", async () => {
    mocks.client = mockOperatorClient({ repairTailorDBReplication: { typeNames: ["User"] } });
    vi.spyOn(logger, "success").mockImplementation(() => {});

    const result = await runCommand(repairCommand, ["analytics", "--type", "User", "--yes"]);

    expect(result.success).toBe(true);
    expect(prompt.confirm).not.toHaveBeenCalled();
  });

  test("says no table was queued and points at status when none is returned", async () => {
    mocks.client = mockOperatorClient({ repairTailorDBReplication: { typeNames: [] } });
    const info = vi.spyOn(logger, "info").mockImplementation(() => {});

    const result = await runCommand(repairCommand, ["analytics"]);

    expect(result.success).toBe(true);
    expect(info).toHaveBeenCalledWith(expect.stringContaining("was queued by this call"));
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining("tailor tailordb replication status analytics"),
    );
  });
});
