import { describe, test, expect, vi, beforeEach } from "vitest";
import { formatExecutorChangeEntries, planExecutor } from "./executor";
import { sdkNameLabelKey } from "./label";
import type { Application } from "#/cli/services/application";
import type { ExecutorService } from "#/cli/services/executor/service";
import type { OperatorClient } from "#/cli/shared/client";
import type { LoadedConfig } from "#/cli/shared/config-loader";
import type { Executor } from "#/types/executor.generated";
import type { PlanContext } from "./types";

// Mock node:fs to avoid file system access
vi.mock("node:fs", () => ({
  readFileSync: vi.fn().mockReturnValue("// mock script"),
  existsSync: vi.fn().mockReturnValue(true),
}));

// Mock dist-dir to avoid getDistDir issues
vi.mock("#/cli/shared/dist-dir", () => ({
  getDistDir: vi.fn().mockReturnValue(".tailor-sdk"),
}));

// Mock config values for tests
const mockConfig = { path: "/test/tailor.config.ts" } as LoadedConfig;

// Mock label.ts
vi.mock("./label", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const original = (await importOriginal()) as typeof import("./label");
  return {
    ...original,
    buildMetaRequest: vi.fn().mockResolvedValue({
      trn: "trn:v1:workspace:test-workspace:executor:test",
      labels: {
        "sdk-name": "test-app",
        "sdk-version": "v1-0-0",
      },
    }),
  };
});

// Mock createChangeSet to suppress output in tests
vi.mock("./change-set", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const original = (await importOriginal()) as typeof import("./change-set");
  return {
    ...original,
    createChangeSet: (title: string) => ({
      ...original.createChangeSet(title),
      lines: () => [],
    }),
  };
});

type EventConfig = {
  case: string;
  value: Record<string, unknown> & { condition?: { expr: string } | undefined };
};

