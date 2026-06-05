import { describe, test, expect, vi, beforeEach, type Mock } from "vitest";

type MockProcedure = (...args: Parameters<Mock>) => ReturnType<Mock>;
import { formatExecutorChangeEntries, planExecutor } from "./executor";
import { sdkNameLabelKey } from "./label";
import type { PlanContext } from "./types";
import type { Application } from "@/cli/services/application";
import type { ExecutorService } from "@/cli/services/executor/service";
import type { OperatorClient } from "@/cli/shared/client";
import type { LoadedConfig } from "@/cli/shared/config-loader";
import type { Executor } from "@/types/executor.generated";

// Mock node:fs to avoid file system access
vi.mock("node:fs", () => ({
  readFileSync: vi.fn<MockProcedure>().mockReturnValue("// mock script"),
  existsSync: vi.fn<MockProcedure>().mockReturnValue(true),
}));

// Mock dist-dir to avoid getDistDir issues
vi.mock("@/cli/shared/dist-dir", () => ({
  getDistDir: vi.fn<MockProcedure>().mockReturnValue(".tailor-sdk"),
}));

// Mock config values for tests
const mockConfig = { path: "/test/tailor.config.ts" } as LoadedConfig;

// Mock label.ts
vi.mock("./label", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const original = (await importOriginal()) as typeof import("./label");
  return {
    ...original,
    buildMetaRequest: vi.fn<MockProcedure>().mockResolvedValue({
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
      print: () => {},
    }),
  };
});

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
      listExecutorExecutors: vi.fn<MockProcedure>().mockResolvedValue({
        executors: existingExecutors.map((e) => e.resource ?? { name: e.name }),
        nextPageToken: "",
      }),
      getMetadata: vi.fn<MockProcedure>().mockImplementation(({ trn }: { trn: string }) => {
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
      loadExecutors: vi.fn<MockProcedure>().mockResolvedValue(executorMap),
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
      env: {},
      executorService: createMockExecutorService(executors),
      tailorDBServices,
      resolverServices,
      idpServices,
      authService: options?.authName ? { config: { name: options.authName } } : undefined,
    } as unknown as Application;
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

      const ctx: PlanContext = {
        client,
        workspaceId,
        application,
        forRemoval: false,
        config: mockConfig,
      };

      const result = await planExecutor(ctx);

      // "new-executor" should be created
      expect(result.changeSet.creates).toHaveLength(1);
      expect(result.changeSet.creates[0].name).toBe("new-executor");

      // "old-executor" should be deleted
      expect(result.changeSet.deletes).toHaveLength(1);
      expect(result.changeSet.deletes[0].name).toBe("old-executor");

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

      const ctx: PlanContext = {
        client,
        workspaceId,
        application,
        forRemoval: false,
        config: mockConfig,
      };

      const result = await planExecutor(ctx);

      // "executor-a-renamed" should be created
      expect(result.changeSet.creates).toHaveLength(1);
      expect(result.changeSet.creates[0].name).toBe("executor-a-renamed");

      // "executor-b" should be updated (exists)
      expect(result.changeSet.updates).toHaveLength(1);
      expect(result.changeSet.updates[0].name).toBe("executor-b");

      // "executor-a" should be deleted
      expect(result.changeSet.deletes).toHaveLength(1);
      expect(result.changeSet.deletes[0].name).toBe("executor-a");
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

      const ctx: PlanContext = {
        client,
        workspaceId,
        application,
        forRemoval: false,
        config: mockConfig,
      };

      const result = await planExecutor(ctx);

      // "executor-a" should be updated
      expect(result.changeSet.updates).toHaveLength(1);
      expect(result.changeSet.updates[0].name).toBe("executor-a");

      // "executor-b" should be deleted
      expect(result.changeSet.deletes).toHaveLength(1);
      expect(result.changeSet.deletes[0].name).toBe("executor-b");

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

      const ctx: PlanContext = {
        client,
        workspaceId,
        application,
        forRemoval: false,
        config: mockConfig,
      };

      const result = await planExecutor(ctx);

      // All should be deleted
      expect(result.changeSet.deletes).toHaveLength(3);
      expect(result.changeSet.deletes.map((d) => d.name).sort()).toEqual([
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

      const ctx: PlanContext = {
        client,
        workspaceId,
        application,
        forRemoval: false,
        config: mockConfig,
      };

      const result = await planExecutor(ctx);

      // Should NOT be deleted (no label means not managed by SDK)
      expect(result.changeSet.deletes).toHaveLength(0);
    });

    test("executor owned by different app is NOT deleted", async () => {
      // Existing: executor owned by another app
      const client = createMockClient([{ name: "other-app-executor", label: "other-app" }]);

      // New config is empty
      const application = createMockApplication([]);

      const ctx: PlanContext = {
        client,
        workspaceId,
        application,
        forRemoval: false,
        config: mockConfig,
      };

      const result = await planExecutor(ctx);

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

      const ctx: PlanContext = {
        client,
        workspaceId,
        application,
        forRemoval: false,
        config: mockConfig,
      };

      const result = await planExecutor(ctx);

      // Only own executor should be deleted
      expect(result.changeSet.deletes).toHaveLength(1);
      expect(result.changeSet.deletes[0].name).toBe("my-executor");

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

      const ctx: PlanContext = {
        client,
        workspaceId,
        application,
        forRemoval: false,
        config: mockConfig,
      };

      const result = await planExecutor(ctx);

      // Should be created
      expect(result.changeSet.creates).toHaveLength(1);
      expect(result.changeSet.creates[0].name).toBe("new-executor");

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

      const ctx: PlanContext = {
        client,
        workspaceId,
        application,
        forRemoval: false,
        config: mockConfig,
      };

      const result = await planExecutor(ctx);

      // Should be updated
      expect(result.changeSet.updates).toHaveLength(1);
      expect(result.changeSet.updates[0].name).toBe("existing-executor");

      // No creates or deletes
      expect(result.changeSet.creates).toHaveLength(0);
      expect(result.changeSet.deletes).toHaveLength(0);
    });

    test("existing executor is unchanged when remote definition matches desired definition", async () => {
      const executor = createMockExecutor("existing-executor");
      const createClient = createMockClient([]);
      const createResult = await planExecutor({
        client: createClient,
        workspaceId,
        application: createMockApplication([executor]),
        forRemoval: false,
        config: mockConfig,
      });
      const desiredExecutor = createResult.changeSet.creates[0].request.executor;

      const client = createMockClient([
        {
          name: "existing-executor",
          label: appName,
          resource: desiredExecutor as Record<string, unknown>,
        },
      ]);

      const result = await planExecutor({
        client,
        workspaceId,
        application: createMockApplication([executor]),
        forRemoval: false,
        config: mockConfig,
      });

      expect(result.changeSet.unchanged).toHaveLength(1);
      expect(result.changeSet.unchanged[0].name).toBe("existing-executor");
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
      const createClient = createMockClient([]);
      const createResult = await planExecutor({
        client: createClient,
        workspaceId,
        application: createMockApplication([executor], { tailorDBTypes: { User: "tailordb" } }),
        forRemoval: false,
        config: mockConfig,
      });
      const desiredExecutor = structuredClone(createResult.changeSet.creates[0].request.executor);
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

      const result = await planExecutor({
        client,
        workspaceId,
        application: createMockApplication([executor], { tailorDBTypes: { User: "tailordb" } }),
        forRemoval: false,
        config: mockConfig,
      });

      expect(result.changeSet.unchanged).toHaveLength(1);
      expect(result.changeSet.unchanged[0].name).toBe("existing-executor");
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

      const ctx: PlanContext = {
        client,
        workspaceId,
        application,
        forRemoval: false,
        config: mockConfig,
      };

      const result = await planExecutor(ctx);

      // Should detect unmanaged resource
      expect(result.unmanaged).toHaveLength(1);
      expect(result.unmanaged[0].resourceName).toBe("my-executor");
    });

    test("detects conflict when same name owned by different app", async () => {
      const client = createMockClient([{ name: "my-executor", label: "other-app" }]);

      // Config has same name
      const application = createMockApplication([createMockExecutor("my-executor")]);

      const ctx: PlanContext = {
        client,
        workspaceId,
        application,
        forRemoval: false,
        config: mockConfig,
      };

      const result = await planExecutor(ctx);

      // Should detect conflict
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].resourceName).toBe("my-executor");
      expect(result.conflicts[0].currentOwner).toBe("other-app");
    });
  });

  describe("forRemoval mode", () => {
    test("skips loading executors when forRemoval is true", async () => {
      const client = createMockClient([
        { name: "executor-1", label: appName },
        { name: "executor-2", label: appName },
      ]);

      const loadExecutors = vi.fn<MockProcedure>();
      const application = {
        name: appName,
        env: {},
        executorService: { loadExecutors },
      } as unknown as Application;

      const ctx: PlanContext = {
        client,
        workspaceId,
        application,
        forRemoval: true,
        config: mockConfig,
      };

      const result = await planExecutor(ctx);

      // loadExecutors should NOT be called
      expect(loadExecutors).not.toHaveBeenCalled();

      // All existing executors with matching label should be deleted
      expect(result.changeSet.deletes).toHaveLength(2);
    });
  });

  describe("resolverExecutedTrigger success field", () => {
    test("includes success field in trigger condition expression", async () => {
      const client = createMockClient([]);
      const application = createMockApplication(
        [createMockResolverExecutedExecutor("test-executor")],
        { resolverNames: { testResolver: "test-resolver-ns" } },
      );

      const ctx: PlanContext = {
        client,
        workspaceId,
        application,
        forRemoval: false,
        config: mockConfig,
      };

      const result = await planExecutor(ctx);

      expect(result.changeSet.creates).toHaveLength(1);
      const create = result.changeSet.creates[0];

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
      const client = createMockClient([]);
      const application = createMockApplication(
        [createMockResolverExecutedExecutor("test-executor")],
        { resolverNames: { testResolver: "test-resolver-ns" } },
      );

      const ctx: PlanContext = {
        client,
        workspaceId,
        application,
        forRemoval: false,
        config: mockConfig,
      };

      const result = await planExecutor(ctx);

      expect(result.changeSet.creates).toHaveLength(1);
      const create = result.changeSet.creates[0];

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
    function getEventConfig(result: Awaited<ReturnType<typeof planExecutor>>) {
      const create = result.changeSet.creates[0];
      return (
        create.request.executor?.triggerConfig?.config as {
          case: "event";
          value: { typedConfig: { case: string; value: Record<string, unknown> } };
        }
      ).value.typedConfig;
    }

    test("recordCreated emits tailordb typed config", async () => {
      const client = createMockClient([]);
      const executor: Executor = {
        name: "on-record-created",
        description: "test",
        disabled: false,
        trigger: {
          kind: "tailordb",
          events: ["tailordb.type_record.created"],
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
      expect(typedConfig.value.eventTypes).toEqual(["tailordb.type_record.created"]);
      expect(typedConfig.value.namespaceName).toBe("my-tailordb");
      expect(typedConfig.value.typeName).toBe("User");
      expect(typedConfig.value.condition).toBeUndefined();
    });

    test("recordCreated with condition emits condition in typed config", async () => {
      const client = createMockClient([]);
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

      const result = await planExecutor({
        client,
        workspaceId,
        application,
        forRemoval: false,
        config: mockConfig,
      });

      const typedConfig = getEventConfig(result);
      expect(typedConfig.case).toBe("tailordb");
      expect(typedConfig.value.condition).toBeDefined();
      expect((typedConfig.value.condition as { expr: string }).expr).not.toContain("args.typeName");
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
      const client = createMockClient([]);
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

      const result = await planExecutor({
        client,
        workspaceId,
        application,
        forRemoval: false,
        config: mockConfig,
      });

      const typedConfig = getEventConfig(result);
      expect(typedConfig.case).toBe("tailordb");
      expect(typedConfig.value.eventTypes).toEqual([
        "tailordb.type_record.created",
        "tailordb.type_record.updated",
        "tailordb.type_record.deleted",
      ]);
      expect(typedConfig.value.condition).toBeDefined();
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
