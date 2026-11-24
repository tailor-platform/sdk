import * as fs from "node:fs";
import * as os from "node:os";
import { Code, ConnectError } from "@connectrpc/connect";
import { CloneOperationStatus } from "@tailor-platform/tailor-proto/application_pb";
import { JsonlReader, unwrap } from "lines-db";
import * as path from "pathe";
import { afterEach, describe, expect, test, vi } from "vitest";
import { verifyRemoteSchema } from "#/cli/commands/tailordb/migrate/schema-checks";
import { errorToJson } from "#/cli/shared/error-json";
import { mockOperatorClient } from "#/cli/shared/test-helpers/operator-client";
import { omitUndefined } from "#/utils/omit-undefined";
import { getNamespacesWithMigrations } from "./config";
import { normalizeSchemaSnapshot } from "./snapshot";
import {
  assertCloneTargetRegion,
  assertSourceBaselineFresh,
  assertSourceMatchesCheckpoints,
  createMigrationTestBaselineSnapshots,
  deleteExistingUserProfileConfig,
  assertTargetMatchesLocation,
  loadSnapshotSeedData,
  resolveSourceMigrationNumber,
  resolveAssertionNamespace,
  resolveTemporaryWorkspaceLocation,
  sortSeedTypesForSnapshot,
  migrationTestCloneApplication,
  waitForCloneApplicationData,
} from "./test-runtime";
import type { OperatorClient } from "#/cli/shared/client";
import type { LoadedConfigFile } from "#/cli/shared/config-loader";
import type { PreparedMigrationTest } from "./test-types";
import type { RemoteSchemaVerificationResult } from "./types";
import type { MessageInitShape } from "@bufbuild/protobuf";
import type { MetadataSchema } from "@tailor-platform/tailor-proto/metadata_resource_pb";

vi.mock("./config", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const original = await importOriginal<typeof import("./config")>();
  return { ...original, getNamespacesWithMigrations: vi.fn() };
});

vi.mock("#/cli/commands/tailordb/migrate/schema-checks", async (importOriginal) => {
  const original =
    // eslint-disable-next-line @typescript-eslint/consistent-type-imports
    await importOriginal<typeof import("#/cli/commands/tailordb/migrate/schema-checks")>();
  return { ...original, verifyRemoteSchema: vi.fn() };
});

function thrownBy(run: () => unknown): Error {
  try {
    run();
  } catch (error) {
    if (error instanceof Error) return error;
    throw error;
  }
  return expect.unreachable("expected the call to throw");
}

