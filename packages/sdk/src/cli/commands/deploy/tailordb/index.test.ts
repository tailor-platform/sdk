import * as fs from "node:fs";
import * as os from "node:os";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { TailorDBTypeSchema } from "@tailor-platform/tailor-proto/tailordb_resource_pb";
import * as path from "pathe";
import { describe, test, expect, vi, aroundEach } from "vitest";
import {
  applyPreMigrationFieldAdjustments,
  applyPreMigrationIndexAdjustments,
  createPreMigrationSnapshotType,
} from "#/cli/commands/tailordb/migrate/pre-migration-schema";
import {
  formatMigrationNumber,
  normalizeSchemaSnapshot,
  type SnapshotFieldConfig,
  type TailorDBSnapshotType,
} from "#/cli/commands/tailordb/migrate/snapshot";
import { generateTailorDBTypeManifestFromSnapshot } from "#/cli/commands/tailordb/migrate/snapshot-manifest";
import { createMockMigrationDiff } from "#/cli/commands/tailordb/migrate/test-helpers/migration-diff";
import { symbols } from "#/cli/shared/logger";
import { captureStderr } from "#/cli/shared/test-helpers/capture-output";
import { createConcurrencyProbe } from "#/cli/shared/test-helpers/concurrency-probe";
import { sdkNameLabelKey } from "../label";
import {
  applyTailorDB,
  captureMigrationFileState,
  formatTailorDBResourceChangeEntries,
  planTailorDB,
  validateAndDetectMigrations,
} from ".";
import type {
  FieldDiffChange,
  IndexDiffChange,
  TableScriptsModifiedChange,
} from "#/cli/commands/tailordb/migrate/diff-calculator";
import type { Application } from "#/cli/services/application";
import type { ExecutorService } from "#/cli/services/executor/service";
import type { TailorDBService } from "#/cli/services/tailordb/service";
import type { OperatorClient } from "#/cli/shared/client";
import type { LoadedConfig } from "#/cli/shared/config-loader";
import type { TailorDBType } from "#/parser/service/tailordb/types";
import type { PlanContext } from "../types";
import type { MessageInitShape } from "@bufbuild/protobuf";
import type {
  TailorDBType_FieldConfigSchema,
  TailorDBType_IndexSchema,
} from "@tailor-platform/tailor-proto/tailordb_resource_pb";

// Mock label.ts
vi.mock("../label", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const original = (await importOriginal()) as typeof import("../label");
  return {
    ...original,
    buildMetaRequest: vi.fn().mockImplementation(async () => ({
      trn: "trn:v1:workspace:test-workspace:tailordb:test",
      labels: {
        "sdk-name": "test-app",
        "sdk-version": "v1-0-0",
      },
    })),
  };
});

// Mock createChangeSet to suppress output in tests
vi.mock("../change-set", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const original = (await importOriginal()) as typeof import("../change-set");
  return {
    ...original,
    createChangeSet: (title: string) => ({
      ...original.createChangeSet(title),
      lines: () => [],
    }),
  };
});

// Mock config values for tests
const mockConfig = { path: "/test/tailor.config.ts" } as LoadedConfig;

