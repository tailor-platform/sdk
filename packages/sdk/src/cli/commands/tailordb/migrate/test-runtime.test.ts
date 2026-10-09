import * as fs from "node:fs";
import * as os from "node:os";
import { Code, ConnectError } from "@connectrpc/connect";
import { CloneOperationStatus } from "@tailor-platform/tailor-proto/application_pb";
import * as path from "pathe";
import { afterEach, describe, expect, test, vi } from "vitest";
import { verifyRemoteSchema } from "#/cli/commands/tailordb/migrate/schema-checks";
import { computeSourceScriptHash } from "#/parser/service/tailordb/type-script";
import { getNamespacesWithMigrations } from "./config";
import { normalizeSchemaSnapshot } from "./snapshot";
import {
  assertCloneTargetRegion,
  assertSourceBaselineFresh,
  createMigrationTestBaselineSnapshots,
  deleteExistingUserProfileConfig,
  loadSnapshotSeedData,
  resolveSourceMigrationNumber,
  sortSeedTypesForSnapshot,
  waitForCloneApplicationData,
} from "./test-runtime";
import type { OperatorClient } from "#/cli/shared/client";
import type { LoadedConfig } from "#/cli/shared/config-loader";
import type { RemoteMigrationState } from "./remote-state";
import type { PreparedMigrationTest } from "./test-types";

vi.mock("./config", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const original = (await importOriginal()) as typeof import("./config");
  return { ...original, getNamespacesWithMigrations: vi.fn() };
});