describe("planExecutor", () => {
  const workspaceId = "test-workspace";
  const appName = "test-app";

  // Helper to create mock executor
  function createMockExecutor(name: string): Executor {
    return {
      name,
      description: `Executor ${name}`,
      disabled: false,
      trigger: {
        kind: "schedule",
        timezone: "UTC",
        cron: "0 * * * *",
      },
      operation: {
        kind: "function",
        body: () => {},
      },
    };
  }

  // Helper to create mock executor with resolverExecuted trigger
  function createMockResolverExecutedExecutor(name: string): Executor {
    return {
      name,
      description: `Executor ${name}`,
      disabled: false,
      trigger: {
        kind: "resolverExecuted",
        resolverName: "testResolver",
        condition: ({ success }: { success: boolean }) => success,
      },
      operation: {
        kind: "function",
        body: () => {},
      },
    };
  }

  // Helper to create mock client
  function createMockClient(
    existingExecutors: Array<{
      name: string;
      label?: string;
      resource?: Record<string, unknown>;
      sdkVersion?: string;
    }>,
  ): OperatorClient {
    return {
      listExecutorExecutors: vi.fn().mockResolvedValue({
        executors: existingExecutors.map((e) => e.resource ?? { name: e.name }),
        nextPageToken: "",
      }),
      getMetadata: vi.fn().mockImplementation(({ trn }: { trn: string }) => {
        const name = trn.split(":").pop();
        const executor = existingExecutors.find((e) => e.name === name);
        return {
          metadata: {
            labels: executor?.label
              ? {
                  [sdkNameLabelKey]: executor.label,
                  "sdk-version": executor.sdkVersion ?? "v1-0-0",
                }
              : {},
          },
        };
      }),
    } as unknown as OperatorClient;
  }

  // Helper to create mock executor service
  function createMockExecutorService(executors: Executor[]): ExecutorService {
    const executorMap = Object.fromEntries(executors.map((e) => [e.name, e]));
    return {
      config: {},
      executors: executorMap,
      loadExecutors: vi.fn().mockResolvedValue(executorMap),
    } as unknown as ExecutorService;
  }

  // Helper to create mock application
  function createMockApplication(
    executors: Executor[],
    options?: {
      tailorDBTypes?: Record<string, string>;
      resolverNames?: Record<string, string>;
      idpNames?: ReadonlyArray<string>;
      authName?: string;
    },
  ): Application {
    const tailorDBServices = Object.entries(
      Object.groupBy(Object.entries(options?.tailorDBTypes ?? {}), ([, ns]) => ns),
    ).map(([namespace, entries]) => ({
      namespace,
      types: Object.fromEntries((entries ?? []).map(([typeName]) => [typeName, {}])),
    }));

    const resolverServices = Object.entries(
      Object.groupBy(Object.entries(options?.resolverNames ?? {}), ([, ns]) => ns),
    ).map(([namespace, entries]) => ({
      namespace,
      resolvers: Object.fromEntries((entries ?? []).map(([name]) => [name, { name }])),
    }));

    const idpServices = (options?.idpNames ?? []).map((name) => ({ name }));

    return {
      name: appName,
      config: {},
      subgraphs: idpServices.map((idp) => ({ Type: "idp", Name: idp.name })),
      env: {},
      executorService: createMockExecutorService(executors),
      tailorDBServices,
      resolverServices,
      idpServices,
      authService: options?.authName ? { config: { name: options.authName } } : undefined,
    } as unknown as Application;
  }

  function buildPlanContext(
    application: Application,
    overrides?: Partial<Omit<PlanContext, "application">>,
  ): PlanContext {
    return {
      client: createMockClient([]),
      workspaceId,
      application,
      forRemoval: false,
      config: mockConfig,
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("rename scenarios", () => {
    test("old executor is deleted when renamed", async () => {
      // Existing executor: "old-executor" with app label
      const client = createMockClient([{ name: "old-executor", label: appName }]);

      // New config has "new-executor" (renamed from old-executor)
      const application = createMockApplication([createMockExecutor("new-executor")]);

      const result = await planExecutor(buildPlanContext(application, { client }));

      // "new-executor" should be created
      expect(result.changeSet.creates).toHaveLength(1);
      expect(result.changeSet.creates[0]!.name).toBe("new-executor");

      // "old-executor" should be deleted
      expect(result.changeSet.deletes).toHaveLength(1);
      expect(result.changeSet.deletes[0]!.name).toBe("old-executor");

      // No updates (since old and new are different names)
      expect(result.changeSet.updates).toHaveLength(0);
    });

    test("multiple executors - one renamed, one unchanged", async () => {
      // Existing: executor-a (to be renamed), executor-b (unchanged)
      const client = createMockClient([
        { name: "executor-a", label: appName },
        { name: "executor-b", label: appName },
      ]);

      // New config: executor-a-renamed (renamed from executor-a), executor-b (unchanged)
      const application = createMockApplication([
        createMockExecutor("executor-a-renamed"),
        createMockExecutor("executor-b"),
      ]);

      const result = await planExecutor(buildPlanContext(application, { client }));

      // "executor-a-renamed" should be created
      expect(result.changeSet.creates).toHaveLength(1);
      expect(result.changeSet.creates[0]!.name).toBe("executor-a-renamed");

      // "executor-b" should be updated (exists)
      expect(result.changeSet.updates).toHaveLength(1);
      expect(result.changeSet.updates[0]!.name).toBe("executor-b");

      // "executor-a" should be deleted
      expect(result.changeSet.deletes).toHaveLength(1);
      expect(result.changeSet.deletes[0]!.name).toBe("executor-a");
    });
  });

  describe("delete scenarios", () => {
    test("executor is deleted when removed from config", async () => {
      // Existing: executor-a, executor-b
      const client = createMockClient([
        { name: "executor-a", label: appName },
        { name: "executor-b", label: appName },
      ]);

      // New config only has executor-a (executor-b removed)
      const application = createMockApplication([createMockExecutor("executor-a")]);

      const result = await planExecutor(buildPlanContext(application, { client }));

      // "executor-a" should be updated
      expect(result.changeSet.updates).toHaveLength(1);
      expect(result.changeSet.updates[0]!.name).toBe("executor-a");

      // "executor-b" should be deleted
      expect(result.changeSet.deletes).toHaveLength(1);
      expect(result.changeSet.deletes[0]!.name).toBe("executor-b");

      // No creates
      expect(result.changeSet.creates).toHaveLength(0);
    });

    test("all executors are deleted when config is empty", async () => {
      // Existing: multiple executors
      const client = createMockClient([
        { name: "executor-1", label: appName },
        { name: "executor-2", label: appName },
        { name: "executor-3", label: appName },
      ]);

      // New config is empty
      const application = createMockApplication([]);

      const result = await planExecutor(buildPlanContext(application, { client }));

      // All should be deleted
      expect(result.changeSet.deletes).toHaveLength(3);
      expect(result.changeSet.deletes.map((d) => d.name).toSorted()).toEqual([
        "executor-1",
        "executor-2",
        "executor-3",
      ]);

      // No creates or updates
      expect(result.changeSet.creates).toHaveLength(0);
      expect(result.changeSet.updates).toHaveLength(0);
    });
  });

  describe("label ownership scenarios", () => {
    test("executor without label is NOT deleted (unmanaged)", async () => {
      // Existing: executor without label (created outside SDK)
      const client = createMockClient([
        { name: "unmanaged-executor" }, // No label
      ]);

      // New config is empty
      const application = createMockApplication([]);

      const result = await planExecutor(buildPlanContext(application, { client }));

      // Should NOT be deleted (no label means not managed by SDK)
      expect(result.changeSet.deletes).toHaveLength(0);
    });

    test("executor owned by different app is NOT deleted", async () => {
      // Existing: executor owned by another app
      const client = createMockClient([{ name: "other-app-executor", label: "other-app" }]);

      // New config is empty
      const application = createMockApplication([]);

      const result = await planExecutor(buildPlanContext(application, { client }));

      // Should NOT be deleted (owned by different app)
      expect(result.changeSet.deletes).toHaveLength(0);

      // Should be tracked as resourceOwner
      expect(result.resourceOwners.has("other-app")).toBe(true);
    });

    test("mixed ownership - only delete own executors", async () => {
      const client = createMockClient([
        { name: "my-executor", label: appName },
        { name: "other-executor", label: "other-app" },
        { name: "unmanaged-executor" }, // No label
      ]);

      // New config is empty
      const application = createMockApplication([]);

      const result = await planExecutor(buildPlanContext(application, { client }));

      // Only own executor should be deleted
      expect(result.changeSet.deletes).toHaveLength(1);
      expect(result.changeSet.deletes[0]!.name).toBe("my-executor");

      // Other app's executor should be in resourceOwners
      expect(result.resourceOwners.has("other-app")).toBe(true);
    });
  });

  describe("create scenarios", () => {
    test("new executor is created", async () => {
      // No existing executors
      const client = createMockClient([]);

      // New executor in config
      const application = createMockApplication([createMockExecutor("new-executor")]);

      const result = await planExecutor(buildPlanContext(application, { client }));

      // Should be created
      expect(result.changeSet.creates).toHaveLength(1);
      expect(result.changeSet.creates[0]!.name).toBe("new-executor");

      // No updates or deletes
      expect(result.changeSet.updates).toHaveLength(0);
      expect(result.changeSet.deletes).toHaveLength(0);
    });
  });

  describe("update scenarios", () => {
    test("existing executor is updated", async () => {
      // Existing executor with app label
      const client = createMockClient([{ name: "existing-executor", label: appName }]);

      // Same executor in config (will be updated)
      const application = createMockApplication([createMockExecutor("existing-executor")]);

      const result = await planExecutor(buildPlanContext(application, { client }));

      // Should be updated
      expect(result.changeSet.updates).toHaveLength(1);
      expect(result.changeSet.updates[0]!.name).toBe("existing-executor");

      // No creates or deletes
      expect(result.changeSet.creates).toHaveLength(0);
      expect(result.changeSet.deletes).toHaveLength(0);
    });

    test("existing executor is unchanged when remote definition matches desired definition", async () => {
      const executor = createMockExecutor("existing-executor");
      const createResult = await planExecutor(buildPlanContext(createMockApplication([executor])));
      const desiredExecutor = createResult.changeSet.creates[0]!.request.executor;

      const client = createMockClient([
        {
          name: "existing-executor",
          label: appName,
          resource: desiredExecutor as Record<string, unknown>,
        },
      ]);

      const result = await planExecutor(
        buildPlanContext(createMockApplication([executor]), { client }),
      );

      expect(result.changeSet.unchanged).toHaveLength(1);
      expect(result.changeSet.unchanged[0]!.name).toBe("existing-executor");
      expect(result.changeSet.updates).toHaveLength(0);
    });

    test("event executor is unchanged when remote response includes empty eventType", async () => {
      const executor: Executor = {
        name: "existing-executor",
        description: "Executor existing-executor",
        disabled: false,
        trigger: {
          kind: "tailordb",
          typeName: "User",
          events: ["tailordb.type_record.created"],
        },
        operation: {
          kind: "function",
          body: () => {},
        },
      };
      const application = createMockApplication([executor], {
        tailorDBTypes: { User: "tailordb" },
      });
      const createResult = await planExecutor(buildPlanContext(application));
      const desiredExecutor = structuredClone(createResult.changeSet.creates[0]!.request.executor);
      const eventConfig = desiredExecutor?.triggerConfig?.config;
      if (eventConfig?.case !== "event") {
        throw new Error("expected event trigger config");
      }
      eventConfig.value.eventType = "";

      const client = createMockClient([
        {
          name: "existing-executor",
          label: appName,
          resource: desiredExecutor as Record<string, unknown>,
        },
      ]);

      const result = await planExecutor(buildPlanContext(application, { client }));

      expect(result.changeSet.unchanged).toHaveLength(1);
      expect(result.changeSet.unchanged[0]!.name).toBe("existing-executor");
      expect(result.changeSet.updates).toHaveLength(0);
    });
  });

  describe("unmanaged and conflict detection", () => {
    test("detects unmanaged resource when same name exists without label", async () => {
      const client = createMockClient([
        { name: "my-executor" }, // No label (unmanaged)
      ]);

      // Config has same name
      const application = createMockApplication([createMockExecutor("my-executor")]);

      const result = await planExecutor(buildPlanContext(application, { client }));

      // Should detect unmanaged resource
      expect(result.unmanaged).toHaveLength(1);
      expect(result.unmanaged[0]!.resourceName).toBe("my-executor");
    });

    test("detects conflict when same name owned by different app", async () => {
      const client = createMockClient([{ name: "my-executor", label: "other-app" }]);

      // Config has same name
      const application = createMockApplication([createMockExecutor("my-executor")]);

      const result = await planExecutor(buildPlanContext(application, { client }));

      // Should detect conflict
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0]!.resourceName).toBe("my-executor");
      expect(result.conflicts[0]!.currentOwner).toBe("other-app");
    });
  });

  describe("forRemoval mode", () => {
    test("skips loading executors when forRemoval is true", async () => {
      const client = createMockClient([
        { name: "executor-1", label: appName },
        { name: "executor-2", label: appName },
      ]);

      const loadExecutors = vi.fn();
      const application = {
        name: appName,
        env: {},
        executorService: { loadExecutors },
      } as unknown as Application;

      const result = await planExecutor(
        buildPlanContext(application, { client, forRemoval: true }),
      );

      // loadExecutors should NOT be called
      expect(loadExecutors).not.toHaveBeenCalled();

      // All existing executors with matching label should be deleted
      expect(result.changeSet.deletes).toHaveLength(2);
    });
  });

  describe("resolverExecutedTrigger success field", () => {
    test("includes success field in trigger condition expression", async () => {
      const application = createMockApplication(
        [createMockResolverExecutedExecutor("test-executor")],
        { resolverNames: { testResolver: "test-resolver-ns" } },
      );

      const result = await planExecutor(buildPlanContext(application));

      expect(result.changeSet.creates).toHaveLength(1);
      const create = result.changeSet.creates[0]!;

      const eventConfig = (
        create.request.executor?.triggerConfig?.config as {
          case: "event";
          value: {
            typedConfig: {
              case: "pipeline";
              value: { condition: { expr: string } };
            };
          };
        }
      ).value.typedConfig.value;
      const conditionExpr = eventConfig.condition.expr;
      expect(conditionExpr).toContain("success: !!args.succeeded");
      expect(conditionExpr).toContain("result: args.succeeded?.result.resolver");
      expect(conditionExpr).toContain("error: args.failed?.error");
    });

    test("includes success field in function operation variables expression", async () => {
      const application = createMockApplication(
        [createMockResolverExecutedExecutor("test-executor")],
        { resolverNames: { testResolver: "test-resolver-ns" } },
      );

      const result = await planExecutor(buildPlanContext(application));

      expect(result.changeSet.creates).toHaveLength(1);
      const create = result.changeSet.creates[0]!;

      const variablesExpr = (
        create.request.executor?.targetConfig?.config as {
          case: "function";
          value: { variables: { expr: string } };
        }
      ).value.variables.expr;
      expect(variablesExpr).toContain("success: !!args.succeeded");
      expect(variablesExpr).toContain("result: args.succeeded?.result.resolver");
      expect(variablesExpr).toContain("error: args.failed?.error");
    });
  });

  describe("typed event config", () => {
    function getEventConfig(result: Awaited<ReturnType<typeof planExecutor>>): EventConfig {
      const create = result.changeSet.creates[0]!;
      return (
        create.request.executor?.triggerConfig?.config as {
          case: "event";
          value: { typedConfig: EventConfig };
        }
      ).value.typedConfig;
    }

    test.each([
      {
        name: "recordCreated emits tailordb typed config",
        executor: {
          name: "on-record-created",
          description: "test",
          disabled: false,
          trigger: {
            kind: "tailordb",
            events: ["tailordb.type_record.created"],
            typeName: "User",
          },
          operation: { kind: "function", body: () => {} },
        } satisfies Executor,
        appOptions: { tailorDBTypes: { User: "my-tailordb" } },
        expected: {
          case: "tailordb",
          eventTypes: ["tailordb.type_record.created"],
          namespaceName: "my-tailordb",
          typeName: "User",
          resolverName: undefined,
        },
      },
      {
        name: "resolverExecuted emits pipeline typed config",
        executor: {
          name: "on-resolver-exec",
          description: "test",
          disabled: false,
          trigger: { kind: "resolverExecuted", resolverName: "myResolver" },
          operation: { kind: "function", body: () => {} },
        } satisfies Executor,
        appOptions: { resolverNames: { myResolver: "my-pipeline" } },
        expected: {
          case: "pipeline",
          eventTypes: ["pipeline.resolver.executed"],
          namespaceName: "my-pipeline",
          typeName: undefined,
          resolverName: "myResolver",
        },
      },
      {
        name: "idpUserCreated emits idp typed config",
        executor: {
          name: "on-idp-user-created",
          description: "test",
          disabled: false,
          trigger: { kind: "idpUser", events: ["idp.user.created"] },
          operation: { kind: "function", body: () => {} },
        } satisfies Executor,
        appOptions: { idpNames: ["my-idp"] },
        expected: {
          case: "idp",
          eventTypes: ["idp.user.created"],
          namespaceName: "my-idp",
          typeName: undefined,
          resolverName: undefined,
        },
      },
      {
        name: "authAccessTokenIssued emits auth typed config",
        executor: {
          name: "on-auth-token-issued",
          description: "test",
          disabled: false,
          trigger: { kind: "authAccessToken", events: ["auth.access_token.issued"] },
          operation: { kind: "function", body: () => {} },
        } satisfies Executor,
        appOptions: { authName: "my-auth" },
        expected: {
          case: "auth",
          eventTypes: ["auth.access_token.issued"],
          namespaceName: "my-auth",
          typeName: undefined,
          resolverName: undefined,
        },
      },
      {
        name: "multi-event record trigger emits multiple eventTypes",
        executor: {
          name: "on-record-change",
          description: "test",
          disabled: false,
          trigger: {
            kind: "tailordb",
            events: ["tailordb.type_record.created", "tailordb.type_record.updated"],
            typeName: "User",
          },
          operation: { kind: "function", body: () => {} },
        } satisfies Executor,
        appOptions: { tailorDBTypes: { User: "my-tailordb" } },
        expected: {
          case: "tailordb",
          eventTypes: ["tailordb.type_record.created", "tailordb.type_record.updated"],
          namespaceName: "my-tailordb",
          typeName: "User",
          resolverName: undefined,
        },
      },
      {
        name: "multi-event idpUser trigger emits multiple eventTypes",
        executor: {
          name: "on-idp-user-change",
          description: "test",
          disabled: false,
          trigger: { kind: "idpUser", events: ["idp.user.created", "idp.user.deleted"] },
          operation: { kind: "function", body: () => {} },
        } satisfies Executor,
        appOptions: { idpNames: ["my-idp"] },
        expected: {
          case: "idp",
          eventTypes: ["idp.user.created", "idp.user.deleted"],
          namespaceName: "my-idp",
          typeName: undefined,
          resolverName: undefined,
        },
      },
      {
        name: "multi-event authAccessToken trigger emits multiple eventTypes",
        executor: {
          name: "on-auth-token-change",
          description: "test",
          disabled: false,
          trigger: {
            kind: "authAccessToken",
            events: ["auth.access_token.issued", "auth.access_token.revoked"],
          },
          operation: { kind: "function", body: () => {} },
        } satisfies Executor,
        appOptions: { authName: "my-auth" },
        expected: {
          case: "auth",
          eventTypes: ["auth.access_token.issued", "auth.access_token.revoked"],
          namespaceName: "my-auth",
          typeName: undefined,
          resolverName: undefined,
        },
      },
    ])("$name", async ({ executor, appOptions, expected }) => {
      const application = createMockApplication([executor], appOptions);

      const result = await planExecutor(buildPlanContext(application));

      expect(result.changeSet.creates).toHaveLength(1);
      const typedConfig = getEventConfig(result);
      expect(typedConfig.case).toBe(expected.case);
      expect(typedConfig.value.eventTypes).toEqual(expected.eventTypes);
      expect(typedConfig.value.namespaceName).toBe(expected.namespaceName);
      expect(typedConfig.value.typeName).toBe(expected.typeName);
      expect(typedConfig.value.resolverName).toBe(expected.resolverName);
      expect(typedConfig.value.condition).toBeUndefined();
    });

    test("idpUserCreated picks the matching IdP when multiple are configured and idp is specified", async () => {
      const executor: Executor = {
        name: "on-idp-user-created",
        description: "test",
        disabled: false,
        trigger: { kind: "idpUser", events: ["idp.user.created"], idp: "idp-b" },
        operation: { kind: "function", body: () => {} },
      };
      const application = createMockApplication([executor], {
        idpNames: ["idp-a", "idp-b"],
      });

      const result = await planExecutor(buildPlanContext(application));

      const typedConfig = getEventConfig(result);
      expect(typedConfig.case).toBe("idp");
      expect(typedConfig.value.namespaceName).toBe("idp-b");
    });

    test("recordCreated with condition emits condition in typed config", async () => {
      const executor: Executor = {
        name: "on-record-created-cond",
        description: "test",
        disabled: false,
        trigger: {
          kind: "tailordb",
          events: ["tailordb.type_record.created"],
          typeName: "User",
          condition: ({ newRecord }: { newRecord: { active: boolean } }) => newRecord.active,
        },
        operation: { kind: "function", body: () => {} },
      };
      const application = createMockApplication([executor], {
        tailorDBTypes: { User: "my-tailordb" },
      });

      const result = await planExecutor(buildPlanContext(application));

      const typedConfig = getEventConfig(result);
      expect(typedConfig.case).toBe("tailordb");
      expect(typedConfig.value.condition).toBeDefined();
      expect((typedConfig.value.condition as { expr: string }).expr).not.toContain("args.typeName");
    });

    test("recordCreated resolves same-run peer TailorDB namespaces", async () => {
      const client = createMockClient([]);
      const executor: Executor = {
        name: "on-peer-record-created",
        description: "test",
        disabled: false,
        trigger: {
          kind: "tailordb",
          events: ["tailordb.type_record.created"],
          typeName: "User",
        },
        operation: { kind: "function", body: () => {} },
      };
      const application = createMockApplication([executor]);

      const result = await planExecutor({
        client,
        workspaceId,
        application,
        forRemoval: false,
        config: mockConfig,
        tailorDBTypeNamespaces: new Map([["User", "shared-db"]]),
      });

      const typedConfig = getEventConfig(result);
      expect(typedConfig.case).toBe("tailordb");
      expect(typedConfig.value.namespaceName).toBe("shared-db");
      expect(typedConfig.value.typeName).toBe("User");
    });

    test("resolverExecuted emits pipeline typed config", async () => {
      const client = createMockClient([]);
      const executor: Executor = {
        name: "on-resolver-exec",
        description: "test",
        disabled: false,
        trigger: {
          kind: "resolverExecuted",
          resolverName: "myResolver",
        },
        operation: { kind: "function", body: () => {} },
      };
      const application = createMockApplication([executor], {
        resolverNames: { myResolver: "my-pipeline" },
      });

      const result = await planExecutor({
        client,
        workspaceId,
        application,
        forRemoval: false,
        config: mockConfig,
      });

      const typedConfig = getEventConfig(result);
      expect(typedConfig.case).toBe("pipeline");
      expect(typedConfig.value.eventTypes).toEqual(["pipeline.resolver.executed"]);
      expect(typedConfig.value.namespaceName).toBe("my-pipeline");
      expect(typedConfig.value.resolverName).toBe("myResolver");
      expect(typedConfig.value.condition).toBeUndefined();
    });

    test("resolverExecuted resolves same-run peer resolver namespaces", async () => {
      const client = createMockClient([]);
      const executor: Executor = {
        name: "on-peer-resolver-exec",
        description: "test",
        disabled: false,
        trigger: {
          kind: "resolverExecuted",
          resolverName: "myResolver",
        },
        operation: { kind: "function", body: () => {} },
      };
      const application = createMockApplication([executor]);

      const result = await planExecutor({
        client,
        workspaceId,
        application,
        forRemoval: false,
        config: mockConfig,
        resolverNamespaces: new Map([["myResolver", "shared-pipeline"]]),
      });

      const typedConfig = getEventConfig(result);
      expect(typedConfig.case).toBe("pipeline");
      expect(typedConfig.value.namespaceName).toBe("shared-pipeline");
      expect(typedConfig.value.resolverName).toBe("myResolver");
    });

    test("idpUserCreated emits idp typed config", async () => {
      const client = createMockClient([]);
      const executor: Executor = {
        name: "on-idp-user-created",
        description: "test",
        disabled: false,
        trigger: { kind: "idpUser", events: ["idp.user.created"] },
        operation: { kind: "function", body: () => {} },
      };
      const application = createMockApplication([executor], {
        idpNames: ["my-idp"],
      });

      const result = await planExecutor({
        client,
        workspaceId,
        application,
        forRemoval: false,
        config: mockConfig,
      });

      const typedConfig = getEventConfig(result);
      expect(typedConfig.case).toBe("idp");
      expect(typedConfig.value.eventTypes).toEqual(["idp.user.created"]);
      expect(typedConfig.value.namespaceName).toBe("my-idp");
    });

    test("idpUserCreated resolves specified same-run peer IdPs", async () => {
      const client = createMockClient([]);
      const executor: Executor = {
        name: "on-peer-idp-user-created",
        description: "test",
        disabled: false,
        trigger: { kind: "idpUser", events: ["idp.user.created"], idp: "peer-idp" },
        operation: { kind: "function", body: () => {} },
      };
      const application = createMockApplication([executor]);

      const result = await planExecutor({
        client,
        workspaceId,
        application,
        forRemoval: false,
        config: mockConfig,
        idpNames: new Set(["peer-idp"]),
      });

      const typedConfig = getEventConfig(result);
      expect(typedConfig.case).toBe("idp");
      expect(typedConfig.value.namespaceName).toBe("peer-idp");
    });

    test("authAccessTokenIssued emits auth typed config", async () => {
      const client = createMockClient([]);
      const executor: Executor = {
        name: "on-auth-token-issued",
        description: "test",
        disabled: false,
        trigger: { kind: "authAccessToken", events: ["auth.access_token.issued"] },
        operation: { kind: "function", body: () => {} },
      };
      const application = createMockApplication([executor], {
        authName: "my-auth",
      });

      const result = await planExecutor({
        client,
        workspaceId,
        application,
        forRemoval: false,
        config: mockConfig,
      });

      const typedConfig = getEventConfig(result);
      expect(typedConfig.case).toBe("auth");
      expect(typedConfig.value.eventTypes).toEqual(["auth.access_token.issued"]);
      expect(typedConfig.value.namespaceName).toBe("my-auth");
    });

    test("recordCreated throws when typeName not found in any TailorDB service", async () => {
      const client = createMockClient([]);
      const executor: Executor = {
        name: "on-record-created",
        description: "test",
        disabled: false,
        trigger: {
          kind: "tailordb",
          events: ["tailordb.type_record.created"],
          typeName: "Unknown",
        },
        operation: { kind: "function", body: () => {} },
      };
      const application = createMockApplication([executor], {
        tailorDBTypes: { User: "my-tailordb" },
      });

      await expect(
        planExecutor({ client, workspaceId, application, forRemoval: false, config: mockConfig }),
      ).rejects.toThrow('TailorDB type "Unknown" not found in any namespace');
    });

    test("resolverExecuted throws when resolver not found in any namespace", async () => {
      const client = createMockClient([]);
      const executor: Executor = {
        name: "on-resolver-exec",
        description: "test",
        disabled: false,
        trigger: { kind: "resolverExecuted", resolverName: "unknown" },
        operation: { kind: "function", body: () => {} },
      };
      const application = createMockApplication([executor], {
        resolverNames: { myResolver: "my-pipeline" },
      });

      await expect(
        planExecutor({ client, workspaceId, application, forRemoval: false, config: mockConfig }),
      ).rejects.toThrow('Resolver "unknown" not found in any namespace');
    });

    test("idpUserCreated throws when no IdP service configured", async () => {
      const client = createMockClient([]);
      const executor: Executor = {
        name: "on-idp-user-created",
        description: "test",
        disabled: false,
        trigger: { kind: "idpUser", events: ["idp.user.created"] },
        operation: { kind: "function", body: () => {} },
      };
      const application = createMockApplication([executor]);

      await expect(
        planExecutor({ client, workspaceId, application, forRemoval: false, config: mockConfig }),
      ).rejects.toThrow(/no IdP is configured/);
    });

    test("idpUserCreated picks the matching IdP when multiple are configured and idp is specified", async () => {
      const client = createMockClient([]);
      const executor: Executor = {
        name: "on-idp-user-created",
        description: "test",
        disabled: false,
        trigger: { kind: "idpUser", events: ["idp.user.created"], idp: "idp-b" },
        operation: { kind: "function", body: () => {} },
      };
      const application = createMockApplication([executor], {
        idpNames: ["idp-a", "idp-b"],
      });

      const result = await planExecutor({
        client,
        workspaceId,
        application,
        forRemoval: false,
        config: mockConfig,
      });

      const typedConfig = getEventConfig(result);
      expect(typedConfig.case).toBe("idp");
      expect(typedConfig.value.namespaceName).toBe("idp-b");
    });

    test("idpUserCreated throws when multiple IdPs are configured and idp is omitted", async () => {
      const client = createMockClient([]);
      const executor: Executor = {
        name: "on-idp-user-created",
        description: "test",
        disabled: false,
        trigger: { kind: "idpUser", events: ["idp.user.created"] },
        operation: { kind: "function", body: () => {} },
      };
      const application = createMockApplication([executor], {
        idpNames: ["idp-a", "idp-b"],
      });

      await expect(
        planExecutor({ client, workspaceId, application, forRemoval: false, config: mockConfig }),
      ).rejects.toThrow(/multiple IdPs/);
    });

    test("idpUserCreated throws when specified idp does not exist", async () => {
      const client = createMockClient([]);
      const executor: Executor = {
        name: "on-idp-user-created",
        description: "test",
        disabled: false,
        trigger: { kind: "idpUser", events: ["idp.user.created"], idp: "missing" },
        operation: { kind: "function", body: () => {} },
      };
      const application = createMockApplication([executor], {
        idpNames: ["idp-a", "idp-b"],
      });

      await expect(
        planExecutor({ client, workspaceId, application, forRemoval: false, config: mockConfig }),
      ).rejects.toThrow(/no IdP with that name is configured/);
    });

    test("authAccessTokenIssued throws when no Auth service configured", async () => {
      const client = createMockClient([]);
      const executor: Executor = {
        name: "on-auth-token-issued",
        description: "test",
        disabled: false,
        trigger: { kind: "authAccessToken", events: ["auth.access_token.issued"] },
        operation: { kind: "function", body: () => {} },
      };
      const application = createMockApplication([executor]);

      await expect(
        planExecutor({ client, workspaceId, application, forRemoval: false, config: mockConfig }),
      ).rejects.toThrow("No Auth service configured");
    });

    test("multi-event record trigger emits multiple eventTypes", async () => {
      const client = createMockClient([]);
      const executor: Executor = {
        name: "on-record-change",
        description: "test",
        disabled: false,
        trigger: {
          kind: "tailordb",
          events: ["tailordb.type_record.created", "tailordb.type_record.updated"],
          typeName: "User",
        },
        operation: { kind: "function", body: () => {} },
      };
      const application = createMockApplication([executor], {
        tailorDBTypes: { User: "my-tailordb" },
      });

      const result = await planExecutor({
        client,
        workspaceId,
        application,
        forRemoval: false,
        config: mockConfig,
      });

      expect(result.changeSet.creates).toHaveLength(1);
      const typedConfig = getEventConfig(result);
      expect(typedConfig.case).toBe("tailordb");
      expect(typedConfig.value.eventTypes).toEqual([
        "tailordb.type_record.created",
        "tailordb.type_record.updated",
      ]);
      expect(typedConfig.value.namespaceName).toBe("my-tailordb");
      expect(typedConfig.value.typeName).toBe("User");
    });

    test("multi-event idpUser trigger emits multiple eventTypes", async () => {
      const client = createMockClient([]);
      const executor: Executor = {
        name: "on-idp-user-change",
        description: "test",
        disabled: false,
        trigger: {
          kind: "idpUser",
          events: ["idp.user.created", "idp.user.deleted"],
        },
        operation: { kind: "function", body: () => {} },
      };
      const application = createMockApplication([executor], {
        idpNames: ["my-idp"],
      });

      const result = await planExecutor({
        client,
        workspaceId,
        application,
        forRemoval: false,
        config: mockConfig,
      });

      const typedConfig = getEventConfig(result);
      expect(typedConfig.case).toBe("idp");
      expect(typedConfig.value.eventTypes).toEqual(["idp.user.created", "idp.user.deleted"]);
      expect(typedConfig.value.namespaceName).toBe("my-idp");
    });

    test("multi-event authAccessToken trigger emits multiple eventTypes", async () => {
      const client = createMockClient([]);
      const executor: Executor = {
        name: "on-auth-token-change",
        description: "test",
        disabled: false,
        trigger: {
          kind: "authAccessToken",
          events: ["auth.access_token.issued", "auth.access_token.revoked"],
        },
        operation: { kind: "function", body: () => {} },
      };
      const application = createMockApplication([executor], {
        authName: "my-auth",
      });

      const result = await planExecutor({
        client,
        workspaceId,
        application,
        forRemoval: false,
        config: mockConfig,
      });

      const typedConfig = getEventConfig(result);
      expect(typedConfig.case).toBe("auth");
      expect(typedConfig.value.eventTypes).toEqual([
        "auth.access_token.issued",
        "auth.access_token.revoked",
      ]);
      expect(typedConfig.value.namespaceName).toBe("my-auth");
    });

    test("multi-event record trigger with condition emits condition", async () => {
      const executor: Executor = {
        name: "on-record-change-cond",
        description: "test",
        disabled: false,
        trigger: {
          kind: "tailordb",
          events: [
            "tailordb.type_record.created",
            "tailordb.type_record.updated",
            "tailordb.type_record.deleted",
          ],
          typeName: "User",
          condition: ({ typeName }: { typeName: string }) => typeName === "User",
        },
        operation: { kind: "function", body: () => {} },
      };
      const application = createMockApplication([executor], {
        tailorDBTypes: { User: "my-tailordb" },
      });

      const result = await planExecutor(buildPlanContext(application));

      const typedConfig = getEventConfig(result);
      expect(typedConfig.case).toBe("tailordb");
      expect(typedConfig.value.eventTypes).toEqual([
        "tailordb.type_record.created",
        "tailordb.type_record.updated",
        "tailordb.type_record.deleted",
      ]);
      expect(typedConfig.value.condition).toBeDefined();
    });

    test.each([
      {
        name: "recordCreated throws when typeName not found in any TailorDB service",
        executor: {
          name: "on-record-created",
          description: "test",
          disabled: false,
          trigger: {
            kind: "tailordb",
            events: ["tailordb.type_record.created"],
            typeName: "Unknown",
          },
          operation: { kind: "function", body: () => {} },
        } satisfies Executor,
        appOptions: { tailorDBTypes: { User: "my-tailordb" } },
        errorPattern: 'TailorDB type "Unknown" not found in any namespace',
      },
      {
        name: "resolverExecuted throws when resolver not found in any namespace",
        executor: {
          name: "on-resolver-exec",
          description: "test",
          disabled: false,
          trigger: { kind: "resolverExecuted", resolverName: "unknown" },
          operation: { kind: "function", body: () => {} },
        } satisfies Executor,
        appOptions: { resolverNames: { myResolver: "my-pipeline" } },
        errorPattern: 'Resolver "unknown" not found in any namespace',
      },
      {
        name: "idpUserCreated throws when no IdP service configured",
        executor: {
          name: "on-idp-user-created",
          description: "test",
          disabled: false,
          trigger: { kind: "idpUser", events: ["idp.user.created"] },
          operation: { kind: "function", body: () => {} },
        } satisfies Executor,
        appOptions: undefined,
        errorPattern: /no IdP is configured/,
      },
      {
        name: "idpUserCreated throws when multiple IdPs are configured and idp is omitted",
        executor: {
          name: "on-idp-user-created",
          description: "test",
          disabled: false,
          trigger: { kind: "idpUser", events: ["idp.user.created"] },
          operation: { kind: "function", body: () => {} },
        } satisfies Executor,
        appOptions: { idpNames: ["idp-a", "idp-b"] },
        errorPattern: /multiple IdPs/,
      },
      {
        name: "idpUserCreated throws when specified idp does not exist",
        executor: {
          name: "on-idp-user-created",
          description: "test",
          disabled: false,
          trigger: { kind: "idpUser", events: ["idp.user.created"], idp: "missing" },
          operation: { kind: "function", body: () => {} },
        } satisfies Executor,
        appOptions: { idpNames: ["idp-a", "idp-b"] },
        errorPattern: /no IdP with that name is configured/,
      },
      {
        name: "authAccessTokenIssued throws when no Auth service configured",
        executor: {
          name: "on-auth-token-issued",
          description: "test",
          disabled: false,
          trigger: { kind: "authAccessToken", events: ["auth.access_token.issued"] },
          operation: { kind: "function", body: () => {} },
        } satisfies Executor,
        appOptions: undefined,
        errorPattern: "No Auth service configured",
      },
    ])("$name", async ({ executor, appOptions, errorPattern }) => {
      const application = createMockApplication([executor], appOptions);

      await expect(planExecutor(buildPlanContext(application))).rejects.toThrow(errorPattern);
    });
  });
});

