import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { applyPreMigrationFieldAdjustments } from "#/cli/commands/tailordb/migrate/pre-migration-schema";
import { sdkNameLabelKey } from "../label";
import { applyTailorDB, formatTailorDBResourceChangeEntries, planTailorDB } from ".";
import type { FieldDiffChange } from "#/cli/commands/tailordb/migrate/diff-calculator";
import type { SnapshotFieldConfig } from "#/cli/commands/tailordb/migrate/snapshot";
import type { Application } from "#/cli/services/application";
import type { ExecutorService } from "#/cli/services/executor/service";
import type { TailorDBService } from "#/cli/services/tailordb/service";
import type { OperatorClient } from "#/cli/shared/client";
import type { LoadedConfig } from "#/cli/shared/config-loader";
import type { TailorDBType } from "#/parser/service/tailordb/types";
import type { PlanContext } from "../types";
import type { MessageInitShape } from "@bufbuild/protobuf";
import type { TailorDBType_FieldConfigSchema } from "@tailor-platform/tailor-proto/tailordb_resource_pb";

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

  beforeEach(() => {
    vi.clearAllMocks();
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

      const client = {
        listTailorDBServices: vi.fn().mockResolvedValue({
          tailordbServices: [{ namespace: { name: "test-tailordb" } }],
          nextPageToken: "",
        }),
        listTailorDBTypes: vi.fn().mockResolvedValue({
          tailordbTypes: [
            {
              name: "Invoice",
              schema: {
                description: "Invoice type",
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
                    serial: {
                      start: "1",
                      maxValue: "999",
                    },
                  },
                },
                relationships: {},
                settings: {
                  aggregation: false,
                  bulkUpsert: false,
                  draft: false,
                  defaultQueryLimitSize: "100",
                  maxBulkUpsertSize: "1000",
                  pluralForm: "invoices",
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
                permission: {
                  create: [],
                  read: [],
                  update: [],
                  delete: [],
                },
              },
            },
          ],
          nextPageToken: "",
        }),
        getMetadata: vi.fn().mockResolvedValue({
          metadata: {
            labels: { [sdkNameLabelKey]: appName, "sdk-version": "v1-0-0" },
          },
        }),
        listTailorDBGQLPermissions: vi.fn().mockResolvedValue({
          permissions: [],
          nextPageToken: "",
        }),
      } as unknown as OperatorClient;

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

      const client = {
        listTailorDBServices: vi.fn().mockResolvedValue({
          tailordbServices: [{ namespace: { name: "test-tailordb" } }],
          nextPageToken: "",
        }),
        listTailorDBTypes: vi.fn().mockResolvedValue({
          tailordbTypes: [
            {
              name: "Invoice",
              schema: {
                description: "Invoice type",
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
                relationships: {},
                settings: {
                  aggregation: false,
                  bulkUpsert: false,
                  draft: false,
                  defaultQueryLimitSize: "100",
                  maxBulkUpsertSize: "1000",
                  pluralForm: "invoices",
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
                permission: {
                  create: [],
                  read: [],
                  update: [],
                  delete: [],
                },
              },
            },
          ],
          nextPageToken: "",
        }),
        getMetadata: vi.fn().mockResolvedValue({
          metadata: {
            labels: { [sdkNameLabelKey]: appName, "sdk-version": "v1-0-0" },
          },
        }),
        listTailorDBGQLPermissions: vi.fn().mockResolvedValue({
          permissions: [],
          nextPageToken: "",
        }),
      } as unknown as OperatorClient;

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

      const client = {
        listTailorDBServices: vi.fn().mockResolvedValue({
          tailordbServices: [{ namespace: { name: "test-tailordb" } }],
          nextPageToken: "",
        }),
        listTailorDBTypes: vi.fn().mockResolvedValue({
          tailordbTypes: [
            {
              name: "Event",
              schema: {
                description: "Event type",
                fields: {
                  name: {
                    type: "string",
                    required: false,
                    allowedValues: [],
                    // Platform omits `description` for fields without one, while the
                    // local manifest always emits `description: ""` (generateTailorDBTypeManifest).
                    // These must compare as equal.
                    validate: [],
                    array: false,
                    index: false,
                    unique: false,
                    foreignKey: false,
                    vector: false,
                    fields: {},
                  },
                },
                relationships: {},
                settings: {
                  aggregation: false,
                  bulkUpsert: false,
                  draft: false,
                  defaultQueryLimitSize: "100",
                  maxBulkUpsertSize: "1000",
                  pluralForm: "events",
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
                permission: {
                  create: [],
                  read: [],
                  update: [],
                  delete: [],
                },
              },
            },
          ],
          nextPageToken: "",
        }),
        getMetadata: vi.fn().mockResolvedValue({
          metadata: {
            labels: { [sdkNameLabelKey]: appName, "sdk-version": "v1-0-0" },
          },
        }),
        listTailorDBGQLPermissions: vi.fn().mockResolvedValue({
          permissions: [],
          nextPageToken: "",
        }),
      } as unknown as OperatorClient;

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
});

describe("formatTailorDBResourceChangeEntries", () => {
  test("groups type and gqlPermission changes for the same type name", () => {
    const entries = formatTailorDBResourceChangeEntries(
      {
        creates: [{ name: "Project" }],
        updates: [],
        deletes: [],
        replaces: [],
      },
      {
        creates: [{ name: "Project" }],
        updates: [],
        deletes: [],
        replaces: [],
      },
    );

    expect(entries).toEqual([
      {
        action: "create",
        symbol: "+",
        name: "Project",
        labels: ["type", "gqlPermission"],
      },
    ]);
  });

  test("shows separate entries when type and gqlPermission have different actions for the same name", () => {
    const entries = formatTailorDBResourceChangeEntries(
      {
        creates: [{ name: "Project" }],
        updates: [],
        deletes: [],
        replaces: [],
      },
      {
        creates: [],
        updates: [{ name: "Project" }],
        deletes: [],
        replaces: [],
      },
    );

    expect(entries).toEqual([
      {
        action: "create",
        symbol: "+",
        name: "Project",
        labels: ["type"],
      },
      {
        action: "update",
        symbol: "~",
        name: "Project",
        labels: ["gqlPermission"],
      },
    ]);
  });

  test("keeps standalone gqlPermission changes visible", () => {
    const entries = formatTailorDBResourceChangeEntries(
      {
        creates: [],
        updates: [],
        deletes: [],
        replaces: [],
      },
      {
        creates: [{ name: "Project" }],
        updates: [],
        deletes: [],
        replaces: [],
      },
    );

    expect(entries).toEqual([
      {
        action: "create",
        symbol: "+",
        name: "Project",
        labels: ["gqlPermission"],
      },
    ]);
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
      },
    } as unknown as Awaited<ReturnType<typeof planTailorDB>>;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("delete-resources phase deletes GQLPermissions and Types but not Services", async () => {
    const client = createMockClientWithSpies();
    const planResult = createMockPlanResult();

    await applyTailorDB(client, planResult, "delete-resources");

    // GQLPermissions should be deleted
    expect(client.deleteTailorDBGQLPermission).toHaveBeenCalledTimes(1);
    // Types should be deleted
    expect(client.deleteTailorDBType).toHaveBeenCalledTimes(1);
    // Services should NOT be deleted
    expect(client.deleteTailorDBService).not.toHaveBeenCalled();
  });

  test("delete-services phase deletes ONLY services", async () => {
    const client = createMockClientWithSpies();
    const planResult = createMockPlanResult();

    await applyTailorDB(client, planResult, "delete-services");

    // GQLPermissions should NOT be deleted
    expect(client.deleteTailorDBGQLPermission).not.toHaveBeenCalled();
    // Types should NOT be deleted
    expect(client.deleteTailorDBType).not.toHaveBeenCalled();
    // Services should be deleted
    expect(client.deleteTailorDBService).toHaveBeenCalledTimes(1);
  });

  test("create-update phase deletes GQLPermissions and Types but not Services", async () => {
    const client = createMockClientWithSpies();
    const planResult = createMockPlanResult();

    await applyTailorDB(client, planResult, "create-update");

    // GQLPermissions and Types should be deleted in create-update phase (when no migrations)
    expect(client.deleteTailorDBGQLPermission).toHaveBeenCalledTimes(1);
    expect(client.deleteTailorDBType).toHaveBeenCalledTimes(1);
    // Services should NOT be deleted in create-update phase
    expect(client.deleteTailorDBService).not.toHaveBeenCalled();
  });
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

describe("applyTailorDB migration label reconciliation (--no-schema-check)", () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "applyTailorDB-reconcile-"));
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
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  function makePlanResult(): Awaited<ReturnType<typeof planTailorDB>> {
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
        noSchemaCheck: true,
      },
    } as unknown as Awaited<ReturnType<typeof planTailorDB>>;
  }

  test("forces migration label to working_tree_max when label is ahead of working tree", async () => {
    // Remote label is m0002 but the working tree only has migration 0000.
    // Without reconciliation, the next deploy would reconstruct a snapshot at
    // m0002 (which does not exist) and trigger a false drift error.
    const getMetadata = vi.fn().mockResolvedValue({
      metadata: { labels: { "sdk-migration": "m0002" } },
    });
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
    } as unknown as OperatorClient;

    await applyTailorDB(client, makePlanResult(), "create-update");

    expect(setMetadata).toHaveBeenCalledTimes(1);
    expect(setMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        labels: expect.objectContaining({ "sdk-migration": "m0000" }),
      }),
    );
  });

  test("forces migration label even when remote has no prior label", async () => {
    const getMetadata = vi.fn().mockResolvedValue({ metadata: { labels: {} } });
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
    } as unknown as OperatorClient;

    await applyTailorDB(client, makePlanResult(), "create-update");

    expect(setMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        labels: expect.objectContaining({ "sdk-migration": "m0000" }),
      }),
    );
  });
});

