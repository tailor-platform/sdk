import * as fs from "node:fs";
import * as os from "node:os";
import { create } from "@bufbuild/protobuf";
import { TailorDBTypeSchema } from "@tailor-platform/tailor-proto/tailordb_resource_pb";
import * as path from "pathe";
import { describe, test, expect, vi, aroundEach } from "vitest";
import {
  applyPreMigrationFieldAdjustments,
  applyPreMigrationIndexAdjustments,
} from "#/cli/commands/tailordb/migrate/pre-migration-schema";
import {
  formatMigrationNumber,
  type SnapshotFieldConfig,
  type TailorDBSnapshotType,
} from "#/cli/commands/tailordb/migrate/snapshot";
import { createMockMigrationDiff } from "#/cli/commands/tailordb/migrate/test-helpers/migration-diff";
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
    buildMetaRequest: vi.fn().mockResolvedValue({
      trn: "trn:v1:workspace:test-workspace:tailordb:test",
      labels: {
        "sdk-name": "test-app",
        "sdk-version": "v1-0-0",
      },
    }),
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
    test("enables publishRecordEvents when a peer executor targets the type", async () => {
      const tailorDBService = createMockTailorDBService("shared-db");
      const userType: TailorDBType = {
        name: "User",
        pluralForm: "Users",
        description: "User type",
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
        executorUsedTailorDBTypes: new Set(["User"]),
      };

      const result = await planTailorDB(ctx);

      const createdType = result.changeSet.type.creates[0]!.request.tailordbType;
      expect(createdType?.schema?.settings?.publishRecordEvents).toBe(true);
    });

    test("includes validate and hooks for nested fields", async () => {
      const client = createMockClient([]);
      const tailorDBService = createMockTailorDBService("test-tailordb");

      const testType: TailorDBType = {
        name: "User",
        pluralForm: "users",
        description: "User type",
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

      expect(displayNameField?.validate).toHaveLength(1);
      expect(displayNameField?.validate?.[0]?.errorMessage).toBe("Display name is required");
      expect(displayNameField?.validate?.[0]?.script?.expr).toContain(
        "!((_value ?? '').length > 0)",
      );
      expect(displayNameField?.hooks?.create?.expr).toBe("(_value ?? '').trim()");
      expect(displayNameField?.hooks?.update?.expr).toBe("(_value ?? '').trim()");

      expect(contactEmailField?.validate).toHaveLength(1);
      expect(contactEmailField?.validate?.[0]?.errorMessage).toBe("Email must contain @");
      expect(contactEmailField?.validate?.[0]?.script?.expr).toContain(
        "!((_value ?? '').includes('@'))",
      );
      expect(contactEmailField?.hooks?.create?.expr).toBe("(_value ?? '').toLowerCase()");
    });
  });

  describe("type diff normalization", () => {
    test("treats known platform defaults and scalar field placeholders as unchanged", async () => {
      const tailordbType: TailorDBType = {
        name: "Invoice",
        pluralForm: "Invoices",
        description: "Invoice type",
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
        description: "Invoice type",
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

      expect(result.changeSet.type.unchanged).toEqual([{ name: "Invoice" }]);
      expect(result.changeSet.type.updates).toHaveLength(0);
    });

    test("updates matching type when forceApplyAll is enabled", async () => {
      const tailordbType: TailorDBType = {
        name: "Invoice",
        pluralForm: "Invoices",
        description: "Invoice type",
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
        description: "Invoice type",
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
        description: "Invoice type",
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
      expect(result.changeSet.type.unchanged).toEqual([{ name: "Invoice" }]);
    });

    test("treats an omitted remote field description as unchanged against the local empty-string manifest", async () => {
      const tailordbType: TailorDBType = {
        name: "Event",
        pluralForm: "Events",
        description: "Event type",
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
        description: "Event type",
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

      expect(result.changeSet.type.unchanged).toEqual([{ name: "Event" }]);
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
          breakingChanges: [{ typeName: "User", fieldName: "email", reason: "Unique" }],
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
      name: "groups type and gqlPermission changes for the same type name",
      typeChanges: { creates: [{ name: "Project" }], updates: [], deletes: [], replaces: [] },
      gqlPermissionChanges: {
        creates: [{ name: "Project" }],
        updates: [],
        deletes: [],
        replaces: [],
      },
      expected: [
        { action: "create", symbol: "+", name: "Project", labels: ["type", "gqlPermission"] },
      ],
    },
    {
      name: "shows separate entries when type and gqlPermission have different actions for the same name",
      typeChanges: { creates: [{ name: "Project" }], updates: [], deletes: [], replaces: [] },
      gqlPermissionChanges: {
        creates: [],
        updates: [{ name: "Project" }],
        deletes: [],
        replaces: [],
      },
      expected: [
        { action: "create", symbol: "+", name: "Project", labels: ["type"] },
        { action: "update", symbol: "~", name: "Project", labels: ["gqlPermission"] },
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
      expected: [{ action: "create", symbol: "+", name: "Project", labels: ["gqlPermission"] }],
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
                typeName: "TestType",
              },
            },
          ],
          title: "TailorDB Types",
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
          typeName: "Child",
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

  test("relaxes newly-added required field to optional", () => {
    const fields: Record<string, ProtoField> = {
      newField: { type: "string", required: true },
    };
    const typeChanges = new Map<string, FieldDiffChange>([
      [
        "newField",
        {
          kind: "field_added",
          typeName: "T",
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
          typeName: "User",
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
          typeName: "User",
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
          typeName: "User",
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
          title: "TailorDB Services",
          isEmpty: () => true,
          lines: () => [],
        },
        type: {
          creates: [],
          updates: [],
          deletes: [],
          title: "TailorDB Types",
          isEmpty: () => true,
          lines: () => [],
        },
        gqlPermission: {
          creates: [],
          updates: [],
          deletes: [],
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
    return { client, setMetadata };
  }

  function addSentinelTypeCreate(planResult: Awaited<ReturnType<typeof planTailorDB>>): void {
    planResult.changeSet.type.creates.push({
      name: "Sentinel",
      request: { namespaceName: "test-tailordb" },
    } as never);
  }

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

  function writeUserSchemaSnapshot(userType: TailorDBSnapshotType): void {
    fs.writeFileSync(
      path.join(tmpDir, "0000", "schema.json"),
      JSON.stringify({
        version: 1,
        namespace: "test-tailordb",
        createdAt: new Date().toISOString(),
        types: { User: userType },
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
    planResult.context.executorUsedTypes = new Set(["User"]);
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
              typeName: "User",
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
    planResult.context.executorUsedTypes = new Set();
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
    planResult.context.executorUsedTypes = new Set();

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
    planResult.context.executorUsedTypes = new Set();

    await expect(runValidation(client, planResult)).resolves.toBeDefined();
  });
});

describe("applyTailorDB type apply concurrency", () => {
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
      setMetadata: vi.fn().mockResolvedValue({}),
    } as unknown as OperatorClient;

    const changeOf = (name: string) => ({
      name,
      request: {
        workspaceId: "test-workspace",
        namespaceName: "test-tailordb",
        tailordbType: { name },
      },
    });
    const emptyChanges = (title: string) => ({
      creates: [],
      updates: [],
      deletes: [],
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
          title: "TailorDB Types",
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
        executorUsedTypes: new Set<string>(),
        config: { path: "/nonexistent/tailor.config.ts", name: "test-app", db: {} },
        noSchemaCheck: true,
        namespacesWithMigrations: [],
        migrationFileState: {},
      },
    } as unknown as Awaited<ReturnType<typeof planTailorDB>>;

    await applyTailorDB(client, planResult, "create-update");

    expect(client.createTailorDBType).toHaveBeenCalledTimes(3);
    expect(client.updateTailorDBType).toHaveBeenCalledTimes(3);
    expect(probe.maxInFlight()).toBe(1);
  });
});