describe("planTailorDB (service level)", () => {
  const workspaceId = "test-workspace";
  const appName = "test-app";

  function createMockTailorDBService(namespace: string): TailorDBService {
    return {
      namespace,
      config: {},
      types: {},
      typeSourceInfo: {},
      loadTypes: vi.fn().mockResolvedValue({}),
    } as unknown as TailorDBService;
  }

  function createMockExecutorService(): ExecutorService {
    return {
      config: {},
      executors: {},
      loadExecutors: vi.fn().mockResolvedValue({}),
    } as unknown as ExecutorService;
  }

  function createMockClient(
    existingServices: Array<{
      name: string;
      label?: string;
      sdkVersion?: string;
    }>,
  ): OperatorClient {
    return {
      listTailorDBServices: vi.fn().mockResolvedValue({
        tailordbServices: existingServices.map((s) => ({
          namespace: { name: s.name },
        })),
        nextPageToken: "",
      }),
      listTailorDBTypes: vi.fn().mockResolvedValue({
        tailordbTypes: [],
        nextPageToken: "",
      }),
      listTailorDBGQLPermissions: vi.fn().mockResolvedValue({
        permissions: [],
        nextPageToken: "",
      }),
      getMetadata: vi.fn().mockImplementation(({ trn }: { trn: string }) => {
        const name = trn.split(":").pop();
        const service = existingServices.find((s) => s.name === name);
        return {
          metadata: {
            labels: service?.label
              ? {
                  [sdkNameLabelKey]: service.label,
                  "sdk-version": service.sdkVersion ?? "v1-0-0",
                }
              : {},
          },
        };
      }),
    } as unknown as OperatorClient;
  }

  function createMockApplication(tailorDBServices: TailorDBService[]): Application {
    return {
      name: appName,
      env: {},
      tailorDBServices,
      executorService: createMockExecutorService(),
    } as unknown as Application;
  }

  function createRemoteTypeClient(
    namespace: string,
    remoteType: {
      name: string;
      description: string;
      pluralForm: string;
      fields: Record<string, unknown>;
    },
  ): OperatorClient {
    return {
      listTailorDBServices: vi.fn().mockResolvedValue({
        tailordbServices: [{ namespace: { name: namespace } }],
        nextPageToken: "",
      }),
      listTailorDBTypes: vi.fn().mockResolvedValue({
        tailordbTypes: [
          {
            name: remoteType.name,
            schema: {
              description: remoteType.description,
              fields: remoteType.fields,
              relationships: {},
              settings: {
                aggregation: false,
                bulkUpsert: false,
                draft: false,
                defaultQueryLimitSize: "100",
                maxBulkUpsertSize: "1000",
                pluralForm: remoteType.pluralForm,
                publishRecordEvents: false,
                disableGqlOperations: {
                  create: false,
                  update: false,
                  delete: false,
                  read: false,
                },
              },
              extends: false,
              directives: [],
              indexes: {},
              files: {},
              permission: { create: [], read: [], update: [], delete: [] },
            },
          },
        ],
        nextPageToken: "",
      }),
      getMetadata: vi.fn().mockResolvedValue({
        metadata: { labels: { [sdkNameLabelKey]: appName, "sdk-version": "v1-0-0" } },
      }),
      listTailorDBGQLPermissions: vi.fn().mockResolvedValue({
        permissions: [],
        nextPageToken: "",
      }),
    } as unknown as OperatorClient;
  }

  aroundEach(async (runTest) => {
    vi.clearAllMocks();
    await runTest();
  });

  test("plans a migration-test baseline snapshot instead of current tables", async () => {
    const tailordb = createMockTailorDBService("tailordb");
    Object.defineProperty(tailordb, "types", {
      value: {
        Current: {
          name: "Current",
          pluralForm: "Currents",
          fields: {},
          forwardRelationships: {},
          backwardRelationships: {},
          settings: {},
          permissions: {},
          files: {},
        },
      },
    });
    const baseline = normalizeSchemaSnapshot({
      version: 1,
      namespace: "tailordb",
      createdAt: "2026-08-05T00:00:00.000Z",
      tables: {
        Legacy: {
          name: "Legacy",
          pluralForm: "Legacies",
          fields: {},
        },
      },
    });
    const client = createMockClient([]);
    Object.assign(client, {
      createTailorDBService: vi.fn().mockResolvedValue({}),
      createTailorDBType: vi.fn().mockResolvedValue({}),
      setMetadata: vi.fn().mockResolvedValue({}),
    });
    const application = { ...createMockApplication([tailordb]), executorService: undefined };

    const result = await planTailorDB({
      client,
      workspaceId,
      application,
      forRemoval: false,
      config: mockConfig,
      migrationTestBaselines: new Map([
        ["tailordb", { migrationNumber: 3, snapshot: baseline, historyId: null }],
      ]),
      executorUsedTailorDBTables: new Set(),
    });

    expect(Object.keys(result.context.tailorDBInputs[0]!.types)).toEqual(["Legacy"]);
    expect(result.changeSet.type.creates[0]!.name).toBe("Legacy");
    expect(result.context.executorUsedTables).toEqual(new Set());

    await applyTailorDB(client, result, "create-update");

    expect(client.setMetadata).not.toHaveBeenCalledWith(
      expect.objectContaining({ labels: expect.objectContaining({ "sdk-migration": "m0003" }) }),
    );
  });

  test("plans a migration-test target snapshot instead of drifted current tables", async () => {
    const tailordb = createMockTailorDBService("tailordb");
    Object.defineProperty(tailordb, "types", {
      value: {
        Uncommitted: {
          name: "Uncommitted",
          pluralForm: "Uncommitted",
          fields: {},
          forwardRelationships: {},
          backwardRelationships: {},
          settings: {},
          permissions: {},
          files: {},
        },
      },
    });
    const target = normalizeSchemaSnapshot({
      version: 1,
      namespace: "tailordb",
      createdAt: "2026-08-05T00:00:00.000Z",
      tables: {
        Committed: {
          name: "Committed",
          pluralForm: "Committed",
          fields: {},
        },
      },
    });

    const result = await planTailorDB({
      client: createMockClient([]),
      workspaceId,
      application: createMockApplication([tailordb]),
      forRemoval: false,
      config: mockConfig,
      migrationTestSnapshots: new Map([["tailordb", target]]),
    });

    expect(Object.keys(result.context.tailorDBInputs[0]!.types)).toEqual(["Committed"]);
    expect(result.changeSet.type.creates[0]!.name).toBe("Committed");
    expect(result.context.migrationTestBaselines).toBeUndefined();
  });

  describe("rename scenarios (service level)", () => {
    test("old service is deleted when renamed", async () => {
      const client = createMockClient([{ name: "old-tailordb", label: appName }]);
      const application = createMockApplication([createMockTailorDBService("new-tailordb")]);

      const ctx: PlanContext = {
        client,
        workspaceId,
        application,
        forRemoval: false,
        config: mockConfig,
      };

      const result = await planTailorDB(ctx);

      expect(result.changeSet.service.creates).toHaveLength(1);
      expect(result.changeSet.service.creates[0]!.name).toBe("new-tailordb");
      expect(result.changeSet.service.deletes).toHaveLength(1);
      expect(result.changeSet.service.deletes[0]!.name).toBe("old-tailordb");
    });
  });

  describe("delete scenarios (service level)", () => {
    test("service is deleted when removed from config", async () => {
      const client = createMockClient([
        { name: "tailordb-a", label: appName },
        { name: "tailordb-b", label: appName },
      ]);
      const application = createMockApplication([createMockTailorDBService("tailordb-a")]);

      const ctx: PlanContext = {
        client,
        workspaceId,
        application,
        forRemoval: false,
        config: mockConfig,
      };

      const result = await planTailorDB(ctx);

      expect(result.changeSet.service.unchanged).toHaveLength(1);
      expect(result.changeSet.service.unchanged[0]!.name).toBe("tailordb-a");
      expect(result.changeSet.service.deletes).toHaveLength(1);
      expect(result.changeSet.service.deletes[0]!.name).toBe("tailordb-b");
    });

    test("all services are deleted when config is empty", async () => {
      const client = createMockClient([
        { name: "tailordb-1", label: appName },
        { name: "tailordb-2", label: appName },
      ]);
      const application = createMockApplication([]);

      const ctx: PlanContext = {
        client,
        workspaceId,
        application,
        forRemoval: false,
        config: mockConfig,
      };

      const result = await planTailorDB(ctx);

      expect(result.changeSet.service.deletes).toHaveLength(2);
      expect(result.changeSet.service.deletes.map((d) => d.name).toSorted()).toEqual([
        "tailordb-1",
        "tailordb-2",
      ]);
    });
  });

  describe("label ownership scenarios (service level)", () => {
    test("service without label is NOT deleted", async () => {
      const client = createMockClient([{ name: "unmanaged-tailordb" }]);
      const application = createMockApplication([]);

      const ctx: PlanContext = {
        client,
        workspaceId,
        application,
        forRemoval: false,
        config: mockConfig,
      };

      const result = await planTailorDB(ctx);

      expect(result.changeSet.service.deletes).toHaveLength(0);
    });

    test("service owned by different app is NOT deleted", async () => {
      const client = createMockClient([{ name: "other-tailordb", label: "other-app" }]);
      const application = createMockApplication([]);

      const ctx: PlanContext = {
        client,
        workspaceId,
        application,
        forRemoval: false,
        config: mockConfig,
      };

      const result = await planTailorDB(ctx);

      expect(result.changeSet.service.deletes).toHaveLength(0);
      expect(result.resourceOwners.has("other-app")).toBe(true);
    });

    test("mixed ownership - only delete own services", async () => {
      const client = createMockClient([
        { name: "my-tailordb", label: appName },
        { name: "other-tailordb", label: "other-app" },
        { name: "unmanaged-tailordb" },
      ]);
      const application = createMockApplication([]);

      const ctx: PlanContext = {
        client,
        workspaceId,
        application,
        forRemoval: false,
        config: mockConfig,
      };

      const result = await planTailorDB(ctx);

      expect(result.changeSet.service.deletes).toHaveLength(1);
      expect(result.changeSet.service.deletes[0]!.name).toBe("my-tailordb");
      expect(result.resourceOwners.has("other-app")).toBe(true);
    });
  });

  describe("nested field manifest mapping", () => {
    test("enables publishRecordEvents when a peer executor targets the table", async () => {
      const tailorDBService = createMockTailorDBService("shared-db");
      const userType: TailorDBType = {
        name: "User",
        pluralForm: "Users",
        description: "User table",
        fields: {
          name: {
            name: "name",
            config: {
              type: "string",
            },
          },
        },
        forwardRelationships: {},
        backwardRelationships: {},
        settings: {},
        permissions: {},
        files: {},
      };

      Object.defineProperty(tailorDBService, "types", {
        value: { [userType.name]: userType },
      });

      const client = createMockClient([]);
      const application = createMockApplication([tailorDBService]);
      const ctx: PlanContext = {
        client,
        workspaceId,
        application,
        forRemoval: false,
        config: mockConfig,
        executorUsedTailorDBTables: new Set(["User"]),
      };

      const result = await planTailorDB(ctx);

      const createdType = result.changeSet.type.creates[0]!.request.tailordbType;
      expect(createdType?.schema?.settings?.publishRecordEvents).toBe(true);
    });

    test.each([
      { disabled: true, expected: false, label: "a disabled executor does not subscribe" },
      { disabled: false, expected: true, label: "an enabled executor subscribes" },
    ])("$label", async ({ disabled, expected }) => {
      const tailorDBService = createMockTailorDBService("shared-db");
      const userType: TailorDBType = {
        name: "User",
        pluralForm: "Users",
        description: "User table",
        fields: { name: { name: "name", config: { type: "string" } } },
        forwardRelationships: {},
        backwardRelationships: {},
        settings: {},
        permissions: {},
        files: {},
      };
      Object.defineProperty(tailorDBService, "types", {
        value: { [userType.name]: userType },
      });

      const application = createMockApplication([tailorDBService]);
      Object.defineProperty(application, "executorService", {
        value: {
          config: {},
          executors: {},
          loadExecutors: vi.fn().mockResolvedValue({
            "/onUser.ts": {
              name: "on-user",
              disabled,
              trigger: { kind: "tailordb", tableName: "User" },
            },
          }),
        },
      });

      const result = await planTailorDB({
        client: createMockClient([]),
        workspaceId,
        application,
        forRemoval: false,
        config: mockConfig,
      });

      const createdType = result.changeSet.type.creates[0]!.request.tailordbType;
      expect(createdType?.schema?.settings?.publishRecordEvents).toBe(expected);
    });

    describe("publishEvents", () => {
      function createTypeWith(publishEvents: boolean | undefined): TailorDBType {
        return {
          name: "User",
          pluralForm: "Users",
          description: "User table",
          fields: { name: { name: "name", config: { type: "string" } } },
          forwardRelationships: {},
          backwardRelationships: {},
          settings: publishEvents === undefined ? {} : { publishEvents },
          permissions: {},
          files: {},
        };
      }

      function createClientWithRemoteType(publishRecordEvents: boolean): OperatorClient {
        const client = createMockClient([{ name: "shared-db", label: appName }]);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (client as any).listTailorDBTypes = vi.fn().mockResolvedValue({
          tailordbTypes: [{ name: "User", schema: { settings: { publishRecordEvents } } }],
          nextPageToken: "",
        });
        return client;
      }

      async function planWith(params: {
        publishEvents: boolean | undefined;
        subscribed: boolean;
        remote?: boolean;
      }) {
        const { publishEvents, subscribed, remote } = params;
        const tailorDBService = createMockTailorDBService("shared-db");
        const userType = createTypeWith(publishEvents);
        Object.defineProperty(tailorDBService, "types", {
          value: { [userType.name]: userType },
        });
        return await planTailorDB({
          client: remote === undefined ? createMockClient([]) : createClientWithRemoteType(remote),
          workspaceId,
          application: createMockApplication([tailorDBService]),
          forRemoval: false,
          config: mockConfig,
          executorUsedTailorDBTables: subscribed ? new Set(["User"]) : new Set<string>(),
        });
      }

      function desiredPublishRecordEvents(
        result: Awaited<ReturnType<typeof planTailorDB>>,
      ): boolean | undefined {
        const entry = result.changeSet.type.creates[0] ?? result.changeSet.type.updates[0];
        expect(entry).toBeDefined();
        return entry!.request.tailordbType?.schema?.settings?.publishRecordEvents;
      }

      test.each([
        { publishEvents: undefined, subscribed: true, expected: true },
        { publishEvents: undefined, subscribed: false, expected: false },
        { publishEvents: true, subscribed: false, expected: true },
        { publishEvents: true, subscribed: true, expected: true },
        { publishEvents: false, subscribed: false, expected: false },
      ])(
        "resolves publishEvents=$publishEvents subscribed=$subscribed to $expected",
        async ({ publishEvents, subscribed, expected }) => {
          const result = await planWith({ publishEvents, subscribed });

          expect(desiredPublishRecordEvents(result)).toBe(expected);
        },
      );

      test("throws when an opt-out is combined with a subscribing executor", async () => {
        await expect(planWith({ publishEvents: false, subscribed: true })).rejects.toThrow(
          'TailorDB table "User" has "publishEvents: false", but executors with record triggers subscribe to it.',
        );
      });

      test("rejects a conflicting opt-out before listing remote tables", async () => {
        const client = createMockClient([{ name: "shared-db", label: appName }]);
        const tailorDBService = createMockTailorDBService("shared-db");
        const userType = createTypeWith(false);
        Object.defineProperty(tailorDBService, "types", {
          value: { [userType.name]: userType },
        });

        await expect(
          planTailorDB({
            client,
            workspaceId,
            application: createMockApplication([tailorDBService]),
            forRemoval: false,
            config: mockConfig,
            executorUsedTailorDBTables: new Set(["User"]),
          }),
        ).rejects.toThrow('TailorDB table "User" has "publishEvents: false"');

        expect(client.listTailorDBTypes).not.toHaveBeenCalled();
      });

      test("turns a remote opt-in back off once nothing subscribes", async () => {
        const result = await planWith({
          publishEvents: undefined,
          subscribed: false,
          remote: true,
        });

        expect(desiredPublishRecordEvents(result)).toBe(false);
      });

      test("keeps a remote opt-in while an executor still subscribes", async () => {
        const result = await planWith({ publishEvents: undefined, subscribed: true, remote: true });

        expect(desiredPublishRecordEvents(result)).toBe(true);
      });
    });

    test("includes validate and hooks for nested fields", async () => {
      const client = createMockClient([]);
      const tailorDBService = createMockTailorDBService("test-tailordb");

      const testType: TailorDBType = {
        name: "User",
        pluralForm: "users",
        description: "User table",
        fields: {
          profile: {
            name: "profile",
            config: {
              type: "nested",
              required: true,
              fields: {
                displayName: {
                  type: "string",
                  required: true,
                  validate: [
                    {
                      script: { expr: "((_value ?? '').length > 0)" },
                      errorMessage: "Display name is required",
                    },
                  ],
                  hooks: {
                    create: { expr: "(_value ?? '').trim()" },
                    update: { expr: "(_value ?? '').trim()" },
                  },
                },
                contact: {
                  type: "nested",
                  required: true,
                  fields: {
                    email: {
                      type: "string",
                      required: true,
                      validate: [
                        {
                          script: { expr: "((_value ?? '').includes('@'))" },
                          errorMessage: "Email must contain @",
                        },
                      ],
                      hooks: {
                        create: { expr: "(_value ?? '').toLowerCase()" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        forwardRelationships: {},
        backwardRelationships: {},
        settings: {},
        permissions: {},
        files: {},
      };

      Object.defineProperty(tailorDBService, "types", {
        value: { [testType.name]: testType },
      });

      const application = createMockApplication([tailorDBService]);
      const ctx: PlanContext = {
        client,
        workspaceId,
        application,
        forRemoval: false,
        config: mockConfig,
      };

      const result = await planTailorDB(ctx);

      expect(result.changeSet.type.creates).toHaveLength(1);
      const createdType = result.changeSet.type.creates[0]!.request.tailordbType;
      const profileField = createdType?.schema?.fields?.profile;
      const displayNameField = profileField?.fields?.displayName;
      const contactEmailField = profileField?.fields?.contact!.fields?.email;

      expect(displayNameField?.optionalOnCreate).toBe(true);
      expect(displayNameField?.hooks).toBeUndefined();
      expect(displayNameField?.validate ?? []).toHaveLength(0);
      expect(contactEmailField?.optionalOnCreate).toBe(true);
      expect(contactEmailField?.hooks).toBeUndefined();
      expect(contactEmailField?.validate ?? []).toHaveLength(0);

      const hookExpr = createdType?.schema?.typeHook?.create?.expr ?? "";
      expect(hookExpr).toContain('"profile": Object.assign({}, _input["profile"], {');
      expect(hookExpr).toContain("(_value ?? '').trim()");
      expect(hookExpr).toContain("(_value ?? '').toLowerCase()");

      const validateExpr = createdType?.schema?.typeValidate?.create?.expr ?? "";
      expect(validateExpr).toContain('__errs["profile.displayName"]');
      expect(validateExpr).toContain('__errs["profile.contact.email"]');
      expect(validateExpr).toContain('if (typeof __r === "string")');
    });
  });

  describe("type diff normalization", () => {
    test("treats known platform defaults and scalar field placeholders as unchanged", async () => {
      const tailordbType: TailorDBType = {
        name: "Invoice",
        pluralForm: "Invoices",
        description: "Invoice table",
        fields: {
          code: {
            name: "code",
            config: {
              type: "string",
              required: true,
            },
          },
          serialNumber: {
            name: "serialNumber",
            config: {
              type: "integer",
              required: true,
              serial: {
                start: 1,
                maxValue: 999,
              },
            },
          },
        },
        forwardRelationships: {},
        backwardRelationships: {},
        settings: {},
        permissions: {},
        files: {},
      };

      const tailorDBService = createMockTailorDBService("test-tailordb");
      Object.defineProperty(tailorDBService, "types", {
        value: { [tailordbType.name]: tailordbType },
      });

      const client = createRemoteTypeClient("test-tailordb", {
        name: "Invoice",
        description: "Invoice table",
        pluralForm: "invoices",
        fields: {
          code: {
            type: "string",
            required: true,
            allowedValues: [],
            description: "",
            validate: [],
            array: false,
            index: false,
            unique: false,
            foreignKey: false,
            vector: false,
            fields: {},
          },
          serialNumber: {
            type: "integer",
            required: true,
            allowedValues: [],
            description: "",
            validate: [],
            array: false,
            index: false,
            unique: false,
            foreignKey: false,
            vector: false,
            fields: {},
            serial: { start: "1", maxValue: "999" },
          },
        },
      });

      const application = createMockApplication([tailorDBService]);
      const ctx: PlanContext = {
        client,
        workspaceId,
        application,
        forRemoval: false,
        config: mockConfig,
        noSchemaCheck: true,
      };

      const result = await planTailorDB(ctx);

      expect(result.changeSet.type.unchanged.map((entry) => entry.name)).toEqual(["Invoice"]);
      expect(result.changeSet.type.updates).toHaveLength(0);
    });

    test("treats permission policy order differences as unchanged", async () => {
      // Committed migration snapshots can carry the same permission policies in
      // a different array order than the current config parse; the platform
      // evaluates policies order-insensitively, so this must not read as drift.
      const rolePolicy = {
        conditions: [[{ user: "role" }, "eq", "MANAGER"]],
        permit: "allow",
      } as const;
      const loggedInPolicy = {
        conditions: [[{ user: "_loggedIn" }, "eq", true]],
        permit: "allow",
      } as const;
      const makeType = (
        read: readonly (typeof rolePolicy | typeof loggedInPolicy)[],
        fields: Record<string, unknown>,
      ) =>
        ({
          name: "Invoice",
          pluralForm: "Invoices",
          description: "Invoice table",
          fields,
          forwardRelationships: {},
          backwardRelationships: {},
          settings: {},
          permissions: { record: { create: [], read, update: [], delete: [] } },
          files: {},
        }) as unknown as TailorDBType;

      const localType = makeType([rolePolicy, loggedInPolicy], {
        code: { name: "code", config: { type: "string", required: true } },
      });
      // The remote side is the manifest the SDK itself would have applied from a
      // migration snapshot (snapshot-shaped fields), with the policies reversed.
      const remoteManifest = generateTailorDBTypeManifestFromSnapshot(
        makeType([loggedInPolicy, rolePolicy], {
          code: { type: "string", required: true },
        }) as unknown as Parameters<typeof generateTailorDBTypeManifestFromSnapshot>[0],
      );

      const tailorDBService = createMockTailorDBService("test-tailordb");
      Object.defineProperty(tailorDBService, "types", {
        value: { [localType.name]: localType },
      });

      const client = createRemoteTypeClient("test-tailordb", {
        name: "Invoice",
        description: "Invoice table",
        pluralForm: "invoices",
        fields: {},
      });
      (client.listTailorDBTypes as ReturnType<typeof vi.fn>).mockResolvedValue({
        tailordbTypes: [{ name: "Invoice", schema: remoteManifest.schema }],
        nextPageToken: "",
      });

      const application = createMockApplication([tailorDBService]);
      const ctx: PlanContext = {
        client,
        workspaceId,
        application,
        forRemoval: false,
        config: mockConfig,
        noSchemaCheck: true,
      };

      const result = await planTailorDB(ctx);

      expect(result.changeSet.type.unchanged.map((entry) => entry.name)).toEqual(["Invoice"]);
      expect(result.changeSet.type.updates).toHaveLength(0);
    });

    test("updates matching type when forceApplyAll is enabled", async () => {
      const tailordbType: TailorDBType = {
        name: "Invoice",
        pluralForm: "Invoices",
        description: "Invoice table",
        fields: {
          code: {
            name: "code",
            config: {
              type: "string",
              required: true,
            },
          },
        },
        forwardRelationships: {},
        backwardRelationships: {},
        settings: {},
        permissions: {},
        files: {},
      };

      const tailorDBService = createMockTailorDBService("test-tailordb");
      Object.defineProperty(tailorDBService, "types", {
        value: { [tailordbType.name]: tailordbType },
      });

      const client = createRemoteTypeClient("test-tailordb", {
        name: "Invoice",
        description: "Invoice table",
        pluralForm: "invoices",
        fields: {
          code: {
            type: "string",
            required: true,
            allowedValues: [],
            description: "",
            validate: [],
            array: false,
            index: false,
            unique: false,
            foreignKey: false,
            vector: false,
            fields: {},
          },
        },
      });

      const application = createMockApplication([tailorDBService]);
      const ctx: PlanContext = {
        client,
        workspaceId,
        application,
        forRemoval: false,
        config: mockConfig,
        noSchemaCheck: true,
        forceApplyAll: true,
      };

      const result = await planTailorDB(ctx);

      expect(result.changeSet.type.updates).toHaveLength(1);
      expect(result.changeSet.type.unchanged).toHaveLength(0);
    });

    test("treats a redeploy of the exact type previously sent as unchanged when the platform echoes it as a proto message", async () => {
      // Simulates the real client path: the platform stores what the SDK sent
      // and returns it as a protobuf-es message, which materializes implicit
      // proto3 fields (e.g. a newly added bool like `optionalOnCreate`) with
      // their zero values even though the local manifest never sets them.
      const tailordbType: TailorDBType = {
        name: "Invoice",
        pluralForm: "Invoices",
        description: "Invoice table",
        fields: {
          code: {
            name: "code",
            config: {
              type: "string",
              required: true,
            },
          },
        },
        forwardRelationships: {},
        backwardRelationships: {},
        settings: {},
        permissions: {},
        files: {},
      };

      const makeCtx = (remoteTypes: unknown[]): PlanContext => {
        const tailorDBService = createMockTailorDBService("test-tailordb");
        Object.defineProperty(tailorDBService, "types", {
          value: { [tailordbType.name]: tailordbType },
        });
        const client = {
          listTailorDBServices: vi.fn().mockResolvedValue({
            tailordbServices: [{ namespace: { name: "test-tailordb" } }],
            nextPageToken: "",
          }),
          listTailorDBTypes: vi.fn().mockResolvedValue({
            tailordbTypes: remoteTypes,
            nextPageToken: "",
          }),
          getMetadata: vi.fn().mockResolvedValue({
            metadata: { labels: { [sdkNameLabelKey]: appName, "sdk-version": "v1-0-0" } },
          }),
          listTailorDBGQLPermissions: vi.fn().mockResolvedValue({
            permissions: [],
            nextPageToken: "",
          }),
        } as unknown as OperatorClient;
        return {
          client,
          workspaceId,
          application: createMockApplication([tailorDBService]),
          forRemoval: false,
          config: mockConfig,
          noSchemaCheck: true,
        };
      };

      // First plan against an empty workspace captures the exact manifest the
      // SDK deploys; the second plan sees it echoed back as a proto message.
      const firstPlan = await planTailorDB(makeCtx([]));
      const deployedManifest = firstPlan.changeSet.type.creates[0]!.request.tailordbType!;
      const remoteMessage = create(TailorDBTypeSchema, deployedManifest);

      const result = await planTailorDB(makeCtx([remoteMessage]));

      expect(result.changeSet.type.updates).toHaveLength(0);
      expect(result.changeSet.type.unchanged.map((entry) => entry.name)).toEqual(["Invoice"]);
    });

    test("treats an omitted remote field description as unchanged against the local empty-string manifest", async () => {
      const tailordbType: TailorDBType = {
        name: "Event",
        pluralForm: "Events",
        description: "Event table",
        fields: {
          name: {
            name: "name",
            config: {
              type: "string",
              required: false,
            },
          },
        },
        forwardRelationships: {},
        backwardRelationships: {},
        settings: {},
        permissions: {},
        files: {},
      };

      const tailorDBService = createMockTailorDBService("test-tailordb");
      Object.defineProperty(tailorDBService, "types", {
        value: { [tailordbType.name]: tailordbType },
      });

      // Platform omits `description` for fields without one, while the local
      // manifest always emits `description: ""` (generateTailorDBTypeManifest).
      // These must compare as equal.
      const client = createRemoteTypeClient("test-tailordb", {
        name: "Event",
        description: "Event table",
        pluralForm: "events",
        fields: {
          name: {
            type: "string",
            required: false,
            allowedValues: [],
            validate: [],
            array: false,
            index: false,
            unique: false,
            foreignKey: false,
            vector: false,
            fields: {},
          },
        },
      });

      const application = createMockApplication([tailorDBService]);
      const ctx: PlanContext = {
        client,
        workspaceId,
        application,
        forRemoval: false,
        config: mockConfig,
        noSchemaCheck: true,
      };

      const result = await planTailorDB(ctx);

      expect(result.changeSet.type.unchanged.map((entry) => entry.name)).toEqual(["Event"]);
      expect(result.changeSet.type.updates).toHaveLength(0);
    });
  });

  describe("migration validation", () => {
    let migrationsDir: string;

    aroundEach(async (runTest) => {
      migrationsDir = fs.mkdtempSync(path.join(os.tmpdir(), "plan-migrations-"));
      fs.mkdirSync(path.join(migrationsDir, "0000"));
      fs.writeFileSync(
        path.join(migrationsDir, "0000", "schema.json"),
        JSON.stringify({
          version: 1,
          namespace: "test-tailordb",
          createdAt: new Date().toISOString(),
          types: {},
        }),
      );
      try {
        await runTest();
      } finally {
        fs.rmSync(migrationsDir, { recursive: true, force: true });
      }
    });

    test("fails at plan time when a breaking migration is missing its script", async () => {
      fs.mkdirSync(path.join(migrationsDir, "0001"));
      fs.writeFileSync(
        path.join(migrationsDir, "0001", "diff.json"),
        JSON.stringify({
          version: 1,
          namespace: "test-tailordb",
          createdAt: new Date().toISOString(),
          changes: [],
          hasBreakingChanges: true,
          breakingChanges: [{ tableName: "User", fieldName: "email", reason: "Unique" }],
          hasWarnings: false,
          warnings: [],
          requiresMigrationScript: true,
        }),
      );

      const client = {
        getMetadata: vi.fn().mockResolvedValue({ metadata: { labels: {} } }),
      } as unknown as OperatorClient;
      const config = {
        path: path.join(migrationsDir, "tailor.config.ts"),
        name: appName,
        db: { "test-tailordb": { migration: { directory: "." } } },
      } as unknown as LoadedConfig;
      const ctx: PlanContext = {
        client,
        workspaceId,
        application: createMockApplication([createMockTailorDBService("test-tailordb")]),
        forRemoval: false,
        config,
        noSchemaCheck: true,
      };

      await expect(planTailorDB(ctx)).rejects.toThrow(/requires a migration script/);
    });
  });
});

describe("formatTailorDBResourceChangeEntries", () => {
  test.each([
    {
      name: "groups table and gqlPermission changes for the same table name",
      typeChanges: { creates: [{ name: "Project" }], updates: [], deletes: [], replaces: [] },
      gqlPermissionChanges: {
        creates: [{ name: "Project" }],
        updates: [],
        deletes: [],
        replaces: [],
      },
      expected: [
        {
          action: "create",
          symbol: symbols.create,
          name: "Project",
          labels: ["table", "gqlPermission"],
        },
      ],
    },
    {
      name: "shows separate entries when table and gqlPermission have different actions for the same name",
      typeChanges: { creates: [{ name: "Project" }], updates: [], deletes: [], replaces: [] },
      gqlPermissionChanges: {
        creates: [],
        updates: [{ name: "Project" }],
        deletes: [],
        replaces: [],
      },
      expected: [
        { action: "create", symbol: symbols.create, name: "Project", labels: ["table"] },
        { action: "update", symbol: symbols.update, name: "Project", labels: ["gqlPermission"] },
      ],
    },
    {
      name: "keeps standalone gqlPermission changes visible",
      typeChanges: { creates: [], updates: [], deletes: [], replaces: [] },
      gqlPermissionChanges: {
        creates: [{ name: "Project" }],
        updates: [],
        deletes: [],
        replaces: [],
      },
      expected: [
        { action: "create", symbol: symbols.create, name: "Project", labels: ["gqlPermission"] },
      ],
    },
  ])("$name", ({ typeChanges, gqlPermissionChanges, expected }) => {
    const entries = formatTailorDBResourceChangeEntries(typeChanges, gqlPermissionChanges);

    expect(entries).toEqual(expected);
  });
});

describe("applyTailorDB phase separation", () => {
  // Helper to create mock client with spies for delete operations
  function createMockClientWithSpies() {
    return {
      deleteTailorDBGQLPermission: vi.fn().mockResolvedValue({}),
      deleteTailorDBType: vi.fn().mockResolvedValue({}),
      deleteTailorDBService: vi.fn().mockResolvedValue({}),
      // Also mock create/update methods for completeness
      createTailorDBService: vi.fn().mockResolvedValue({}),
      createTailorDBType: vi.fn().mockResolvedValue({}),
      createTailorDBGQLPermission: vi.fn().mockResolvedValue({}),
      updateTailorDBType: vi.fn().mockResolvedValue({}),
      setMetadata: vi.fn().mockResolvedValue({}),
    } as unknown as OperatorClient;
  }

  // Helper to create a mock plan result with deletes
  function createMockPlanResult() {
    // Create mock TailorDB service for context
    const mockTailorDBService = {
      namespace: "test-tailordb",
      loadTypes: vi.fn().mockResolvedValue({}),
      types: {},
    } as unknown as TailorDBService;

    return {
      changeSet: {
        service: {
          creates: [],
          updates: [],
          deletes: [
            {
              name: "test-tailordb",
              request: {
                workspaceId: "test-workspace",
                namespaceName: "test-tailordb",
              },
            },
          ],
          unchanged: [],
          title: "TailorDB Services",
          isEmpty: () => false,
          lines: () => [],
        },
        type: {
          creates: [],
          updates: [],
          deletes: [
            {
              name: "TestType",
              request: {
                workspaceId: "test-workspace",
                namespaceName: "test-tailordb",
                tableName: "TestType",
              },
            },
          ],
          unchanged: [],
          title: "TailorDB tables",
          isEmpty: () => false,
          lines: () => [],
        },
        gqlPermission: {
          creates: [],
          updates: [],
          deletes: [
            {
              name: "TestPermission",
              request: {
                workspaceId: "test-workspace",
                namespaceName: "test-tailordb",
                permissionName: "TestPermission",
              },
            },
          ],
          unchanged: [],
          title: "TailorDB GQL Permissions",
          isEmpty: () => false,
          lines: () => [],
        },
      },
      conflicts: [],
      unmanaged: [],
      resourceOwners: new Set<string>(),
      context: {
        workspaceId: "test-workspace",
        application: {
          name: "test-app",
          tailorDBServices: [mockTailorDBService],
        } as unknown as Application,
        tailorDBInputs: [],
        config: mockConfig,
        noSchemaCheck: true, // Skip migration checks in unit tests
        namespacesWithMigrations: [],
        migrationFileState: {},
        checkpointRepairs: [],
      },
    } as unknown as Awaited<ReturnType<typeof planTailorDB>>;
  }

  aroundEach(async (runTest) => {
    vi.clearAllMocks();
    await runTest();
  });

  test.each([
    {
      phase: "delete-resources" as const,
      gqlPermissionCalls: 1,
      typeCalls: 1,
      serviceCalls: 0,
    },
    {
      phase: "delete-services" as const,
      gqlPermissionCalls: 0,
      typeCalls: 0,
      serviceCalls: 1,
    },
    {
      phase: "create-update" as const,
      gqlPermissionCalls: 1,
      typeCalls: 1,
      serviceCalls: 0,
    },
  ])(
    "$phase phase deletes the expected resource kinds",
    async ({ phase, gqlPermissionCalls, typeCalls, serviceCalls }) => {
      const client = createMockClientWithSpies();
      const planResult = createMockPlanResult();

      await applyTailorDB(client, planResult, phase);

      expect(client.deleteTailorDBGQLPermission).toHaveBeenCalledTimes(gqlPermissionCalls);
      expect(client.deleteTailorDBType).toHaveBeenCalledTimes(typeCalls);
      expect(client.deleteTailorDBService).toHaveBeenCalledTimes(serviceCalls);
    },
  );
});

describe("applyPreMigrationFieldAdjustments", () => {
  type ProtoField = MessageInitShape<typeof TailorDBType_FieldConfigSchema>;

  test("keeps the previous field type until the migration script completes", () => {
    const fields: Record<string, ProtoField> = {
      age: { type: "float", required: true, unique: true },
    };
    const typeChanges = new Map<string, FieldDiffChange>([
      [
        "age",
        {
          kind: "field_type_modified",
          tableName: "User",
          fieldName: "age",
          before: { type: "integer", required: false, unique: false },
          after: { type: "float", required: true, unique: true },
        },
      ],
    ]);

    applyPreMigrationFieldAdjustments(fields, typeChanges);

    expect(fields.age!.type).toBe("integer");
    expect(fields.age!.required).toBe(false);
    expect(fields.age!.unique).toBe(false);
  });

  test("keeps removed nested members readable until the migration script completes", () => {
    const fields: Record<string, ProtoField> = {
      address: {
        type: "nested",
        required: false,
        fields: {
          zipCode: { type: "string", required: false },
          geo: {
            type: "nested",
            required: false,
            fields: { lat: { type: "float", required: true } },
          },
        },
      },
    };
    const before: SnapshotFieldConfig = {
      type: "nested",
      required: false,
      fields: {
        zip: { type: "string", required: true, description: "Postal code", index: true },
        geo: {
          type: "nested",
          required: false,
          fields: {
            lat: { type: "float", required: true },
            lng: { type: "float", required: true },
          },
        },
      },
    };
    const after: SnapshotFieldConfig = {
      type: "nested",
      required: false,
      fields: {
        zipCode: { type: "string", required: false },
        geo: {
          type: "nested",
          required: false,
          fields: { lat: { type: "float", required: true } },
        },
      },
    };
    const typeChanges = new Map<string, FieldDiffChange>([
      [
        "address",
        { kind: "field_modified", tableName: "User", fieldName: "address", before, after },
      ],
    ]);

    applyPreMigrationFieldAdjustments(fields, typeChanges);

    const address = fields.address!;
    expect(Object.keys(address.fields ?? {})).toEqual(["zipCode", "geo", "zip"]);
    expect(address.fields!.zip).toMatchObject({
      type: "string",
      required: true,
      description: "Postal code",
      index: false,
    });
    expect(Object.keys(address.fields!.geo!.fields ?? {})).toEqual(["lat", "lng"]);
    expect(address.fields!.geo!.fields!.lng).toMatchObject({ type: "float", required: true });
  });

  test("does not restore members whose parent is no longer nested", () => {
    const fields: Record<string, ProtoField> = {
      address: {
        type: "nested",
        required: false,
        fields: { geo: { type: "string", required: false } },
      },
    };
    const typeChanges = new Map<string, FieldDiffChange>([
      [
        "address",
        {
          kind: "field_modified",
          tableName: "User",
          fieldName: "address",
          before: {
            type: "nested",
            required: false,
            fields: {
              geo: {
                type: "nested",
                required: false,
                fields: { lat: { type: "float", required: false } },
              },
            },
          },
          after: {
            type: "nested",
            required: false,
            fields: { geo: { type: "string", required: false } },
          },
        },
      ],
    ]);

    applyPreMigrationFieldAdjustments(fields, typeChanges);

    expect(fields.address!.fields!.geo).toEqual({ type: "string", required: false });
  });

  test("keeps previous field and type hooks before manifest scripts are aggregated", () => {
    const previousAge: SnapshotFieldConfig = {
      type: "integer",
      required: false,
      hooks: { update: { expr: "return 1" } },
    };
    const targetType: TailorDBSnapshotType = {
      name: "User",
      pluralForm: "Users",
      fields: {
        age: {
          type: "float",
          required: false,
          hooks: { update: { expr: "return 2" } },
        },
      },
      typeHookExpr: { update: "return { age: 'target-only' }" },
      typeValidateExpr: "return value.age === 'target-only'",
    };
    const typeChanges = new Map<string, FieldDiffChange>([
      [
        "age",
        {
          kind: "field_type_modified",
          tableName: "User",
          fieldName: "age",
          before: previousAge,
          after: targetType.fields.age!,
        },
      ],
    ]);
    const typeScriptsChange: TableScriptsModifiedChange = {
      kind: "table_scripts_modified",
      tableName: "User",
      before: {
        typeHookExpr: { update: "return { age: 1 }" },
        typeValidateExpr: "return Number.isInteger(value.age)",
      },
      after: {
        typeHookExpr: targetType.typeHookExpr,
        typeValidateExpr: targetType.typeValidateExpr,
      },
    };

    const preType = createPreMigrationSnapshotType(targetType, typeChanges, typeScriptsChange);

    expect(preType.fields.age).toEqual(previousAge);
    expect(preType.typeHookExpr).toEqual(typeScriptsChange.before.typeHookExpr);
    expect(preType.typeValidateExpr).toBe(typeScriptsChange.before.typeValidateExpr);
    expect(targetType.fields.age!.type).toBe("float");
  });

  test("re-inserts removed field so migrate.ts can still read it", () => {
    // Simulate the new schema produced by planTailorDB: the removed field
    // has already been stripped from `fields`.
    const fields: Record<string, ProtoField> = {
      name: { type: "string", required: true },
    };

    const removedFieldBefore: SnapshotFieldConfig = {
      type: "uuid",
      required: true,
      foreignKey: true,
      foreignKeyType: "OldParent",
    };
    const typeChanges = new Map<string, FieldDiffChange>([
      [
        "oldParentId",
        {
          kind: "field_removed",
          tableName: "Child",
          fieldName: "oldParentId",
          before: removedFieldBefore,
        },
      ],
    ]);

    applyPreMigrationFieldAdjustments(fields, typeChanges);

    expect(fields.oldParentId).toBeDefined();
    expect(fields.oldParentId!.type).toBe("uuid");
    expect(fields.oldParentId!.foreignKey).toBe(true);
    expect(fields.oldParentId!.foreignKeyType).toBe("OldParent");
    expect(fields.oldParentId!.required).toBe(true);
    // Untouched fields are preserved.
    expect(fields.name!.type).toBe("string");
  });

  test("re-inserts a removed field named __proto__ as an own property", () => {
    const fields: Record<string, ProtoField> = {};
    const typeChanges = new Map<string, FieldDiffChange>([
      [
        "__proto__",
        {
          kind: "field_removed",
          tableName: "User",
          fieldName: "__proto__",
          before: { type: "string", required: false },
        },
      ],
    ]);

    applyPreMigrationFieldAdjustments(fields, typeChanges);

    expect(Object.hasOwn(fields, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(fields)).toBe(Object.prototype);
    expect(fields["__proto__"]?.type).toBe("string");
  });

  test("relaxes newly-added required field to optional", () => {
    const fields: Record<string, ProtoField> = {
      newField: { type: "string", required: true },
    };
    const typeChanges = new Map<string, FieldDiffChange>([
      [
        "newField",
        {
          kind: "field_added",
          tableName: "T",
          fieldName: "newField",
          after: { type: "string", required: true },
        },
      ],
    ]);

    applyPreMigrationFieldAdjustments(fields, typeChanges);

    expect(fields.newField!.required).toBe(false);
  });

  test("does not modify fields that are not in typeChanges", () => {
    const fields: Record<string, ProtoField> = {
      keep: { type: "string", required: true },
    };
    const typeChanges = new Map<string, FieldDiffChange>();

    applyPreMigrationFieldAdjustments(fields, typeChanges);

    expect(fields.keep!.required).toBe(true);
  });

  test("expands a rename into keep-old-field plus relaxed new field", () => {
    // Post-state schema: the old field is already gone, the new field is present.
    const fields: Record<string, ProtoField> = {
      displayName: { type: "string", required: true, unique: true },
    };
    const typeChanges = new Map<string, FieldDiffChange>([
      [
        "displayName",
        {
          kind: "field_renamed",
          tableName: "User",
          fieldName: "displayName",
          previousFieldName: "fullName",
          before: { type: "string", required: false },
          after: { type: "string", required: true, unique: true },
        },
      ],
    ]);

    applyPreMigrationFieldAdjustments(fields, typeChanges);

    expect(fields.fullName).toBeDefined();
    expect(fields.fullName!.type).toBe("string");
    expect(fields.fullName!.required).toBe(false);
    expect(fields.displayName!.required).toBe(false);
    expect(fields.displayName!.unique).toBe(false);
  });

  test("keeps a renamed field whose previous name was __proto__", () => {
    const fields: Record<string, ProtoField> = {
      displayName: { type: "string", required: true },
    };
    const typeChanges = new Map<string, FieldDiffChange>([
      [
        "displayName",
        {
          kind: "field_renamed",
          tableName: "User",
          fieldName: "displayName",
          previousFieldName: "__proto__",
          before: { type: "string", required: false },
          after: { type: "string", required: true },
        },
      ],
    ]);

    applyPreMigrationFieldAdjustments(fields, typeChanges);

    expect(Object.hasOwn(fields, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(fields)).toBe(Object.prototype);
    expect(fields["__proto__"]?.type).toBe("string");
  });

  test("relaxes a rename target's unique constraint even when the old field was unique", () => {
    // Stored values of a previously removed field named `code` may still hold
    // duplicates, so unique is deferred until the copy overwrites them.
    const fields: Record<string, ProtoField> = {
      code: { type: "string", required: true, unique: true },
    };
    const typeChanges = new Map<string, FieldDiffChange>([
      [
        "code",
        {
          kind: "field_renamed",
          tableName: "Item",
          fieldName: "code",
          previousFieldName: "sku",
          before: { type: "string", required: true, unique: true },
          after: { type: "string", required: true, unique: true },
        },
      ],
    ]);

    applyPreMigrationFieldAdjustments(fields, typeChanges);

    expect(fields.sku).toBeDefined();
    expect(fields.code!.required).toBe(false);
    expect(fields.code!.unique).toBe(false);
  });
});

describe("applyPreMigrationIndexAdjustments", () => {
  type ProtoIndex = MessageInitShape<typeof TailorDBType_IndexSchema>;

  test("removes a newly-added unique index until the post-phase", () => {
    const indexes: Record<string, ProtoIndex> = {
      name_org: { fieldNames: ["name", "org"], unique: true },
      existing: { fieldNames: ["name"], unique: false },
    };
    const indexChanges = new Map<string, IndexDiffChange>([
      [
        "name_org",
        {
          kind: "index_added",
          tableName: "User",
          indexName: "name_org",
          after: { fields: ["name", "org"], unique: true },
        },
      ],
    ]);

    applyPreMigrationIndexAdjustments(indexes, indexChanges);

    expect(indexes.name_org).toBeUndefined();
    expect(indexes.existing).toBeDefined();
  });

  test("keeps the previous definition for an index gaining unique", () => {
    const indexes: Record<string, ProtoIndex> = {
      name_idx: { fieldNames: ["name"], unique: true },
    };
    const indexChanges = new Map<string, IndexDiffChange>([
      [
        "name_idx",
        {
          kind: "index_modified",
          tableName: "User",
          indexName: "name_idx",
          before: { fields: ["name"], unique: false },
          after: { fields: ["name"], unique: true },
        },
      ],
    ]);

    applyPreMigrationIndexAdjustments(indexes, indexChanges);

    expect(indexes.name_idx).toEqual({ fieldNames: ["name"], unique: false });
  });

  test("keeps the previous definition for a unique index changing fields", () => {
    const indexes: Record<string, ProtoIndex> = {
      name_idx: { fieldNames: ["name", "org"], unique: true },
    };
    const indexChanges = new Map<string, IndexDiffChange>([
      [
        "name_idx",
        {
          kind: "index_modified",
          tableName: "User",
          indexName: "name_idx",
          before: { fields: ["name"], unique: true },
          after: { fields: ["name", "org"], unique: true },
        },
      ],
    ]);

    applyPreMigrationIndexAdjustments(indexes, indexChanges);

    expect(indexes.name_idx).toEqual({ fieldNames: ["name"], unique: true });
  });

  test("does not modify indexes that are not in indexChanges", () => {
    const indexes: Record<string, ProtoIndex> = {
      keep: { fieldNames: ["name"], unique: true },
    };

    applyPreMigrationIndexAdjustments(indexes, new Map<string, IndexDiffChange>());

    expect(indexes.keep).toEqual({ fieldNames: ["name"], unique: true });
  });
});

describe("applyTailorDB migration label reconciliation", () => {
  let tmpDir: string;
  let configPath: string;

  aroundEach(async (runTest) => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "applyTailorDB-migration-"));
    configPath = path.join(tmpDir, "tailor.config.ts");
    // Working tree latest migration = 0 (only baseline schema.json under 0000/)
    const baselineDir = path.join(tmpDir, "0000");
    fs.mkdirSync(baselineDir, { recursive: true });
    fs.writeFileSync(
      path.join(baselineDir, "schema.json"),
      JSON.stringify({
        version: 1,
        namespace: "test-tailordb",
        createdAt: new Date().toISOString(),
        types: {},
      }),
    );
    await runTest();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  function makePlanResult(noSchemaCheck = false): Awaited<ReturnType<typeof planTailorDB>> {
    const mockTailorDBService = {
      namespace: "test-tailordb",
      loadTypes: vi.fn().mockResolvedValue({}),
      types: {},
    } as unknown as TailorDBService;

    const config = {
      path: configPath,
      name: "test-app",
      db: {
        "test-tailordb": {
          files: [],
          migration: { directory: "." },
        },
      },
    } as unknown as LoadedConfig;

    return {
      changeSet: {
        service: {
          creates: [],
          updates: [],
          deletes: [],
          unchanged: [],
          title: "TailorDB Services",
          isEmpty: () => true,
          lines: () => [],
        },
        type: {
          creates: [],
          updates: [],
          deletes: [],
          unchanged: [],
          title: "TailorDB tables",
          isEmpty: () => true,
          lines: () => [],
        },
        gqlPermission: {
          creates: [],
          updates: [],
          deletes: [],
          unchanged: [],
          title: "TailorDB GQL Permissions",
          isEmpty: () => true,
          lines: () => [],
        },
      },
      conflicts: [],
      unmanaged: [],
      resourceOwners: new Set<string>(),
      context: {
        workspaceId: "test-workspace",
        application: {
          name: "test-app",
          tailorDBServices: [mockTailorDBService],
        } as unknown as Application,
        tailorDBInputs: [],
        config,
        noSchemaCheck,
        namespacesWithMigrations: [{ namespace: "test-tailordb", migrationsDir: tmpDir }],
        migrationFileState: captureMigrationFileState([
          { namespace: "test-tailordb", migrationsDir: tmpDir },
        ]),
        checkpointRepairs: [],
      },
    } as unknown as Awaited<ReturnType<typeof planTailorDB>>;
  }

  function runValidation(
    client: OperatorClient,
    planResult: Awaited<ReturnType<typeof planTailorDB>>,
  ) {
    const typesByNamespace = new Map<string, Record<string, TailorDBSnapshotType>>();
    for (const input of planResult.context.tailorDBInputs) {
      typesByNamespace.set(input.namespace, input.types);
    }
    return validateAndDetectMigrations(
      client,
      planResult.context.workspaceId,
      typesByNamespace,
      planResult.context.config,
      planResult.context.noSchemaCheck,
      planResult.context.tailorDBInputs,
    );
  }

  function createMigrationClient(
    remoteLabels: Record<string, string>,
    { includeListTailorDBTypes = false }: { includeListTailorDBTypes?: boolean } = {},
  ) {
    const getMetadata = vi.fn().mockResolvedValue({ metadata: { labels: remoteLabels } });
    const setMetadata = vi.fn().mockResolvedValue({});
    const client = {
      getMetadata,
      setMetadata,
      createTailorDBService: vi.fn().mockResolvedValue({}),
      createTailorDBType: vi.fn().mockResolvedValue({}),
      updateTailorDBType: vi.fn().mockResolvedValue({}),
      createTailorDBGQLPermission: vi.fn().mockResolvedValue({}),
      updateTailorDBGQLPermission: vi.fn().mockResolvedValue({}),
      deleteTailorDBGQLPermission: vi.fn().mockResolvedValue({}),
      deleteTailorDBType: vi.fn().mockResolvedValue({}),
      ...(includeListTailorDBTypes
        ? { listTailorDBTypes: vi.fn().mockResolvedValue({ tailordbTypes: [], nextPageToken: "" }) }
        : {}),
    } as unknown as OperatorClient;
    return { client, getMetadata, setMetadata };
  }

  function addSentinelTypeCreate(planResult: Awaited<ReturnType<typeof planTailorDB>>): void {
    planResult.changeSet.type.creates.push({
      name: "Sentinel",
      request: { namespaceName: "test-tailordb" },
      metaRequest: { trn: "trn:v1:workspace:test-workspace:tailordb:test-tailordb:type:Sentinel" },
    });
  }

  test("tracks migration state for a prototype-like namespace", async () => {
    const config = {
      path: configPath,
      name: "test-app",
      db: Object.fromEntries([["__proto__", { files: [], migration: { directory: "." } }]]),
    } as unknown as LoadedConfig;
    const { client } = createMigrationClient({ "sdk-migration": "m0000" });

    const result = await validateAndDetectMigrations(
      client,
      "test-workspace",
      new Map(),
      config,
      true,
      [],
    );

    expect(Object.hasOwn(result.migrationFileState, "__proto__")).toBe(true);
    expect(Object.hasOwn(result.migrationHistoryIds, "__proto__")).toBe(true);
  });

  test("forces migration label to working_tree_max when label is ahead of working tree (--no-schema-check)", async () => {
    // Remote label is m0002 but the working tree only has migration 0000.
    // Without reconciliation, the next deploy would reconstruct a snapshot at
    // m0002 (which does not exist) and trigger a false drift error.
    const { client, setMetadata } = createMigrationClient({ "sdk-migration": "m0002" });

    await applyTailorDB(client, makePlanResult(true), "create-update");

    expect(setMetadata).toHaveBeenCalledTimes(1);
    expect(setMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        labels: expect.objectContaining({ "sdk-migration": "m0000" }),
      }),
    );
  });

  test("forces migration label even when remote has no prior label (--no-schema-check)", async () => {
    const { client, setMetadata } = createMigrationClient({});

    await applyTailorDB(client, makePlanResult(true), "create-update");

    expect(setMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        labels: expect.objectContaining({ "sdk-migration": "m0000" }),
      }),
    );
  });

  test("reconciles the migration label after a transient metadata read failure", async () => {
    const { client, getMetadata, setMetadata } = createMigrationClient({
      "sdk-migration": "m0002",
    });
    getMetadata
      .mockResolvedValueOnce({ metadata: { labels: { "sdk-migration": "m0002" } } })
      .mockRejectedValueOnce(new ConnectError("transient metadata read failure", Code.Internal));
    using stderr = captureStderr();

    await applyTailorDB(client, makePlanResult(true), "create-update");

    expect(setMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        labels: expect.objectContaining({ "sdk-migration": "m0000" }),
      }),
    );
    expect(stderr.output).toContain(
      "Migration label for namespace test-tailordb reconciled to 0000.",
    );
    expect(stderr.output).not.toContain("<unset> → 0000");
  });

  test("revalidates migration file integrity immediately before apply", async () => {
    for (const migrationNumber of [1, 2]) {
      const migrationDir = path.join(tmpDir, formatMigrationNumber(migrationNumber));
      fs.mkdirSync(migrationDir, { recursive: true });
      fs.writeFileSync(
        path.join(migrationDir, "diff.json"),
        JSON.stringify(createMockMigrationDiff({ namespace: "test-tailordb" }), null, 2),
      );
    }
    const planResult = makePlanResult(true);
    addSentinelTypeCreate(planResult);
    fs.rmSync(path.join(tmpDir, "0001", "diff.json"));
    planResult.context.migrationFileState = captureMigrationFileState(
      planResult.context.namespacesWithMigrations,
    );
    const { client } = createMigrationClient({ "sdk-migration": "m0002" });

    await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
      /Migration 0001 is missing \(gap in sequence\)/,
    );
    expect(client.createTailorDBService).not.toHaveBeenCalled();
    expect(client.createTailorDBType).not.toHaveBeenCalled();
  });

  test("parses the baseline before remote mutations with --no-schema-check", async () => {
    const planResult = makePlanResult(true);
    addSentinelTypeCreate(planResult);
    fs.writeFileSync(path.join(tmpDir, "0000", "schema.json"), "{not-json");
    planResult.context.migrationFileState = captureMigrationFileState(
      planResult.context.namespacesWithMigrations,
    );
    const { client, setMetadata } = createMigrationClient({ "sdk-migration": "m0000" });

    await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
      /schema\.json/,
    );
    expect(client.createTailorDBService).not.toHaveBeenCalled();
    expect(client.createTailorDBType).not.toHaveBeenCalled();
    expect(setMetadata).not.toHaveBeenCalled();
  });

  test("parses applied migrations before remote mutations with --no-schema-check", async () => {
    const migrationDir = path.join(tmpDir, "0001");
    fs.mkdirSync(migrationDir, { recursive: true });
    fs.writeFileSync(
      path.join(migrationDir, "diff.json"),
      JSON.stringify({
        ...createMockMigrationDiff({ namespace: "test-tailordb" }),
        version: 6,
      }),
    );
    const planResult = makePlanResult(true);
    addSentinelTypeCreate(planResult);
    const { client, setMetadata } = createMigrationClient({ "sdk-migration": "m0001" });

    await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
      /supports migration file format versions 1-5/,
    );
    expect(client.createTailorDBService).not.toHaveBeenCalled();
    expect(client.createTailorDBType).not.toHaveBeenCalled();
    expect(setMetadata).not.toHaveBeenCalled();
  });

  test.each([
    [
      "last migration",
      (baseDir: string) => fs.rmSync(path.join(baseDir, "0002"), { recursive: true }),
    ],
    ["all migrations", (baseDir: string) => fs.rmSync(baseDir, { recursive: true })],
  ])(
    "rejects when %s disappears after planning with --no-schema-check",
    async (_description, removeMigrations) => {
      for (const migrationNumber of [1, 2]) {
        const migrationDir = path.join(tmpDir, formatMigrationNumber(migrationNumber));
        fs.mkdirSync(migrationDir, { recursive: true });
        fs.writeFileSync(
          path.join(migrationDir, "diff.json"),
          JSON.stringify(createMockMigrationDiff({ namespace: "test-tailordb" }), null, 2),
        );
      }
      const planResult = makePlanResult(true);
      planResult.context.migrationFileState = captureMigrationFileState(
        planResult.context.namespacesWithMigrations,
      );
      addSentinelTypeCreate(planResult);
      removeMigrations(tmpDir);
      const { client } = createMigrationClient({ "sdk-migration": "m0002" });

      await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
        /Migration files changed after deployment planning/,
      );
      expect(client.createTailorDBService).not.toHaveBeenCalled();
      expect(client.createTailorDBType).not.toHaveBeenCalled();
    },
  );

  function userSnapshotType(): TailorDBSnapshotType {
    return {
      name: "User",
      pluralForm: "Users",
      fields: {
        id: { type: "uuid", required: true },
      },
    };
  }

  function writeUserSchemaSnapshot(
    userType: TailorDBSnapshotType,
    rebaseline?: {
      historyId: string;
      replacedHistoryId: string | null;
      replacedLatestMigration: number;
    },
  ): void {
    fs.writeFileSync(
      path.join(tmpDir, "0000", "schema.json"),
      JSON.stringify({
        version: 1,
        namespace: "test-tailordb",
        createdAt: new Date().toISOString(),
        types: { User: userType },
        ...(rebaseline ? { rebaseline } : {}),
      }),
    );
  }

  function schemaVerificationClient(remoteSettings: unknown): OperatorClient {
    const getMetadata = vi.fn().mockResolvedValue({
      metadata: { labels: { "sdk-migration": "m0000" } },
    });
    return {
      getMetadata,
      setMetadata: vi.fn().mockResolvedValue({}),
      listTailorDBTypes: vi.fn().mockResolvedValue({
        tailordbTypes: [
          {
            name: "User",
            schema: {
              fields: {
                id: {
                  type: "uuid",
                  required: true,
                  allowedValues: [],
                  validate: [],
                  fields: {},
                },
              },
              settings: remoteSettings,
              relationships: {},
              indexes: {},
              files: {},
            },
          },
        ],
        nextPageToken: "",
      }),
      listTailorDBGQLPermissions: vi.fn().mockResolvedValue({
        permissions: [],
        nextPageToken: "",
      }),
      createTailorDBService: vi.fn().mockResolvedValue({}),
      createTailorDBType: vi.fn().mockResolvedValue({}),
      updateTailorDBType: vi.fn().mockResolvedValue({}),
      createTailorDBGQLPermission: vi.fn().mockResolvedValue({}),
      updateTailorDBGQLPermission: vi.fn().mockResolvedValue({}),
      deleteTailorDBGQLPermission: vi.fn().mockResolvedValue({}),
      deleteTailorDBType: vi.fn().mockResolvedValue({}),
    } as unknown as OperatorClient;
  }

  function planWithDeployDerivedSettings(
    userType: TailorDBSnapshotType,
  ): Awaited<ReturnType<typeof planTailorDB>> {
    const planResult = makePlanResult();
    planResult.context.tailorDBInputs = [
      {
        namespace: "test-tailordb",
        config: { files: [], gqlOperations: { create: false } },
        types: { User: userType },
      },
    ];
    planResult.context.executorUsedTables = new Set(["User"]);
    return planResult;
  }

  function unchangedRemoteSettings(): unknown {
    return {
      pluralForm: "users",
      aggregation: false,
      bulkUpsert: false,
      publishRecordEvents: false,
      disableGqlOperations: {
        create: false,
        update: false,
        delete: false,
        read: false,
      },
    };
  }

  function writeEmptyMigrationsThrough(lastMigration: number): void {
    for (let migrationNumber = 1; migrationNumber <= lastMigration; migrationNumber += 1) {
      const migrationDir = path.join(tmpDir, formatMigrationNumber(migrationNumber));
      fs.mkdirSync(migrationDir, { recursive: true });
      fs.writeFileSync(
        path.join(migrationDir, "diff.json"),
        JSON.stringify(createMockMigrationDiff({ namespace: "test-tailordb" })),
      );
    }
  }

  test("revalidates local migration history immediately before apply", async () => {
    const userType = userSnapshotType();
    const userWithEmail: TailorDBSnapshotType = {
      ...userType,
      fields: {
        ...userType.fields,
        email: { type: "string", required: false },
      },
    };
    writeUserSchemaSnapshot(userType);
    const migrationDir = path.join(tmpDir, "0001");
    fs.mkdirSync(migrationDir, { recursive: true });
    fs.writeFileSync(
      path.join(migrationDir, "diff.json"),
      JSON.stringify(
        createMockMigrationDiff({
          namespace: "test-tailordb",
          changes: [
            {
              kind: "field_added",
              tableName: "User",
              fieldName: "email",
              after: { type: "string", required: false },
            },
          ],
        }),
        null,
        2,
      ),
    );

    const planResult = makePlanResult();
    planResult.context.tailorDBInputs = [
      {
        namespace: "test-tailordb",
        config: { files: [] },
        types: { User: userWithEmail },
      },
    ];
    planResult.context.executorUsedTables = new Set();
    addSentinelTypeCreate(planResult);
    const client = schemaVerificationClient(unchangedRemoteSettings());
    await runValidation(client, planResult);

    fs.rmSync(tmpDir, { recursive: true });
    planResult.context.migrationFileState = captureMigrationFileState(
      planResult.context.namespacesWithMigrations,
    );

    await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
      "Schema migration check failed",
    );
    expect(client.createTailorDBType).not.toHaveBeenCalled();
  });

  test("revalidates remote schema immediately before apply", async () => {
    const userType = userSnapshotType();
    writeUserSchemaSnapshot(userType);
    const planResult = planWithDeployDerivedSettings(userType);
    addSentinelTypeCreate(planResult);
    const client = schemaVerificationClient(unchangedRemoteSettings());
    await runValidation(client, planResult);

    vi.mocked(client.listTailorDBTypes).mockResolvedValue({
      tailordbTypes: [],
      nextPageToken: "",
    } as never);

    await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
      "Remote schema verification failed",
    );
    expect(client.createTailorDBType).not.toHaveBeenCalled();
  });

  test("rejects a type removed at the current checkpoint when cleanup did not finish", async () => {
    const userType = userSnapshotType();
    writeUserSchemaSnapshot(userType);
    const migrationDir = path.join(tmpDir, "0001");
    fs.mkdirSync(migrationDir, { recursive: true });
    fs.writeFileSync(
      path.join(migrationDir, "diff.json"),
      JSON.stringify(
        createMockMigrationDiff({
          namespace: "test-tailordb",
          changes: [{ kind: "table_removed", tableName: "User", before: userType }],
          hasWarnings: true,
          warnings: [{ tableName: "User", reason: "Type removed" }],
        }),
        null,
        2,
      ),
    );
    const planResult = makePlanResult();
    planResult.context.tailorDBInputs = [
      {
        namespace: "test-tailordb",
        config: { files: [] },
        types: {},
      },
    ];
    const client = schemaVerificationClient(unchangedRemoteSettings());
    vi.mocked(client.getMetadata).mockResolvedValue({
      metadata: { labels: { "sdk-migration": "m0001" } },
    } as never);

    await expect(runValidation(client, planResult)).rejects.toThrow(
      "Remote schema verification failed",
    );
  });

  test("rejects a stale removed table before a pending migration re-adds the same name", async () => {
    const userType = userSnapshotType();
    writeUserSchemaSnapshot(userType);
    const removalDir = path.join(tmpDir, "0001");
    fs.mkdirSync(removalDir, { recursive: true });
    fs.writeFileSync(
      path.join(removalDir, "diff.json"),
      JSON.stringify(
        createMockMigrationDiff({
          namespace: "test-tailordb",
          changes: [{ kind: "table_removed", tableName: "User", before: userType }],
          hasWarnings: true,
          warnings: [{ tableName: "User", reason: "Type removed" }],
        }),
        null,
        2,
      ),
    );
    const readditionDir = path.join(tmpDir, "0002");
    fs.mkdirSync(readditionDir, { recursive: true });
    fs.writeFileSync(
      path.join(readditionDir, "diff.json"),
      JSON.stringify(
        createMockMigrationDiff({
          namespace: "test-tailordb",
          changes: [{ kind: "table_added", tableName: "User", after: userType }],
        }),
        null,
        2,
      ),
    );
    const planResult = makePlanResult();
    planResult.context.tailorDBInputs = [
      {
        namespace: "test-tailordb",
        config: { files: [] },
        types: { User: userType },
      },
    ];
    const client = schemaVerificationClient(unchangedRemoteSettings());
    vi.mocked(client.getMetadata).mockResolvedValue({
      metadata: { labels: { "sdk-migration": "m0001" } },
    } as never);

    await expect(runValidation(client, planResult)).rejects.toThrow(
      "Remote schema verification failed",
    );
  });

  test("rejects an unrelated remote-only type without a recorded removal", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "0000", "schema.json"),
      JSON.stringify({
        version: 1,
        namespace: "test-tailordb",
        createdAt: new Date().toISOString(),
        types: {},
      }),
    );
    const planResult = makePlanResult();
    planResult.context.tailorDBInputs = [
      {
        namespace: "test-tailordb",
        config: { files: [] },
        types: {},
      },
    ];
    const client = schemaVerificationClient(unchangedRemoteSettings());

    await expect(runValidation(client, planResult)).rejects.toThrow(
      "Remote schema verification failed",
    );
  });

  test("plans a checkpoint reset when the remote schema matches the local baseline", async () => {
    using stderr = captureStderr();
    const userType = userSnapshotType();
    writeUserSchemaSnapshot(userType, {
      historyId: "hcurrent",
      replacedHistoryId: null,
      replacedLatestMigration: 5,
    });
    writeEmptyMigrationsThrough(5);
    const planResult = planWithDeployDerivedSettings(userType);
    const client = schemaVerificationClient(unchangedRemoteSettings());
    vi.mocked(client.getMetadata).mockResolvedValue({
      metadata: { labels: { "sdk-migration": "m0005" } },
    } as never);

    const result = await runValidation(client, planResult);

    expect(result.checkpointRepairs).toEqual([
      {
        namespace: "test-tailordb",
        from: 5,
        to: 0,
        fromHistoryId: null,
        toHistoryId: "hcurrent",
      },
    ]);
    expect(stderr.output).toContain("will be reset to 0000");
    expect(client.listTailorDBTypes).toHaveBeenCalledOnce();
    expect(client.setMetadata).not.toHaveBeenCalled();
  });

  test("rejects a missing remote checkpoint when the remote schema differs from baseline", async () => {
    using stderr = captureStderr();
    const userType = userSnapshotType();
    writeUserSchemaSnapshot(userType, {
      historyId: "hcurrent",
      replacedHistoryId: null,
      replacedLatestMigration: 5,
    });
    const planResult = planWithDeployDerivedSettings(userType);
    const client = schemaVerificationClient(unchangedRemoteSettings());
    vi.mocked(client.getMetadata).mockResolvedValue({
      metadata: { labels: { "sdk-migration": "m0005" } },
    } as never);
    vi.mocked(client.listTailorDBTypes).mockResolvedValue({
      tailordbTypes: [],
      nextPageToken: "",
    } as never);

    await expect(runValidation(client, planResult)).rejects.toThrow(
      "Remote schema verification failed",
    );
    expect(stderr.output).toContain("Remote schema drift detected");
    expect(client.setMetadata).not.toHaveBeenCalled();
  });

  test("does not repair a markerless history even when the remote schema matches baseline", async () => {
    using stderr = captureStderr();
    const userType = userSnapshotType();
    writeUserSchemaSnapshot(userType);
    const planResult = planWithDeployDerivedSettings(userType);
    const client = schemaVerificationClient(unchangedRemoteSettings());
    vi.mocked(client.getMetadata).mockResolvedValue({
      metadata: { labels: { "sdk-migration": "m0005" } },
    } as never);

    await expect(runValidation(client, planResult)).rejects.toThrow(
      "Remote migration checkpoint verification failed",
    );
    expect(stderr.output).toContain("not in the local migration history");
    expect(client.setMetadata).not.toHaveBeenCalled();
  });

  test("does not repair a checkpoint that already belongs to the current history", async () => {
    using stderr = captureStderr();
    const userType = userSnapshotType();
    writeUserSchemaSnapshot(userType, {
      historyId: "hcurrent",
      replacedHistoryId: null,
      replacedLatestMigration: 5,
    });
    writeEmptyMigrationsThrough(5);
    const planResult = planWithDeployDerivedSettings(userType);
    const client = schemaVerificationClient(unchangedRemoteSettings());
    vi.mocked(client.getMetadata).mockResolvedValue({
      metadata: {
        labels: { "sdk-migration": "m0005", "sdk-migration-history": "hcurrent" },
      },
    } as never);

    const result = await runValidation(client, planResult);

    expect(result.checkpointRepairs).toEqual([]);
    expect(stderr.output).not.toContain("will be reset to 0000");
    expect(client.listTailorDBTypes).toHaveBeenCalledOnce();
    expect(client.setMetadata).not.toHaveBeenCalled();
  });

  test("rejects an invalid remote migration history marker", async () => {
    using stderr = captureStderr();
    const userType = userSnapshotType();
    writeUserSchemaSnapshot(userType, {
      historyId: "hcurrent",
      replacedHistoryId: null,
      replacedLatestMigration: 5,
    });
    const planResult = planWithDeployDerivedSettings(userType);
    const client = schemaVerificationClient(unchangedRemoteSettings());
    vi.mocked(client.getMetadata).mockResolvedValue({
      metadata: {
        labels: { "sdk-migration": "m0000", "sdk-migration-history": "INVALID!" },
      },
    } as never);

    await expect(runValidation(client, planResult)).rejects.toThrow(
      "Remote migration checkpoint verification failed",
    );
    expect(stderr.output).toContain("not in the local migration history");
    expect(client.setMetadata).not.toHaveBeenCalled();
  });

  test("rejects a remote history marker whose checkpoint is missing", async () => {
    using stderr = captureStderr();
    const userType = userSnapshotType();
    writeUserSchemaSnapshot(userType, {
      historyId: "hcurrent",
      replacedHistoryId: null,
      replacedLatestMigration: 5,
    });
    const planResult = planWithDeployDerivedSettings(userType);
    const client = schemaVerificationClient(unchangedRemoteSettings());
    vi.mocked(client.getMetadata).mockResolvedValue({
      metadata: { labels: { "sdk-migration-history": "hprevious" } },
    } as never);

    await expect(runValidation(client, planResult)).rejects.toThrow(
      "Remote migration checkpoint verification failed",
    );
    expect(stderr.output).toContain("not in the local migration history");
    expect(client.setMetadata).not.toHaveBeenCalled();
  });

  test("resets a confirmed checkpoint to baseline before applying post-rebaseline migrations", async () => {
    const userType = userSnapshotType();
    const userWithEmail: TailorDBSnapshotType = {
      ...userType,
      fields: {
        ...userType.fields,
        email: { type: "string", required: false },
      },
    };
    writeUserSchemaSnapshot(userType, {
      historyId: "hcurrent",
      replacedHistoryId: null,
      replacedLatestMigration: 5,
    });
    const migrationDir = path.join(tmpDir, "0001");
    fs.mkdirSync(migrationDir, { recursive: true });
    fs.writeFileSync(
      path.join(migrationDir, "diff.json"),
      JSON.stringify(
        createMockMigrationDiff({
          namespace: "test-tailordb",
          changes: [
            {
              kind: "field_added",
              tableName: "User",
              fieldName: "email",
              after: { type: "string", required: false },
            },
          ],
        }),
      ),
    );
    const planResult = makePlanResult();
    planResult.context.tailorDBInputs = [
      {
        namespace: "test-tailordb",
        config: { files: [] },
        types: { User: userWithEmail },
      },
    ];
    planResult.context.executorUsedTables = new Set();
    planResult.context.checkpointRepairs = [
      {
        namespace: "test-tailordb",
        from: 5,
        to: 0,
        fromHistoryId: null,
        toHistoryId: "hcurrent",
      },
    ];
    planResult.context.migrationFileState = captureMigrationFileState(
      planResult.context.namespacesWithMigrations,
    );
    const client = schemaVerificationClient(unchangedRemoteSettings());
    let remoteLabels: Record<string, string> = { "sdk-migration": "m0005" };
    vi.mocked(client.getMetadata).mockImplementation(
      async () =>
        ({
          metadata: { labels: remoteLabels },
        }) as never,
    );
    vi.mocked(client.setMetadata).mockImplementation(async (request) => {
      remoteLabels = { ...remoteLabels, ...request.labels };
      return {} as never;
    });

    await applyTailorDB(client, planResult, "create-update");

    const writtenCheckpoints = vi
      .mocked(client.setMetadata)
      .mock.calls.map((call) => call[0].labels?.["sdk-migration"]);
    expect(writtenCheckpoints).toEqual(["m0000", "m0001"]);
    expect(vi.mocked(client.setMetadata).mock.calls[0]?.[0].labels).toMatchObject({
      "sdk-migration-history": "hcurrent",
    });
  });

  test("rejects an unconfirmed checkpoint number that appears after planning", async () => {
    const userType = userSnapshotType();
    writeUserSchemaSnapshot(userType, {
      historyId: "hcurrent",
      replacedHistoryId: null,
      replacedLatestMigration: 5,
    });
    const planResult = planWithDeployDerivedSettings(userType);
    planResult.context.checkpointRepairs = [
      {
        namespace: "test-tailordb",
        from: 5,
        to: 0,
        fromHistoryId: null,
        toHistoryId: "hcurrent",
      },
    ];
    const client = schemaVerificationClient(unchangedRemoteSettings());
    vi.mocked(client.getMetadata).mockResolvedValue({
      metadata: { labels: { "sdk-migration": "m0006" } },
    } as never);

    await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
      "Remote migration checkpoint verification failed",
    );
    expect(client.setMetadata).not.toHaveBeenCalled();
  });

  test("rejects when the remote migration history changes after planning", async () => {
    const userType = userSnapshotType();
    writeUserSchemaSnapshot(userType, {
      historyId: "hcurrent",
      replacedHistoryId: null,
      replacedLatestMigration: 5,
    });
    const planResult = planWithDeployDerivedSettings(userType);
    planResult.context.checkpointRepairs = [
      {
        namespace: "test-tailordb",
        from: 5,
        to: 0,
        fromHistoryId: null,
        toHistoryId: "hcurrent",
      },
    ];
    const client = schemaVerificationClient(unchangedRemoteSettings());
    vi.mocked(client.getMetadata).mockResolvedValue({
      metadata: {
        labels: { "sdk-migration": "m0005", "sdk-migration-history": "hother" },
      },
    } as never);

    await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
      "Remote migration checkpoint verification failed",
    );
    expect(client.setMetadata).not.toHaveBeenCalled();
  });

  test("rejects when a confirmed checkpoint repair disappears after planning", async () => {
    const userType = userSnapshotType();
    writeUserSchemaSnapshot(userType, {
      historyId: "hcurrent",
      replacedHistoryId: null,
      replacedLatestMigration: 5,
    });
    const planResult = planWithDeployDerivedSettings(userType);
    planResult.context.checkpointRepairs = [
      {
        namespace: "test-tailordb",
        from: 5,
        to: 0,
        fromHistoryId: null,
        toHistoryId: "hcurrent",
      },
    ];
    const client = schemaVerificationClient(unchangedRemoteSettings());
    vi.mocked(client.getMetadata).mockResolvedValue({
      metadata: {
        labels: { "sdk-migration": "m0000", "sdk-migration-history": "hcurrent" },
      },
    } as never);

    await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
      /repair changed after deployment planning/i,
    );
    expect(client.setMetadata).not.toHaveBeenCalled();
  });

  test("sets the migration label to 0000 on the first apply (no prior label, schema check enabled)", async () => {
    // Fresh project: `migration generate` created 0000/schema.json, the remote
    // namespace has no `sdk-migration` label yet. A single `apply` should
    // establish the baseline by setting the label to 0000 — without requiring
    // the redundant apply/generate/apply dance.
    const { client, setMetadata } = createMigrationClient({}, { includeListTailorDBTypes: true });

    await applyTailorDB(client, makePlanResult(false), "create-update");

    expect(setMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        labels: expect.objectContaining({ "sdk-migration": "m0000" }),
      }),
    );
  });

  test("accepts deploy-derived remote settings during schema verification", async () => {
    const userType = userSnapshotType();
    writeUserSchemaSnapshot(userType);

    const client = schemaVerificationClient({
      pluralForm: "users",
      aggregation: false,
      bulkUpsert: false,
      publishRecordEvents: true,
      disableGqlOperations: {
        create: true,
        update: false,
        delete: false,
        read: false,
      },
    });

    const planResult = planWithDeployDerivedSettings(userType);

    await expect(runValidation(client, planResult)).resolves.toBeDefined();
  });

  test("uses db config gqlOperations when the migration namespace has no deploy input", async () => {
    const userType = userSnapshotType();
    writeUserSchemaSnapshot(userType);

    const client = schemaVerificationClient({
      pluralForm: "users",
      aggregation: false,
      bulkUpsert: false,
      publishRecordEvents: false,
      disableGqlOperations: {
        create: true,
        update: false,
        delete: false,
        read: false,
      },
    });

    const planResult = makePlanResult();
    planResult.context.config.db = {
      "test-tailordb": {
        files: [],
        migration: { directory: "." },
        gqlOperations: { create: false },
      },
    };

    await expect(runValidation(client, planResult)).resolves.toBeDefined();
  });

  test("does not require unapplied deploy-derived settings during schema verification", async () => {
    const userType = userSnapshotType();
    writeUserSchemaSnapshot(userType);

    const client = schemaVerificationClient({
      pluralForm: "users",
      aggregation: false,
      bulkUpsert: false,
      publishRecordEvents: false,
      disableGqlOperations: {
        create: false,
        update: false,
        delete: false,
        read: false,
      },
    });

    const planResult = planWithDeployDerivedSettings(userType);

    await expect(runValidation(client, planResult)).resolves.toBeDefined();
  });

  test("rejects remote-only deploy settings during schema verification", async () => {
    const userType = userSnapshotType();
    writeUserSchemaSnapshot(userType);

    const client = schemaVerificationClient({
      pluralForm: "users",
      aggregation: false,
      bulkUpsert: false,
      publishRecordEvents: false,
      disableGqlOperations: {
        create: true,
        update: false,
        delete: false,
        read: false,
      },
    });

    const planResult = makePlanResult();
    planResult.context.tailorDBInputs = [
      {
        namespace: "test-tailordb",
        config: { files: [] },
        types: { User: userType },
      },
    ];
    planResult.context.executorUsedTables = new Set();

    await expect(runValidation(client, planResult)).rejects.toThrow(
      "Remote schema verification failed",
    );
  });

  test("accepts previously derived publish events after executor removal", async () => {
    const userType = userSnapshotType();
    writeUserSchemaSnapshot(userType);

    const client = schemaVerificationClient({
      pluralForm: "users",
      aggregation: false,
      bulkUpsert: false,
      publishRecordEvents: true,
      disableGqlOperations: {
        create: false,
        update: false,
        delete: false,
        read: false,
      },
    });

    const planResult = makePlanResult();
    planResult.context.tailorDBInputs = [
      {
        namespace: "test-tailordb",
        config: { files: [] },
        types: { User: userType },
      },
    ];
    planResult.context.executorUsedTables = new Set();

    await expect(runValidation(client, planResult)).resolves.toBeDefined();
  });
});