describe("applyTailorDB initial migration baseline (schema check enabled)", () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "applyTailorDB-baseline-"));
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
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  function makePlanResult(): Awaited<ReturnType<typeof planTailorDB>> {
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
        noSchemaCheck: false,
      },
    } as unknown as Awaited<ReturnType<typeof planTailorDB>>;
  }

  test("sets the migration label to 0000 on the first apply (no prior label)", async () => {
    // Fresh project: `migration generate` created 0000/schema.json, the remote
    // namespace has no `sdk-migration` label yet. A single `apply` should
    // establish the baseline by setting the label to 0000 — without requiring
    // the redundant apply/generate/apply dance.
    const getMetadata = vi.fn().mockResolvedValue({ metadata: { labels: {} } });
    const setMetadata = vi.fn().mockResolvedValue({});
    const client = {
      getMetadata,
      setMetadata,
      listTailorDBTypes: vi.fn().mockResolvedValue({ tailordbTypes: [], nextPageToken: "" }),
      createTailorDBService: vi.fn().mockResolvedValue({}),
      createTailorDBType: vi.fn().mockResolvedValue({}),
      updateTailorDBType: vi.fn().mockResolvedValue({}),
      createTailorDBGQLPermission: vi.fn().mockResolvedValue({}),
      updateTailorDBGQLPermission: vi.fn().mockResolvedValue({}),
      deleteTailorDBGQLPermission: vi.fn().mockResolvedValue({}),
      deleteTailorDBType: vi.fn().mockResolvedValue({}),
    } as unknown as OperatorClient;

    await applyTailorDB(client, makePlanResult(), "create-update");

    expect(setMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        labels: expect.objectContaining({ "sdk-migration": "m0000" }),
      }),
    );
  });
});