describe("formatExecutorChangeEntries", () => {
  test("groups function executor updates with related function registry updates", () => {
    const entries = formatExecutorChangeEntries(
      {
        creates: [],
        updates: [
          {
            name: "user-created",
            request: {
              workspaceId: "ws",
              executor: {
                name: "user-created",
                targetType: 3,
              },
            },
            metaRequest: { trn: "t", labels: {} },
          },
        ],
        deletes: [],
        replaces: [],
      },
      {
        "user-created": {
          name: "user-created",
          targetType: 3,
        },
      },
      {
        creates: [],
        updates: [{ name: "executor--user-created" }],
        deletes: [],
        replaces: [],
      },
    );

    expect(entries).toEqual([
      {
        action: "update",
        symbol: "~",
        name: "user-created",
        labels: ["executor", "function"],
      },
    ]);
  });

  test("groups function executor deletes with related function registry deletes", () => {
    const entries = formatExecutorChangeEntries(
      {
        creates: [],
        updates: [],
        deletes: [
          {
            name: "user-created",
            request: {
              workspaceId: "ws",
              name: "user-created",
            },
          },
        ],
        replaces: [],
      },
      {},
      {
        creates: [],
        updates: [],
        deletes: [{ name: "executor--user-created" }],
        replaces: [],
      },
    );

    expect(entries).toEqual([
      {
        action: "delete",
        symbol: "-",
        name: "user-created",
        labels: ["executor", "function"],
      },
    ]);
  });
});
