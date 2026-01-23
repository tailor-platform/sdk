import { describe, test, expect, vi, beforeEach } from "vitest";
import { planExecutor } from "./executor";
import { sdkNameLabelKey } from "./label";
import type { PlanContext } from "../index";
import type { Application } from "@/cli/application";
import type { ExecutorService } from "@/cli/application/executor/service";
import type { OperatorClient } from "@/cli/client";
import type { Executor } from "@/parser/service/executor";

// Mock node:fs to avoid file system access
vi.mock("node:fs", () => ({
  readFileSync: vi.fn().mockReturnValue("// mock script"),
  existsSync: vi.fn().mockReturnValue(true),
}));

// Mock configure/config to avoid getDistDir issues
vi.mock("@/configure/config", () => ({
  getDistDir: vi.fn().mockReturnValue(".tailor-sdk"),
}));

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
vi.mock("./index", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const original = (await importOriginal()) as typeof import("./index");
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
    existingExecutors: Array<{ name: string; label?: string }>,
  ): OperatorClient {
    return {
      listExecutorExecutors: vi.fn().mockResolvedValue({
        executors: existingExecutors.map((e) => ({ name: e.name })),
        nextPageToken: "",
      }),
      getMetadata: vi.fn().mockImplementation(({ trn }: { trn: string }) => {
        const name = trn.split(":").pop();
        const executor = existingExecutors.find((e) => e.name === name);
        return {
          metadata: {
            labels: executor?.label ? { [sdkNameLabelKey]: executor.label } : {},
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
      getExecutors: vi.fn().mockReturnValue(executorMap),
      loadExecutors: vi.fn().mockResolvedValue(executorMap),
    } as unknown as ExecutorService;
  }

  // Helper to create mock application
  function createMockApplication(executors: Executor[]): Application {
    return {
      name: appName,
      env: {},
      executorService: createMockExecutorService(executors),
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
      };

      const result = await planExecutor(ctx);

      // Should be updated
      expect(result.changeSet.updates).toHaveLength(1);
      expect(result.changeSet.updates[0].name).toBe("existing-executor");

      // No creates or deletes
      expect(result.changeSet.creates).toHaveLength(0);
      expect(result.changeSet.deletes).toHaveLength(0);
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

      const loadExecutors = vi.fn();
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
      const application = createMockApplication([
        createMockResolverExecutedExecutor("test-executor"),
      ]);

      const ctx: PlanContext = {
        client,
        workspaceId,
        application,
        forRemoval: false,
      };

      const result = await planExecutor(ctx);

      expect(result.changeSet.creates).toHaveLength(1);
      const create = result.changeSet.creates[0];

      // Check that condition expression includes success field
      const conditionExpr = (
        create.request.executor?.triggerConfig?.config as {
          case: "event";
          value: { condition: { expr: string } };
        }
      ).value.condition.expr;
      expect(conditionExpr).toContain("success: !!args.succeeded");
      expect(conditionExpr).toContain("result: args.succeeded?.result.resolver");
      expect(conditionExpr).toContain("error: args.failed?.error");
    });

    test("includes success field in function operation variables expression", async () => {
      const client = createMockClient([]);
      const application = createMockApplication([
        createMockResolverExecutedExecutor("test-executor"),
      ]);

      const ctx: PlanContext = {
        client,
        workspaceId,
        application,
        forRemoval: false,
      };

      const result = await planExecutor(ctx);

      expect(result.changeSet.creates).toHaveLength(1);
      const create = result.changeSet.creates[0];

      // Check that function variables expression includes success field
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
});