vi.mock("#/cli/commands/tailordb/migrate/schema-checks", async (importOriginal) => {
  const original =
    // eslint-disable-next-line @typescript-eslint/consistent-type-imports
    (await importOriginal()) as typeof import("#/cli/commands/tailordb/migrate/schema-checks");
  return { ...original, verifyRemoteSchema: vi.fn() };
});

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

  test("reports the operation ID and that the clone continues when the wait times out", async () => {
    const client = {
      getCloneApplicationDataOperation: vi
        .fn()
        .mockResolvedValue({ status: CloneOperationStatus.PROCESSING, errorMessage: "" }),
    } as unknown as OperatorClient;

    const error = await waitForCloneApplicationData(client, {
      sourceWorkspaceId: "source",
      targetWorkspaceId: "target",
      operationId: "operation-1",
      pollInterval: 0,
      timeout: 5,
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: "MIGRATION_TEST_CLONE_TIMEOUT",
      context: {
        operationId: "operation-1",
        sourceWorkspaceId: "source",
        targetWorkspaceId: "target",
      },
    });
    expect((error as Error).message).toMatch(/continues on the platform/);
    expect((error as { suggestion?: string }).suggestion).toMatch(/--clone-timeout/);
  });

  function runtimeState(client: OperatorClient, services: unknown[] = []) {
    return {
      client,
      loaded: {
        config: { path: "/project/tailor.config.ts" },
        application: { tailorDBServices: services, authService: { config: { name: "auth-ns" } } },
      },
    } as unknown as Parameters<typeof assertSourceBaselineFresh>[0];
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
    const client = {
      getMetadata: vi
        .fn()
        .mockResolvedValue({ metadata: { labels: { "sdk-migration": "m0001" } } }),
    } as unknown as OperatorClient;
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
      assertSourceBaselineFresh(runtimeState({} as OperatorClient), prepared, "source"),
    ).rejects.toThrow('Source namespace "main" changed after migration test preparation');
  });

  test("rejects a source whose migration checkpoint moved after preparation", async () => {
    vi.mocked(getNamespacesWithMigrations).mockReturnValue([
      { namespace: "main", migrationsDir: "/project/migrations/main" },
    ]);
    vi.mocked(verifyRemoteSchema).mockResolvedValue([
      { namespace: "main", remoteMigrationNumber: 2, drifts: [], hasDrift: false },
    ]);
    const client = {
      getMetadata: vi
        .fn()
        .mockResolvedValue({ metadata: { labels: { "sdk-migration": "m0002" } } }),
    } as unknown as OperatorClient;
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
    const client = {
      getMetadata: vi.fn().mockResolvedValue({
        metadata: { labels: { "sdk-migration": "m0001", "sdk-migration-in-progress": "m0002" } },
      }),
    } as unknown as OperatorClient;
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
    const client = {
      listTailorDBTypes: vi.fn().mockResolvedValue({ tailordbTypes: [], nextPageToken: "" }),
      listTailorDBGQLPermissions: vi.fn().mockResolvedValue({ permissions: [], nextPageToken: "" }),
    } as unknown as OperatorClient;
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

  function unlabeledBaselineCase(metadata: unknown, remoteTypes: unknown[] = []) {
    vi.mocked(getNamespacesWithMigrations).mockReturnValue([
      {
        namespace: "main",
        migrationsDir: migrationsDirWithInitialSchema(emptySnapshot("main")),
      },
    ]);
    vi.mocked(verifyRemoteSchema).mockResolvedValue([
      { namespace: "main", remoteMigrationNumber: 0, drifts: [], hasDrift: false },
    ]);
    const client = Object.assign(remoteClient(remoteTypes), {
      getMetadata: vi.fn().mockResolvedValue({ metadata }),
    });
    const prepared = preparedMigrationTest({
      baselines: new Map([
        ["main", { migrationNumber: 0, snapshot: emptySnapshot("main"), historyId: null }],
      ]),
    });
    return assertSourceBaselineFresh(runtimeState(client), prepared, "source");
  }

  test("accepts a source baseline numbered 0 while the unlabeled namespace still matches 0000", async () => {
    await expect(unlabeledBaselineCase({ labels: {} })).resolves.toBeUndefined();
  });

  test("rejects a numbered 0 baseline whose unlabeled source schema changed after preparation", async () => {
    await expect(
      unlabeledBaselineCase({ labels: {} }, [{ name: "AuditLog", schema: { fields: {} } }]),
    ).rejects.toMatchObject({
      code: "MIGRATION_TEST_SOURCE_INVALID",
      message: expect.not.stringContaining("AuditLog"),
      details: expect.stringContaining("AuditLog"),
    });
  });

  test("rejects a numbered 0 baseline whose source metadata disappeared after preparation", async () => {
    await expect(unlabeledBaselineCase(undefined)).rejects.toMatchObject({
      code: "MIGRATION_TEST_SOURCE_CHECKPOINT_MISSING",
    });
  });

  function unlabeledState(overrides: Partial<RemoteMigrationState> = {}): RemoteMigrationState {
    return {
      metadataExists: true,
      number: null,
      historyId: null,
      historyIdInvalid: false,
      inProgress: null,
      inProgressInvalid: false,
      ...overrides,
    };
  }

  function remoteClient(types: unknown[] = []) {
    return {
      listTailorDBTypes: vi.fn().mockResolvedValue({ tailordbTypes: types, nextPageToken: "" }),
      listTailorDBGQLPermissions: vi.fn().mockResolvedValue({ permissions: [], nextPageToken: "" }),
    } as unknown as OperatorClient;
  }

  function migrationsDirWithInitialSchema(snapshot: ReturnType<typeof emptySnapshot>) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "migration-test-unlabeled-"));
    temporaryDirectories.push(dir);
    fs.mkdirSync(path.join(dir, "0000"));
    fs.writeFileSync(path.join(dir, "0000", "schema.json"), JSON.stringify(snapshot));
    return dir;
  }

  test("treats an unlabeled source as 0 when 0000 holds field defaults that the remote does not carry", async () => {
    const initial = normalizeSchemaSnapshot({
      version: 1,
      namespace: "main",
      createdAt: "2026-08-05T00:00:00.000Z",
      tables: {
        Item: {
          name: "Item",
          pluralForm: "Items",
          fields: { name: { type: "string", required: true, default: "unnamed" } },
        },
      },
    });
    const migrationsDir = migrationsDirWithInitialSchema(initial);
    const scriptHash = computeSourceScriptHash(initial.tables.Item!.fields);
    const remoteItem = {
      name: "Item",
      schema: {
        typeHook: { create: { expr: `_value // @sdk-source-hash:${scriptHash}` } },
        fields: {
          name: {
            type: "string",
            required: true,
            array: false,
            index: false,
            unique: false,
            foreignKey: false,
            description: "",
            allowedValues: [],
            validate: [],
            fields: {},
          },
        },
      },
    };

    await expect(
      resolveSourceMigrationNumber(
        remoteClient([remoteItem]),
        "source",
        { namespace: "main", migrationsDir },
        unlabeledState(),
        {} as LoadedConfig,
        [],
      ),
    ).resolves.toBe(0);
  });

  test("queries the configured namespace even when the 0000 snapshot records another one", async () => {
    const migrationsDir = migrationsDirWithInitialSchema(emptySnapshot("copied-from-elsewhere"));
    const client = remoteClient();

    await expect(
      resolveSourceMigrationNumber(
        client,
        "source",
        { namespace: "main", migrationsDir },
        unlabeledState(),
        {} as LoadedConfig,
        [],
      ),
    ).resolves.toBe(0);
    expect(client.listTailorDBTypes).toHaveBeenCalledWith(
      expect.objectContaining({ namespaceName: "main" }),
    );
  });

  test("returns the labeled migration number as is", async () => {
    await expect(
      resolveSourceMigrationNumber(
        remoteClient(),
        "source",
        { namespace: "main", migrationsDir: "/unused" },
        unlabeledState({ number: 3 }),
        {} as LoadedConfig,
        [],
      ),
    ).resolves.toBe(3);
  });

  test("treats an unlabeled source that matches the 0000 snapshot as migration 0", async () => {
    const migrationsDir = migrationsDirWithInitialSchema(emptySnapshot("main"));

    await expect(
      resolveSourceMigrationNumber(
        remoteClient(),
        "source",
        { namespace: "main", migrationsDir },
        unlabeledState(),
        {} as LoadedConfig,
        [],
      ),
    ).resolves.toBe(0);
  });

  test("rejects an unlabeled source whose schema differs from the 0000 snapshot", async () => {
    const migrationsDir = migrationsDirWithInitialSchema(
      normalizeSchemaSnapshot({
        version: 1,
        namespace: "main",
        createdAt: "2026-08-05T00:00:00.000Z",
        tables: { AuditLog: { name: "AuditLog", pluralForm: "auditLogs", fields: {} } },
      }),
    );

    await expect(
      resolveSourceMigrationNumber(
        remoteClient(),
        "source",
        { namespace: "main", migrationsDir },
        unlabeledState(),
        {} as LoadedConfig,
        [],
      ),
    ).rejects.toThrow("differs from the initial migration snapshot");
  });

  test("rejects a source namespace that was never deployed", async () => {
    await expect(
      resolveSourceMigrationNumber(
        remoteClient(),
        "source",
        { namespace: "main", migrationsDir: "/unused" },
        unlabeledState({ metadataExists: false }),
        {} as LoadedConfig,
        [],
      ),
    ).rejects.toMatchObject({
      code: "MIGRATION_TEST_SOURCE_CHECKPOINT_MISSING",
      message: expect.stringContaining("has not been deployed"),
    });
  });

  test("deletes a retained target's existing user profile config", async () => {
    const client = {
      getUserProfileConfig: vi.fn().mockResolvedValue({ userProfileConfig: {} }),
      deleteUserProfileConfig: vi.fn().mockResolvedValue({}),
    } as unknown as OperatorClient;

    await deleteExistingUserProfileConfig(runtimeState(client), "target");

    expect(client.deleteUserProfileConfig).toHaveBeenCalledWith({
      workspaceId: "target",
      namespaceName: "auth-ns",
    });
  });

  test("skips user profile config deletion when the target has none", async () => {
    const client = {
      getUserProfileConfig: vi.fn().mockRejectedValue(new ConnectError("not found", Code.NotFound)),
      deleteUserProfileConfig: vi.fn(),
    } as unknown as OperatorClient;

    await deleteExistingUserProfileConfig(runtimeState(client), "target");

    expect(client.deleteUserProfileConfig).not.toHaveBeenCalled();
  });
});