describe("migration test runtime", () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const directory of temporaryDirectories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("requires an explicit assertion namespace when migrations span namespaces", () => {
    expect(() => resolveAssertionNamespace(["primary", "analytics"])).toThrow(/--assert-namespace/);
    expect(resolveAssertionNamespace(["primary", "analytics"], "analytics")).toBe("analytics");
    expect(resolveAssertionNamespace(["primary"])).toBe("primary");
    expect(() => resolveAssertionNamespace(["primary"], "analytics")).toThrow(
      /no pending migrations/,
    );
  });

  test("orders seed types by baseline foreign-key dependencies", () => {
    const snapshot = normalizeSchemaSnapshot({
      version: 1,
      namespace: "tailordb",
      createdAt: "2026-08-05T00:00:00.000Z",
      tables: {
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

  test("orders a table after the table that a field inside its nested field points at", () => {
    const snapshot = normalizeSchemaSnapshot({
      version: 1,
      namespace: "tailordb",
      createdAt: "2026-08-05T00:00:00.000Z",
      tables: {
        Order: {
          name: "Order",
          pluralForm: "Orders",
          fields: {
            id: { type: "uuid", required: true },
            info: {
              type: "nested",
              required: false,
              fields: {
                customerId: {
                  type: "uuid",
                  required: false,
                  foreignKey: true,
                  foreignKeyType: "Customer",
                },
              },
            },
          },
        },
        Customer: { name: "Customer", pluralForm: "Customers", fields: {} },
      },
    });

    expect(sortSeedTypesForSnapshot(snapshot).order).toEqual(["Customer", "Order"]);
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
      tables: {
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
      tables: {},
    });
    const client = mockOperatorClient({
      listTailorDBTypes: { tailordbTypes: [], nextPageToken: "" },
      listTailorDBGQLPermissions: { permissions: [], nextPageToken: "" },
    });

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
      baselines: new Map([
        ["primary", { migrationNumber: 0, snapshot: migrationSnapshot, historyId: null }],
      ]),
    });

    expect(snapshots.get("primary")).toBe(migrationSnapshot);
    expect(snapshots.get("audit")?.tables).toEqual({});
    expect(client.listTailorDBTypes).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "source", namespaceName: "audit" }),
    );
    expect(client.listTailorDBTypes).toHaveBeenCalledTimes(1);
  });

  test.each([
    ["an interior blank line", '{"id":1}\n\n{"id":2}\n'],
    ["whitespace-only lines", '{"id":1}\n \t \n{"id":2}\n'],
    ["leading blank lines", '\n\n{"id":1}\n{"id":2}\n'],
    ["CRLF endings and a blank line", '{"id":1}\r\n\r\n{"id":2}\r\n'],
    ["a byte order mark", '\uFEFF{"id":1}\n{"id":2}\n'],
  ])(
    "reads the baseline seed rows the validator reads from a file with %s",
    async (_label, content) => {
      const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "migration-test-seed-"));
      temporaryDirectories.push(dataDir);
      fs.writeFileSync(path.join(dataDir, "Customer.jsonl"), content);
      const validatorRows = unwrap(await JsonlReader.read(path.join(dataDir, "Customer.jsonl")));

      expect(validatorRows).toEqual([{ id: 1 }, { id: 2 }]);
      expect(loadSnapshotSeedData(dataDir, ["Customer"])).toEqual({ Customer: validatorRows });
    },
  );

  test.each([
    ["a malformed row", "not-json\n", 1],
    ["a malformed row after blank lines", '\n\n{"id":1}\nnot-json\n', 4],
    ["a second byte order mark", '\uFEFF\uFEFF{"id":1}\n{"id":2}\n', 1],
    ["a no-break space before the first row", '\u00A0{"id":1}\n{"id":2}\n', 1],
    ["a no-break space after the last row", '{"id":1}\n{"id":2}\u00A0\n', 2],
  ])(
    "rejects a baseline seed file with %s at the line the validator rejects",
    async (_label, content, line) => {
      const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "migration-test-seed-"));
      temporaryDirectories.push(dataDir);
      fs.writeFileSync(path.join(dataDir, "Customer.jsonl"), content);

      const file = path.join(dataDir, "Customer.jsonl");
      expect(await JsonlReader.read(file)).toMatchObject({
        ok: false,
        error: { line },
      });
      vi.spyOn(process, "cwd").mockReturnValue(dataDir);
      const error = thrownBy(() => loadSnapshotSeedData(dataDir, ["Customer"]));
      expect(error.message).toMatch(/^Invalid JSON: /);
      expect(errorToJson(error).error).toEqual({
        code: "SEED_DATA_INVALID",
        message: `Customer.jsonl:${line}: ${error.message}`,
        context: { file, line },
      });
    },
  );

  test("rejects a baseline seed row that is not a JSON object at its line", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "migration-test-seed-"));
    temporaryDirectories.push(dataDir);
    const file = path.join(dataDir, "Customer.jsonl");
    fs.writeFileSync(file, '{"id":1}\n[]\n');

    vi.spyOn(process, "cwd").mockReturnValue(dataDir);

    const error = thrownBy(() => loadSnapshotSeedData(dataDir, ["Customer"]));

    expect(error.message).toBe("Invalid seed row: expected a JSON object");
    expect(errorToJson(error).error).toEqual({
      code: "SEED_DATA_INVALID",
      message: "Customer.jsonl:2: Invalid seed row: expected a JSON object",
      context: { file, line: 2 },
    });
  });

  test("polls a clone operation until it completes", async () => {
    const client = mockOperatorClient({ getCloneApplicationDataOperation: {} });
    client.getCloneApplicationDataOperation
      .mockResolvedValueOnce({ status: CloneOperationStatus.PENDING, errorMessage: "" })
      .mockResolvedValueOnce({ status: CloneOperationStatus.PROCESSING, errorMessage: "" })
      .mockResolvedValueOnce({ status: CloneOperationStatus.COMPLETED, errorMessage: "" });

    await expect(
      waitForCloneApplicationData(client, {
        sourceWorkspaceId: "source",
        targetWorkspaceId: "target",
        operationId: "operation",
        pollInterval: 0,
        timeout: 1_000,
      }),
    ).resolves.toBeUndefined();
    expect(client.getCloneApplicationDataOperation).toHaveBeenCalledTimes(3);
  });

  test("sends status checks without a request timeout when the wait is unlimited", async () => {
    const client = mockOperatorClient({ getCloneApplicationDataOperation: {} });
    client.getCloneApplicationDataOperation
      .mockResolvedValueOnce({ status: CloneOperationStatus.PROCESSING, errorMessage: "" })
      .mockResolvedValueOnce({ status: CloneOperationStatus.COMPLETED, errorMessage: "" });

    await waitForCloneApplicationData(client, {
      sourceWorkspaceId: "source",
      targetWorkspaceId: "target",
      operationId: "operation",
      pollInterval: 0,
      timeout: Infinity,
    });

    expect(
      client.getCloneApplicationDataOperation.mock.calls.map(([, callOptions]) => callOptions),
    ).toEqual([undefined, undefined]);
  });

  test("reports a failed clone operation", async () => {
    const client = mockOperatorClient({
      getCloneApplicationDataOperation: {
        status: CloneOperationStatus.FAILED,
        errorMessage: "namespace mismatch",
      },
    });

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

  test("reports a clone timeout under the given error code prefix", async () => {
    const client = mockOperatorClient({
      getCloneApplicationDataOperation: { status: CloneOperationStatus.PENDING, errorMessage: "" },
    });

    await expect(
      waitForCloneApplicationData(client, {
        sourceWorkspaceId: "source",
        targetWorkspaceId: "target",
        operationId: "operation",
        pollInterval: 0,
        timeout: 0,
        errorCodePrefix: "DATA_CLONE",
      }),
    ).rejects.toMatchObject({
      code: "DATA_CLONE_TIMEOUT",
      context: {
        operationId: "operation",
        sourceWorkspaceId: "source",
        targetWorkspaceId: "target",
      },
    });
  });

  test("does not claim the clone keeps running when the caller has no step to resume it", async () => {
    const client = mockOperatorClient({ getCloneApplicationDataOperation: {} });

    const error = await waitForCloneApplicationData(client, {
      sourceWorkspaceId: "source",
      targetWorkspaceId: "target",
      operationId: "operation",
      timeout: 0,
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: "MIGRATION_TEST_CLONE_TIMEOUT" });
  });

  test("bounds a poll that never answers by the remaining timeout", async () => {
    const client = mockOperatorClient({
      getCloneApplicationDataOperation: (_request, callOptions) => {
        const timeoutMs = callOptions?.timeoutMs;
        if (timeoutMs === undefined) {
          return Promise.reject(new Error("poll sent without a timeout"));
        }
        return new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new ConnectError("deadline exceeded", Code.DeadlineExceeded)),
            timeoutMs,
          ),
        );
      },
    });

    const startedAt = Date.now();
    await expect(
      waitForCloneApplicationData(client, {
        sourceWorkspaceId: "source",
        targetWorkspaceId: "target",
        operationId: "operation",
        timeout: 50,
        errorCodePrefix: "DATA_CLONE",
      }),
    ).rejects.toMatchObject({ code: "DATA_CLONE_TIMEOUT" });
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });

  test("reports each change of a non-terminal status once", async () => {
    const statuses = [
      CloneOperationStatus.PENDING,
      CloneOperationStatus.PENDING,
      CloneOperationStatus.PROCESSING,
      CloneOperationStatus.PROCESSING,
      CloneOperationStatus.COMPLETED,
    ];
    const client = mockOperatorClient({ getCloneApplicationDataOperation: {} });
    for (const status of statuses) {
      client.getCloneApplicationDataOperation.mockResolvedValueOnce({ status, errorMessage: "" });
    }
    const reported: CloneOperationStatus[] = [];

    await waitForCloneApplicationData(client, {
      sourceWorkspaceId: "source",
      targetWorkspaceId: "target",
      operationId: "operation",
      pollInterval: 0,
      onStatus: (status) => reported.push(status),
    });

    expect(reported).toEqual([CloneOperationStatus.PENDING, CloneOperationStatus.PROCESSING]);
  });

  test("waits up to 30 minutes when no timeout is given", async () => {
    const client = mockOperatorClient({
      getCloneApplicationDataOperation: {
        status: CloneOperationStatus.COMPLETED,
        errorMessage: "",
      },
    });

    await waitForCloneApplicationData(client, {
      sourceWorkspaceId: "source",
      targetWorkspaceId: "target",
      operationId: "operation",
    });

    const [, callOptions] = client.getCloneApplicationDataOperation.mock.calls[0]!;
    expect(callOptions?.timeoutMs).toBeGreaterThan(29 * 60 * 1_000);
    expect(callOptions?.timeoutMs).toBeLessThanOrEqual(30 * 60 * 1_000);
  });

  test("rethrows a deadline error that arrives long before the wait budget is spent", async () => {
    const client = mockOperatorClient({
      getCloneApplicationDataOperation: () =>
        Promise.reject(new ConnectError("server deadline", Code.DeadlineExceeded)),
    });

    await expect(
      waitForCloneApplicationData(client, {
        sourceWorkspaceId: "source",
        targetWorkspaceId: "target",
        operationId: "operation",
        pollInterval: 0,
        timeout: 60_000,
      }),
    ).rejects.toThrow("server deadline");
  });

  test("does not sleep past the deadline between polls", async () => {
    const client = mockOperatorClient({
      getCloneApplicationDataOperation: { status: CloneOperationStatus.PENDING, errorMessage: "" },
    });

    const startedAt = Date.now();
    await expect(
      waitForCloneApplicationData(client, {
        sourceWorkspaceId: "source",
        targetWorkspaceId: "target",
        operationId: "operation",
        pollInterval: 5_000,
        timeout: 50,
      }),
    ).rejects.toMatchObject({
      code: "MIGRATION_TEST_CLONE_TIMEOUT",
      message: "Application data clone timed out after 50 ms.",
    });
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });

  function runtimeState(
    client: OperatorClient,
    services: unknown[] = [],
  ): Parameters<typeof assertSourceBaselineFresh>[0] {
    return {
      client,
      loaded: {
        config: { path: "/project/tailor.config.ts" },
        application: {
          tailorDBServices: services,
          authServices: [{ config: { name: "auth-ns" } }],
        },
      } as unknown as Parameters<typeof assertSourceBaselineFresh>[0]["loaded"],
      options: { data: "seed" },
      seeds: [],
    };
  }

  function preparedMigrationTest(
    overrides: Partial<PreparedMigrationTest> = {},
  ): PreparedMigrationTest {
    return {
      sourceWorkspaceId: "source",
      sourceApplicationName: "app",
      temporaryWorkspace: { name: "migration-test", region: "asia-northeast" },
      baselines: new Map(),
      baselineSnapshots: new Map(),
      targetSnapshots: new Map(),
      pendingNamespaces: [],
      ...overrides,
    };
  }

  function emptySnapshot(namespace: string) {
    return normalizeSchemaSnapshot({
      version: 1,
      namespace,
      createdAt: "2026-08-05T00:00:00.000Z",
      tables: {},
    });
  }

  test("accepts a source that still matches the prepared baselines", async () => {
    vi.mocked(getNamespacesWithMigrations).mockReturnValue([
      { namespace: "main", migrationsDir: "/project/migrations/main" },
    ]);
    vi.mocked(verifyRemoteSchema).mockResolvedValue([
      { namespace: "main", remoteMigrationNumber: 1, drifts: [], hasDrift: false },
    ]);
    const client = mockOperatorClient({
      getMetadata: { metadata: { labels: { "sdk-migration": "m0001" } } },
    });
    const prepared = preparedMigrationTest({
      baselines: new Map([
        ["main", { migrationNumber: 1, snapshot: emptySnapshot("main"), historyId: null }],
      ]),
    });

    await expect(
      assertSourceBaselineFresh(runtimeState(client), prepared, "source"),
    ).resolves.toBeUndefined();
  });

  test("rejects a source namespace that drifted after preparation", async () => {
    vi.mocked(getNamespacesWithMigrations).mockReturnValue([
      { namespace: "main", migrationsDir: "/project/migrations/main" },
    ]);
    vi.mocked(verifyRemoteSchema).mockResolvedValue([
      { namespace: "main", remoteMigrationNumber: 1, drifts: [], hasDrift: true },
    ]);
    const prepared = preparedMigrationTest();

    await expect(
      assertSourceBaselineFresh(runtimeState(mockOperatorClient({})), prepared, "source"),
    ).rejects.toThrow('Source namespace "main" changed after migration test preparation');
  });

  test("rejects a source whose migration checkpoint moved after preparation", async () => {
    vi.mocked(getNamespacesWithMigrations).mockReturnValue([
      { namespace: "main", migrationsDir: "/project/migrations/main" },
    ]);
    vi.mocked(verifyRemoteSchema).mockResolvedValue([
      { namespace: "main", remoteMigrationNumber: 2, drifts: [], hasDrift: false },
    ]);
    const client = mockOperatorClient({
      getMetadata: { metadata: { labels: { "sdk-migration": "m0002" } } },
    });
    const prepared = preparedMigrationTest({
      baselines: new Map([
        ["main", { migrationNumber: 1, snapshot: emptySnapshot("main"), historyId: null }],
      ]),
    });

    await expect(
      assertSourceBaselineFresh(runtimeState(client), prepared, "source"),
    ).rejects.toThrow('Source namespace "main" moved from migration 1 to 2');
  });

  test("rejects a source with a partially applied migration", async () => {
    vi.mocked(getNamespacesWithMigrations).mockReturnValue([
      { namespace: "main", migrationsDir: "/project/migrations/main" },
    ]);
    vi.mocked(verifyRemoteSchema).mockResolvedValue([
      { namespace: "main", remoteMigrationNumber: 1, drifts: [], hasDrift: false },
    ]);
    const client = mockOperatorClient({
      getMetadata: {
        metadata: { labels: { "sdk-migration": "m0001", "sdk-migration-in-progress": "m0002" } },
      },
    });
    const prepared = preparedMigrationTest({
      baselines: new Map([
        ["main", { migrationNumber: 1, snapshot: emptySnapshot("main"), historyId: null }],
      ]),
    });

    await expect(
      assertSourceBaselineFresh(runtimeState(client), prepared, "source"),
    ).rejects.toThrow("partially applied");
  });

  test("rejects an unmigrated clone namespace whose schema changed after preparation", async () => {
    vi.mocked(getNamespacesWithMigrations).mockReturnValue([]);
    vi.mocked(verifyRemoteSchema).mockResolvedValue([]);
    const client = mockOperatorClient({
      listTailorDBTypes: { tailordbTypes: [], nextPageToken: "" },
      listTailorDBGQLPermissions: { permissions: [], nextPageToken: "" },
    });
    const state = runtimeState(client, [{ namespace: "audit", config: { files: [] }, types: {} }]);
    const prepared = preparedMigrationTest({
      baselineSnapshots: new Map([
        [
          "audit",
          normalizeSchemaSnapshot({
            version: 1,
            namespace: "audit",
            createdAt: "2026-08-05T00:00:00.000Z",
            tables: {
              AuditLog: { name: "AuditLog", pluralForm: "auditLogs", fields: {} },
            },
          }),
        ],
      ]),
    });

    await expect(assertSourceBaselineFresh(state, prepared, "source")).rejects.toThrow(
      'Source namespace "audit" schema changed after migration test preparation',
    );
  });

  describe("temporary workspace location", () => {
    const sourceOrganization = "11111111-1111-4111-8111-111111111111";
    const sourceFolder = "22222222-2222-4222-8222-222222222222";
    const otherOrganization = "33333333-3333-4333-8333-333333333333";
    const otherFolder = "44444444-4444-4444-8444-444444444444";

    function folderClient(found = true) {
      return mockOperatorClient({
        getOrganizationFolder: async () =>
          found
            ? { folder: { id: "folder" } }
            : Promise.reject(new ConnectError("not found", Code.NotFound)),
      });
    }

    const source = { organizationId: sourceOrganization, folderId: sourceFolder };

    test("inherits the source organization and folder when nothing is specified", async () => {
      const client = folderClient();

      await expect(resolveTemporaryWorkspaceLocation(client, source, {})).resolves.toEqual({
        organizationId: sourceOrganization,
        folderId: sourceFolder,
      });
      expect(client.getOrganizationFolder).not.toHaveBeenCalled();
    });

    test("places the workspace at the organization root when only --organization-id is given", async () => {
      const client = folderClient();

      await expect(
        resolveTemporaryWorkspaceLocation(client, source, { organizationId: otherOrganization }),
      ).resolves.toEqual({ organizationId: otherOrganization });
      expect(client.getOrganizationFolder).not.toHaveBeenCalled();
    });

    test("places the workspace in the folder of the source organization when only --folder-id is given", async () => {
      const client = folderClient();

      await expect(
        resolveTemporaryWorkspaceLocation(client, source, { folderId: otherFolder }),
      ).resolves.toEqual({ organizationId: sourceOrganization, folderId: otherFolder });
      expect(client.getOrganizationFolder).toHaveBeenCalledWith({
        organizationId: sourceOrganization,
        folderId: otherFolder,
      });
    });

    test("places the workspace in the given folder of the given organization", async () => {
      const client = folderClient();

      await expect(
        resolveTemporaryWorkspaceLocation(client, source, {
          organizationId: otherOrganization,
          folderId: otherFolder,
        }),
      ).resolves.toEqual({ organizationId: otherOrganization, folderId: otherFolder });
      expect(client.getOrganizationFolder).toHaveBeenCalledWith({
        organizationId: otherOrganization,
        folderId: otherFolder,
      });
    });

    test("rejects a folder that does not belong to the organization", async () => {
      await expect(
        resolveTemporaryWorkspaceLocation(folderClient(false), source, {
          organizationId: otherOrganization,
          folderId: otherFolder,
        }),
      ).rejects.toMatchObject({
        code: "MIGRATION_TEST_OPTIONS_INVALID",
        message: `Folder "${otherFolder}" was not found in organization "${otherOrganization}".`,
        details: expect.stringContaining("belongs to a different organization"),
      });
    });

    test("names the source organization when only --folder-id is given and the folder is not in it", async () => {
      await expect(
        resolveTemporaryWorkspaceLocation(folderClient(false), source, { folderId: otherFolder }),
      ).rejects.toMatchObject({
        message: `Folder "${otherFolder}" was not found in organization "${sourceOrganization}" (the source workspace's organization).`,
        suggestion: expect.stringContaining("--organization-id"),
      });
    });

    test("requires --organization-id with --folder-id when the source has no organization", async () => {
      const client = folderClient();

      await expect(
        resolveTemporaryWorkspaceLocation(client, {}, { folderId: otherFolder }),
      ).rejects.toMatchObject({
        code: "MIGRATION_TEST_OPTIONS_INVALID",
        message: "--folder-id requires --organization-id.",
        details: "The source workspace is not in an organization.",
      });
      expect(client.getOrganizationFolder).not.toHaveBeenCalled();
    });
  });

  describe("designated target location", () => {
    const organization = "11111111-1111-4111-8111-111111111111";
    const folder = "22222222-2222-4222-8222-222222222222";
    const otherOrganization = "33333333-3333-4333-8333-333333333333";
    const otherFolder = "44444444-4444-4444-8444-444444444444";
    const target = { id: "target-id", organizationId: organization, folderId: folder };

    test("accepts a target that is in the specified organization and folder", () => {
      expect(() =>
        assertTargetMatchesLocation(target, { organizationId: organization, folderId: folder }),
      ).not.toThrow();
    });

    test("accepts a target when no organization or folder is specified", () => {
      expect(() => assertTargetMatchesLocation(target, {})).not.toThrow();
    });

    test("compares organization and folder IDs regardless of letter case", () => {
      const hexTarget = {
        id: "target-id",
        organizationId: "abcdefab-cdef-4bcd-8efa-bcdefabcdefa",
        folderId: "fedcbafe-dcba-4edc-8baf-edcbafedcbaf",
      };

      expect(() =>
        assertTargetMatchesLocation(hexTarget, {
          organizationId: hexTarget.organizationId.toUpperCase(),
          folderId: hexTarget.folderId.toUpperCase(),
        }),
      ).not.toThrow();
    });

    test("rejects a specified organization that differs from the target's", () => {
      expect(() =>
        assertTargetMatchesLocation(target, { organizationId: otherOrganization }),
      ).toThrow(
        expect.objectContaining({
          code: "MIGRATION_TEST_OPTIONS_INVALID",
          message: expect.stringContaining(
            `--organization-id "${otherOrganization}" does not match the designated target workspace "target-id", which is in organization "${organization}"`,
          ),
        }),
      );
    });

    test("rejects a specified folder that differs from the target's", () => {
      expect(() => assertTargetMatchesLocation(target, { folderId: otherFolder })).toThrow(
        expect.objectContaining({
          code: "MIGRATION_TEST_OPTIONS_INVALID",
          message: expect.stringContaining(
            `--folder-id "${otherFolder}" does not match the designated target workspace "target-id", which is in folder "${folder}"`,
          ),
        }),
      );
    });

    test("describes a target outside any folder as having no folder", () => {
      expect(() =>
        assertTargetMatchesLocation({ ...target, folderId: "" }, { folderId: folder }),
      ).toThrow(expect.objectContaining({ message: expect.stringContaining("has no folder") }));
    });
  });

  const auditLogDrift = {
    tableName: "AuditLog",
    kind: "type_missing_remote",
    details: "Table 'AuditLog' exists in snapshot but not in remote",
  } as const;

  const sourceContext = {
    workspaceId: "source-workspace",
    profile: "staging",
    configPath: path.join(process.cwd(), "tailor.config.ts"),
  };

  function sourceCheck(
    overrides: Partial<RemoteSchemaVerificationResult> = {},
  ): RemoteSchemaVerificationResult {
    return {
      namespace: "main",
      remoteMigrationNumber: 0,
      drifts: [],
      hasDrift: false,
      ...overrides,
    };
  }

  function unlabeledBaselineCase(
    check: RemoteSchemaVerificationResult,
    metadata: MessageInitShape<typeof MetadataSchema> | undefined,
  ) {
    vi.mocked(getNamespacesWithMigrations).mockReturnValue([
      { namespace: "main", migrationsDir: "/project/migrations/main" },
    ]);
    vi.mocked(verifyRemoteSchema).mockResolvedValue([check]);
    const client = mockOperatorClient({ getMetadata: omitUndefined({ metadata }) });
    const prepared = preparedMigrationTest({
      baselines: new Map([
        ["main", { migrationNumber: 0, snapshot: emptySnapshot("main"), historyId: null }],
      ]),
    });
    return assertSourceBaselineFresh(runtimeState(client), prepared, "source");
  }

  test("accepts a source baseline numbered 0 while the unlabeled namespace still matches 0000", async () => {
    await expect(
      unlabeledBaselineCase(sourceCheck({ checkpointUnset: true }), { labels: {} }),
    ).resolves.toBeUndefined();
  });

  test("rejects a numbered 0 baseline whose unlabeled source schema changed after preparation", async () => {
    await expect(
      unlabeledBaselineCase(
        sourceCheck({ checkpointUnset: true, hasDrift: true, drifts: [auditLogDrift] }),
        { labels: {} },
      ),
    ).rejects.toMatchObject({ code: "MIGRATION_TEST_SOURCE_CHANGED" });
  });

  test("rejects a numbered 0 baseline whose source metadata disappeared after preparation", async () => {
    await expect(
      unlabeledBaselineCase(sourceCheck({ skipped: "not_deployed" }), undefined),
    ).rejects.toMatchObject({
      code: "MIGRATION_TEST_SOURCE_CHECKPOINT_MISSING",
    });
  });

  test("rejects an unlabeled source whose schema differs from the 0000 snapshot", () => {
    expect(() =>
      assertSourceMatchesCheckpoints(
        [sourceCheck({ checkpointUnset: true, hasDrift: true, drifts: [auditLogDrift] })],
        sourceContext,
      ),
    ).toThrow(
      expect.objectContaining({
        code: "MIGRATION_TEST_SOURCE_INVALID",
        message: expect.stringContaining("differs from the initial migration snapshot"),
        details: expect.stringContaining("AuditLog"),
      }),
    );
  });

  test("rejects a labeled source whose schema differs from its checkpoint", () => {
    const source = { ...sourceContext, configPath: path.join(process.cwd(), "source.config.ts") };
    expect(() =>
      assertSourceMatchesCheckpoints(
        [sourceCheck({ remoteMigrationNumber: 2, hasDrift: true, drifts: [auditLogDrift] })],
        source,
      ),
    ).toThrow(
      expect.objectContaining({
        code: "MIGRATION_TEST_SOURCE_INVALID",
        message: expect.stringContaining("does not match its migration checkpoint"),
        details: expect.stringContaining("AuditLog"),
        suggestion: `Run \`tailor tailordb migration validate --namespace main --config=source.config.ts --workspace-id=${source.workspaceId} --profile=${source.profile}\` to check the migration history and source schema, or \`tailor tailordb migration status --namespace main --config=source.config.ts --workspace-id=${source.workspaceId} --profile=${source.profile}\` to inspect the source workspace's checkpoint.`,
      }),
    );
  });

  test("rejects a source whose checkpoint is not in the local migration history", () => {
    expect(() =>
      assertSourceMatchesCheckpoints(
        [sourceCheck({ remoteMigrationNumber: 7, checkpointMissingLocal: true })],
        sourceContext,
      ),
    ).toThrow(
      expect.objectContaining({
        code: "MIGRATION_TEST_SOURCE_INVALID",
        message: expect.stringContaining("does not match its migration checkpoint"),
        suggestion: `Pull the latest migration files if this checkout is behind. Otherwise run \`tailor tailordb migration status --namespace main --workspace-id=${sourceContext.workspaceId} --profile=${sourceContext.profile}\` to compare the source workspace's checkpoint and migration history with the local ones.`,
      }),
    );
  });

  test("rejects a source with a pending checkpoint repair", () => {
    expect(() =>
      assertSourceMatchesCheckpoints(
        [
          sourceCheck({
            remoteMigrationNumber: 5,
            checkpointRepair: { from: 5, to: 0, fromHistoryId: null, toHistoryId: "hcurrent" },
          }),
        ],
        sourceContext,
      ),
    ).toThrow(expect.objectContaining({ code: "MIGRATION_TEST_SOURCE_REPAIR_PENDING" }));
  });

  test("rejects a source with tables its checkpoint's migration removed that a deploy has not deleted", () => {
    expect(() =>
      assertSourceMatchesCheckpoints(
        [sourceCheck({ remoteMigrationNumber: 2, unfinishedRemovals: ["Legacy"] })],
        sourceContext,
      ),
    ).toThrow(
      expect.objectContaining({
        code: "MIGRATION_TEST_SOURCE_CLEANUP_PENDING",
        message: expect.stringContaining("Legacy"),
        suggestion: "Deploy to the source workspace first.",
      }),
    );
  });

  test("accepts sources that match their checkpoints", () => {
    expect(() =>
      assertSourceMatchesCheckpoints(
        [
          sourceCheck({ checkpointUnset: true }),
          sourceCheck({ namespace: "other", remoteMigrationNumber: 3 }),
          sourceCheck({ namespace: "cleaned", remoteMigrationNumber: 2, unfinishedRemovals: [] }),
        ],
        sourceContext,
      ),
    ).not.toThrow();
  });

  test("returns the labeled migration number as is", () => {
    expect(resolveSourceMigrationNumber(sourceCheck({ remoteMigrationNumber: 3 }))).toBe(3);
  });

  test("treats an unlabeled source that matches the 0000 snapshot as migration 0", () => {
    expect(resolveSourceMigrationNumber(sourceCheck({ checkpointUnset: true }))).toBe(0);
  });

  test("rejects a source namespace that was never deployed", () => {
    expect(() => resolveSourceMigrationNumber(sourceCheck({ skipped: "not_deployed" }))).toThrow(
      expect.objectContaining({
        code: "MIGRATION_TEST_SOURCE_CHECKPOINT_MISSING",
        message: expect.stringContaining("has not been deployed"),
      }),
    );
  });

  test("deletes a retained target's existing user profile config", async () => {
    const client = mockOperatorClient({
      getUserProfileConfig: { userProfileProviderConfig: {} },
      deleteUserProfileConfig: {},
    });

    await deleteExistingUserProfileConfig(runtimeState(client), "target");

    expect(client.deleteUserProfileConfig).toHaveBeenCalledWith({
      workspaceId: "target",
      namespaceName: "auth-ns",
    });
  });

  test("skips user profile config deletion when the target has none", async () => {
    const client = mockOperatorClient({
      getUserProfileConfig: () => Promise.reject(new ConnectError("not found", Code.NotFound)),
      deleteUserProfileConfig: {},
    });

    await deleteExistingUserProfileConfig(runtimeState(client), "target");

    expect(client.deleteUserProfileConfig).not.toHaveBeenCalled();
  });

  test("deletes the user profile config of every Auth service of a workspace config", async () => {
    const client = mockOperatorClient({
      getUserProfileConfig: { userProfileProviderConfig: {} },
      deleteUserProfileConfig: {},
    });
    const state = runtimeState(client);
    const withTwoAuths = {
      ...state,
      loaded: {
        ...state.loaded,
        application: {
          ...state.loaded.application,
          authServices: [{ config: { name: "corp-auth" } }, { config: { name: "partner-auth" } }],
        },
      },
    } as unknown as typeof state;

    await deleteExistingUserProfileConfig(withTwoAuths, "target");

    expect(
      client.deleteUserProfileConfig.mock.calls.map(([request]) => request.namespaceName),
    ).toEqual(["corp-auth", "partner-auth"]);
  });
});