describe("applyTailorDB table apply concurrency", () => {
  test("applies type creates and updates sequentially", async () => {
    const probe = createConcurrencyProbe();
    const client = {
      createTailorDBType: vi.fn().mockImplementation(probe.run),
      updateTailorDBType: vi.fn().mockImplementation(probe.run),
      createTailorDBService: vi.fn().mockResolvedValue({}),
      createTailorDBGQLPermission: vi.fn().mockResolvedValue({}),
      updateTailorDBGQLPermission: vi.fn().mockResolvedValue({}),
      deleteTailorDBGQLPermission: vi.fn().mockResolvedValue({}),
      deleteTailorDBType: vi.fn().mockResolvedValue({}),
      getMetadata: vi.fn().mockResolvedValue({}),
      setMetadata: vi.fn().mockResolvedValue({}),
    } as unknown as OperatorClient;

    const changeOf = (name: string) => ({
      name,
      request: {
        workspaceId: "test-workspace",
        namespaceName: "test-tailordb",
        tailordbType: { name },
      },
      metaRequest: { trn: `trn:v1:workspace:ws:tailordb:test-tailordb:type:${name}` },
    });
    const emptyChanges = (title: string) => ({
      creates: [],
      updates: [],
      deletes: [],
      unchanged: [],
      title,
      isEmpty: () => true,
      lines: () => [],
    });
    const planResult = {
      changeSet: {
        service: emptyChanges("TailorDB Services"),
        type: {
          creates: ["CreateA", "CreateB", "CreateC"].map(changeOf),
          updates: ["UpdateA", "UpdateB", "UpdateC"].map(changeOf),
          deletes: [],
          unchanged: [],
          title: "TailorDB tables",
          isEmpty: () => false,
          lines: () => [],
        },
        gqlPermission: emptyChanges("TailorDB GQL Permissions"),
      },
      conflicts: [],
      unmanaged: [],
      resourceOwners: new Set<string>(),
      context: {
        workspaceId: "test-workspace",
        application: { name: "test-app", tailorDBServices: [] } as unknown as Application,
        tailorDBInputs: [],
        executorUsedTables: new Set<string>(),
        config: { path: "/nonexistent/tailor.config.ts", name: "test-app", db: {} },
        noSchemaCheck: true,
        namespacesWithMigrations: [],
        migrationFileState: {},
        checkpointRepairs: [],
      },
    } as unknown as Awaited<ReturnType<typeof planTailorDB>>;

    await applyTailorDB(client, planResult, "create-update");

    expect(client.createTailorDBType).toHaveBeenCalledTimes(3);
    expect(client.updateTailorDBType).toHaveBeenCalledTimes(3);
    expect(probe.maxInFlight()).toBe(1);
  });
});
