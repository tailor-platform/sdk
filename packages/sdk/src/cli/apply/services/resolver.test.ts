import { describe, test, expect, vi, beforeEach } from "vitest";
import { sdkNameLabelKey } from "./label";
import { applyPipeline, planPipeline } from "./resolver";
import type { PlanContext } from "../index";
import type { Application } from "@/cli/application";
import type { ExecutorService } from "@/cli/application/executor/service";
import type { ResolverService } from "@/cli/application/resolver/service";
import type { OperatorClient } from "@/cli/client";

// Mock node:fs
vi.mock("node:fs", () => ({
  readFileSync: vi.fn().mockReturnValue("// mock script"),
  existsSync: vi.fn().mockReturnValue(true),
}));

// Mock configure/config
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
      trn: "trn:v1:workspace:test-workspace:pipeline:test",
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

describe("planPipeline (resolver service level)", () => {
  const workspaceId = "test-workspace";
  const appName = "test-app";

  // Helper to create mock resolver service
  function createMockResolverService(namespace: string): ResolverService {
    return {
      namespace,
      config: {},
      getResolvers: vi.fn().mockReturnValue({}),
      loadResolvers: vi.fn().mockResolvedValue(undefined),
    } as unknown as ResolverService;
  }

  // Helper to create mock executor service
  function createMockExecutorService(): ExecutorService {
    return {
      config: {},
      getExecutors: vi.fn().mockReturnValue({}),
      loadExecutors: vi.fn().mockResolvedValue({}),
    } as unknown as ExecutorService;
  }

  // Helper to create mock client
  function createMockClient(
    existingServices: Array<{ name: string; label?: string }>,
    existingResolvers: Record<string, Array<{ name: string }>> = {},
  ): OperatorClient {
    return {
      listPipelineServices: vi.fn().mockResolvedValue({
        pipelineServices: existingServices.map((s) => ({
          namespace: { name: s.name },
        })),
        nextPageToken: "",
      }),
      listPipelineResolvers: vi
        .fn()
        .mockImplementation(({ namespaceName }: { namespaceName: string }) => ({
          pipelineResolvers: existingResolvers[namespaceName] || [],
          nextPageToken: "",
        })),
      getMetadata: vi.fn().mockImplementation(({ trn }: { trn: string }) => {
        const name = trn.split(":").pop();
        const service = existingServices.find((s) => s.name === name);
        return {
          metadata: {
            labels: service?.label ? { [sdkNameLabelKey]: service.label } : {},
          },
        };
      }),
    } as unknown as OperatorClient;
  }

  // Helper to create mock application
  function createMockApplication(resolverServices: ResolverService[]): Application {
    return {
      name: appName,
      env: {},
      resolverServices,
      executorService: createMockExecutorService(),
    } as unknown as Application;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("rename scenarios (service level)", () => {
    test("old service is deleted when renamed", async () => {
      // Existing service: "old-resolver" with app label
      const client = createMockClient([{ name: "old-resolver", label: appName }]);

      // New config has "new-resolver" (renamed)
      const application = createMockApplication([createMockResolverService("new-resolver")]);

      const ctx: PlanContext = {
        client,
        workspaceId,
        application,
        forRemoval: false,
      };

      const result = await planPipeline(ctx);

      // "new-resolver" should be created
      expect(result.changeSet.service.creates).toHaveLength(1);
      expect(result.changeSet.service.creates[0].name).toBe("new-resolver");

      // "old-resolver" should be deleted
      expect(result.changeSet.service.deletes).toHaveLength(1);
      expect(result.changeSet.service.deletes[0].name).toBe("old-resolver");
    });
  });

  describe("delete scenarios (service level)", () => {
    test("service is deleted when removed from config", async () => {
      const client = createMockClient([
        { name: "resolver-a", label: appName },
        { name: "resolver-b", label: appName },
      ]);

      // Only resolver-a in config
      const application = createMockApplication([createMockResolverService("resolver-a")]);

      const ctx: PlanContext = {
        client,
        workspaceId,
        application,
        forRemoval: false,
      };

      const result = await planPipeline(ctx);

      // "resolver-a" should be updated
      expect(result.changeSet.service.updates).toHaveLength(1);
      expect(result.changeSet.service.updates[0].name).toBe("resolver-a");

      // "resolver-b" should be deleted
      expect(result.changeSet.service.deletes).toHaveLength(1);
      expect(result.changeSet.service.deletes[0].name).toBe("resolver-b");
    });

    test("all services are deleted when config is empty", async () => {
      const client = createMockClient([
        { name: "resolver-1", label: appName },
        { name: "resolver-2", label: appName },
      ]);

      const application = createMockApplication([]);

      const ctx: PlanContext = {
        client,
        workspaceId,
        application,
        forRemoval: false,
      };

      const result = await planPipeline(ctx);

      expect(result.changeSet.service.deletes).toHaveLength(2);
      expect(result.changeSet.service.deletes.map((d) => d.name).sort()).toEqual([
        "resolver-1",
        "resolver-2",
      ]);
    });
  });

  describe("label ownership scenarios (service level)", () => {
    test("service without label is NOT deleted", async () => {
      const client = createMockClient([
        { name: "unmanaged-resolver" }, // No label
      ]);

      const application = createMockApplication([]);

      const ctx: PlanContext = {
        client,
        workspaceId,
        application,
        forRemoval: false,
      };

      const result = await planPipeline(ctx);

      expect(result.changeSet.service.deletes).toHaveLength(0);
    });

    test("service owned by different app is NOT deleted", async () => {
      const client = createMockClient([{ name: "other-resolver", label: "other-app" }]);

      const application = createMockApplication([]);

      const ctx: PlanContext = {
        client,
        workspaceId,
        application,
        forRemoval: false,
      };

      const result = await planPipeline(ctx);

      expect(result.changeSet.service.deletes).toHaveLength(0);
      expect(result.resourceOwners.has("other-app")).toBe(true);
    });

    test("mixed ownership - only delete own services", async () => {
      const client = createMockClient([
        { name: "my-resolver", label: appName },
        { name: "other-resolver", label: "other-app" },
        { name: "unmanaged-resolver" }, // No label
      ]);

      const application = createMockApplication([]);

      const ctx: PlanContext = {
        client,
        workspaceId,
        application,
        forRemoval: false,
      };

      const result = await planPipeline(ctx);

      expect(result.changeSet.service.deletes).toHaveLength(1);
      expect(result.changeSet.service.deletes[0].name).toBe("my-resolver");
      expect(result.resourceOwners.has("other-app")).toBe(true);
    });
  });
});

describe("applyPipeline phase separation", () => {
  // Helper to create mock client with spies for delete operations
  function createMockClientWithSpies() {
    return {
      deletePipelineResolver: vi.fn().mockResolvedValue({}),
      deletePipelineService: vi.fn().mockResolvedValue({}),
      // Also mock create/update methods for completeness
      createPipelineService: vi.fn().mockResolvedValue({}),
      createPipelineResolver: vi.fn().mockResolvedValue({}),
      updatePipelineResolver: vi.fn().mockResolvedValue({}),
      setMetadata: vi.fn().mockResolvedValue({}),
    } as unknown as OperatorClient;
  }

  // Helper to create a mock plan result with deletes
  function createMockPlanResult() {
    return {
      changeSet: {
        service: {
          creates: [],
          updates: [],
          deletes: [
            {
              name: "test-pipeline",
              request: {
                workspaceId: "test-workspace",
                namespaceName: "test-pipeline",
              },
            },
          ],
          title: "Pipeline Services",
          isEmpty: () => false,
          print: () => {},
        },
        resolver: {
          creates: [],
          updates: [],
          deletes: [
            {
              name: "testResolver",
              request: {
                workspaceId: "test-workspace",
                namespaceName: "test-pipeline",
                resolverName: "testResolver",
              },
            },
          ],
          title: "Pipeline Resolvers",
          isEmpty: () => false,
          print: () => {},
        },
      },
      conflicts: [],
      unmanaged: [],
      resourceOwners: new Set<string>(),
    } as unknown as Awaited<ReturnType<typeof planPipeline>>;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("delete-resources phase deletes resolvers, but NOT services", async () => {
    const client = createMockClientWithSpies();
    const planResult = createMockPlanResult();

    await applyPipeline(client, planResult, "delete-resources");

    // Resolvers should be deleted
    expect(client.deletePipelineResolver).toHaveBeenCalledTimes(1);
    // Services should NOT be deleted
    expect(client.deletePipelineService).not.toHaveBeenCalled();
  });

  test("delete-services phase deletes ONLY services", async () => {
    const client = createMockClientWithSpies();
    const planResult = createMockPlanResult();

    await applyPipeline(client, planResult, "delete-services");

    // Resolvers should NOT be deleted
    expect(client.deletePipelineResolver).not.toHaveBeenCalled();
    // Services should be deleted
    expect(client.deletePipelineService).toHaveBeenCalledTimes(1);
  });

  test("create-update phase does not delete anything", async () => {
    const client = createMockClientWithSpies();
    const planResult = createMockPlanResult();

    await applyPipeline(client, planResult, "create-update");

    // No deletes should happen in create-update phase
    expect(client.deletePipelineResolver).not.toHaveBeenCalled();
    expect(client.deletePipelineService).not.toHaveBeenCalled();
  });
});