describe("migrationTestCloneApplication", () => {
  const workspaceFile = (apps: Record<string, { db: string[] }>) =>
    ({
      kind: "workspace",
      workspace: {
        apps: Object.fromEntries(Object.entries(apps).map(([n, a]) => [n, { ...a, resolver: [] }])),
      },
      plugins: [],
    }) as unknown as LoadedConfigFile;

  test("clones the application of a defineConfig() config", () => {
    const file = {
      kind: "config",
      config: { name: "app" },
      plugins: [],
    } as unknown as LoadedConfigFile;
    expect(migrationTestCloneApplication(file, ["main"])).toBe("app");
  });

  test("clones the only application of a workspace config when it lists every pending namespace", () => {
    expect(
      migrationTestCloneApplication(workspaceFile({ shop: { db: ["order-db", "ledger-db"] } }), [
        "ledger-db",
      ]),
    ).toBe("shop");
  });

  test.each([
    [
      "several applications",
      { shop: { db: ["ledger-db"] }, admin: { db: ["ledger-db"] } },
      ["shop", "admin"],
    ],
    ["a pending namespace no application lists", { shop: { db: ["order-db"] } }, ["shop"]],
  ])("rejects a workspace config with %s", (_, apps, applications) => {
    expect(() => migrationTestCloneApplication(workspaceFile(apps), ["ledger-db"])).toThrow(
      expect.objectContaining({
        code: "MIGRATION_TEST_CLONE_UNSUPPORTED",
        context: { applications, pendingNamespaces: ["ledger-db"] },
      }),
    );
  });
});
