import { describe, test, expect, vi, beforeEach } from "vitest";
import { sdkNameLabelKey } from "./label";
import { applyPipeline, formatResolverChangeEntries, planPipeline } from "./resolver";
import type { PlanContext } from "./apply";
import type { Application } from "@/cli/services/application";
import type { ExecutorService } from "@/cli/services/executor/service";
import type { ResolverService } from "@/cli/services/resolver/service";
import type { OperatorClient } from "@/cli/shared/client";
import type { LoadedConfig } from "@/cli/shared/config-loader";

// Mock config values for tests
const mockConfig = { path: "/test/tailor.config.ts" } as LoadedConfig;

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

describe("planPipeline (resolver service level)", () => {
  const workspaceId = "test-workspace";
  const appName = "test-app";

  // Helper to create mock resolver service
  function createMockResolverService(namespace: string): ResolverService {
    return {
      namespace,
      config: {},
      resolvers: {},
      loadResolvers: vi.fn().mockResolvedValue(undefined),
    } as unknown as ResolverService;
  }

  // Helper to create mock executor service
  function createMockExecutorService(): ExecutorService {
    return {
      config: {},
      executors: {},
      loadExecutors: vi.fn().mockResolvedValue({}),
    } as unknown as ExecutorService;
  }

  // Helper to create mock client
  function createMockClient(
    existingServices: Array<{
      name: string;
      label?: string;
      sdkVersion?: string;
    }>,
    existingResolvers: Record<string, Array<Record<string, unknown>>> = {},
    resolverDetails: Record<string, Record<string, unknown>> = {},
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
      getPipelineResolver: vi
        .fn()
        .mockImplementation(
          ({ namespaceName, resolverName }: { namespaceName: string; resolverName: string }) => ({
            pipelineResolver:
              resolverDetails[`${namespaceName}:${resolverName}`] ??
              (existingResolvers[namespaceName] || []).find(
                (resolver) => resolver.name === resolverName,
              ),
          }),
        ),
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
        config: mockConfig,
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
        config: mockConfig,
      };

      const result = await planPipeline(ctx);

      // "resolver-a" should be unchanged
      expect(result.changeSet.service.unchanged).toHaveLength(1);
      expect(result.changeSet.service.unchanged[0].name).toBe("resolver-a");

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
        config: mockConfig,
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
        config: mockConfig,
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
        config: mockConfig,
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
        config: mockConfig,
      };

      const result = await planPipeline(ctx);

      expect(result.changeSet.service.deletes).toHaveLength(1);
      expect(result.changeSet.service.deletes[0].name).toBe("my-resolver");
      expect(result.resourceOwners.has("other-app")).toBe(true);
    });

    test("service is updated when sdk version differs", async () => {
      const client = createMockClient([
        { name: "resolver-a", label: appName, sdkVersion: "v0-9-0" },
      ]);

      const application = createMockApplication([createMockResolverService("resolver-a")]);

      const ctx: PlanContext = {
        client,
        workspaceId,
        application,
        forRemoval: false,
        config: mockConfig,
      };

      const result = await planPipeline(ctx);

      expect(result.changeSet.service.updates).toHaveLength(1);
      expect(result.changeSet.service.unchanged).toHaveLength(0);
    });
  });

  describe("resolver no-op detection", () => {
    test("resolver is unchanged when remote definition matches desired definition", async () => {
      const resolver = {
        name: "test-resolver",
        operation: 0,
        output: {
          type: "string",
          metadata: {},
        },
      };
      const pipeline = {
        namespace: "my-resolver",
        config: {},
        resolvers: { [resolver.name]: resolver },
        loadResolvers: vi.fn().mockResolvedValue(undefined),
      } as unknown as ResolverService;

      const createClient = createMockClient([]);
      const createResult = await planPipeline({
        client: createClient,
        workspaceId,
        application: createMockApplication([pipeline]),
        forRemoval: false,
        config: mockConfig,
      });
      const desiredResolver = createResult.changeSet.resolver.creates[0].request.pipelineResolver;

      const client = createMockClient([{ name: "my-resolver", label: appName }], {
        "my-resolver": [desiredResolver as Record<string, unknown>],
      });
      const result = await planPipeline({
        client,
        workspaceId,
        application: createMockApplication([pipeline]),
        forRemoval: false,
        config: mockConfig,
      });

      expect(result.changeSet.resolver.unchanged).toHaveLength(1);
      expect(result.changeSet.resolver.unchanged[0].name).toBe("test-resolver");
      expect(result.changeSet.resolver.updates).toHaveLength(0);
    });

    test("resolver is unchanged when list response is summary-only but get returns full definition", async () => {
      const resolver = {
        name: "test-resolver",
        operation: 0,
        body: () => "hello",
        output: {
          type: "string",
          metadata: {},
        },
      };
      const pipeline = {
        namespace: "my-resolver",
        config: {},
        resolvers: { [resolver.name]: resolver },
        loadResolvers: vi.fn().mockResolvedValue(undefined),
      } as unknown as ResolverService;

      const createClient = createMockClient([]);
      const createResult = await planPipeline({
        client: createClient,
        workspaceId,
        application: createMockApplication([pipeline]),
        forRemoval: false,
        config: mockConfig,
      });
      const desiredResolver = createResult.changeSet.resolver.creates[0].request.pipelineResolver;

      const client = createMockClient(
        [{ name: "my-resolver", label: appName }],
        {
          "my-resolver": [{ name: "test-resolver" }],
        },
        {
          "my-resolver:test-resolver": desiredResolver as Record<string, unknown>,
        },
      );
      const result = await planPipeline({
        client,
        workspaceId,
        application: createMockApplication([pipeline]),
        forRemoval: false,
        config: mockConfig,
      });

      expect(result.changeSet.resolver.unchanged).toHaveLength(1);
      expect(result.changeSet.resolver.unchanged[0].name).toBe("test-resolver");
      expect(result.changeSet.resolver.updates).toHaveLength(0);
    });

    test("resolver is updated when forceApplyAll is enabled", async () => {
      const resolver = {
        name: "test-resolver",
        operation: 0,
        body: () => "hello",
        output: {
          type: "string",
          metadata: {},
        },
      };
      const pipeline = {
        namespace: "my-resolver",
        config: {},
        resolvers: { [resolver.name]: resolver },
        loadResolvers: vi.fn().mockResolvedValue(undefined),
      } as unknown as ResolverService;

      const createClient = createMockClient([]);
      const createResult = await planPipeline({
        client: createClient,
        workspaceId,
        application: createMockApplication([pipeline]),
        forRemoval: false,
        config: mockConfig,
      });
      const desiredResolver = createResult.changeSet.resolver.creates[0].request.pipelineResolver;

      const client = createMockClient([{ name: "my-resolver", label: appName }], {
        "my-resolver": [desiredResolver as Record<string, unknown>],
      });
      const result = await planPipeline({
        client,
        workspaceId,
        application: createMockApplication([pipeline]),
        forRemoval: false,
        config: mockConfig,
        forceApplyAll: true,
      });

      expect(result.changeSet.resolver.updates).toHaveLength(1);
      expect(result.changeSet.resolver.unchanged).toHaveLength(0);
    });

    test("resolver is updated when authInvoker differs", async () => {
      const resolver = {
        name: "test-resolver",
        operation: 0,
        body: () => "hello",
        output: {
          type: "string",
          metadata: {},
        },
        authInvoker: { namespace: "my-auth", machineUserName: "batch-user" },
      };
      const pipeline = {
        namespace: "my-resolver",
        config: {},
        resolvers: { [resolver.name]: resolver },
        loadResolvers: vi.fn().mockResolvedValue(undefined),
      } as unknown as ResolverService;

      const createClient = createMockClient([]);
      const createResult = await planPipeline({
        client: createClient,
        workspaceId,
        application: createMockApplication([pipeline]),
        forRemoval: false,
        config: mockConfig,
      });
      const desiredResolver = structuredClone(
        createResult.changeSet.resolver.creates[0]!.request.pipelineResolver,
      );
      expect(desiredResolver).toBeDefined();
      delete desiredResolver!.pipelines?.[0]?.invoker;

      const client = createMockClient([{ name: "my-resolver", label: appName }], {
        "my-resolver": [desiredResolver as Record<string, unknown>],
      });
      const result = await planPipeline({
        client,
        workspaceId,
        application: createMockApplication([pipeline]),
        forRemoval: false,
        config: mockConfig,
      });

      expect(result.changeSet.resolver.updates).toHaveLength(1);
      expect(result.changeSet.resolver.updates[0].name).toBe("test-resolver");
      expect(result.changeSet.resolver.unchanged).toHaveLength(0);
    });
  });
});

describe("processResolver authInvoker mapping", () => {
  const workspaceId = "test-workspace";
  const appName = "test-app";

  function createMockClient(
    existingServices: Array<{
      name: string;
      label?: string;
      sdkVersion?: string;
    }>,
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

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("authInvoker is mapped to proto invoker field", async () => {
    const client = createMockClient([{ name: "test-ns", label: appName }]);

    const resolverService = {
      namespace: "test-ns",
      config: {},
      resolvers: {
        myResolver: {
          name: "myResolver",
          operation: "query",
          body: () => "hello",
          output: { type: "string", metadata: {}, fields: {} },
          authInvoker: { namespace: "my-auth", machineUserName: "batch-user" },
        },
      },
      loadResolvers: vi.fn().mockResolvedValue(undefined),
    } as unknown as ResolverService;

    const application = {
      name: appName,
      env: {},
      resolverServices: [resolverService],
      executorService: {
        config: {},
        executors: {},
        loadExecutors: vi.fn().mockResolvedValue({}),
      },
    } as unknown as Application;

    const ctx: PlanContext = {
      client,
      workspaceId,
      application,
      forRemoval: false,
      config: { path: "/test/tailor.config.ts" } as LoadedConfig,
    };

    const result = await planPipeline(ctx);

    const resolverCreate = result.changeSet.resolver.creates[0];
    expect(resolverCreate).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proto = (resolverCreate as any).request.pipelineResolver;
    expect(proto.pipelines[0].invoker).toEqual({
      namespace: "my-auth",
      machineUserName: "batch-user",
    });
  });

  test("invoker is undefined when authInvoker is not set", async () => {
    const client = createMockClient([{ name: "test-ns", label: appName }]);

    const resolverService = {
      namespace: "test-ns",
      config: {},
      resolvers: {
        myResolver: {
          name: "myResolver",
          operation: "query",
          body: () => "hello",
          output: { type: "string", metadata: {}, fields: {} },
        },
      },
      loadResolvers: vi.fn().mockResolvedValue(undefined),
    } as unknown as ResolverService;

    const application = {
      name: appName,
      env: {},
      resolverServices: [resolverService],
      executorService: {
        config: {},
        executors: {},
        loadExecutors: vi.fn().mockResolvedValue({}),
      },
    } as unknown as Application;

    const ctx: PlanContext = {
      client,
      workspaceId,
      application,
      forRemoval: false,
      config: { path: "/test/tailor.config.ts" } as LoadedConfig,
    };

    const result = await planPipeline(ctx);

    const resolverCreate = result.changeSet.resolver.creates[0];
    expect(resolverCreate).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proto = (resolverCreate as any).request.pipelineResolver;
    expect(proto.pipelines[0].invoker).toBeUndefined();
  });
});

describe("formatResolverChangeEntries", () => {
  test("groups resolver updates with related function registry updates", () => {
    const entries = formatResolverChangeEntries(
      {
        creates: [],
        updates: [
          {
            name: "add",
            request: {
              workspaceId: "ws",
              namespaceName: "my-resolver",
            },
          },
        ],
        deletes: [],
        replaces: [],
      },
      {
        creates: [],
        updates: [{ name: "resolver--my-resolver--add" }],
        deletes: [],
        replaces: [],
      },
    );

    expect(entries).toEqual([
      {
        action: "update",
        symbol: "~",
        name: "add",
        labels: ["resolver", "functionRegistry"],
      },
    ]);
  });

  test("groups resolver deletes with related function registry deletes", () => {
    const entries = formatResolverChangeEntries(
      {
        creates: [],
        updates: [],
        deletes: [
          {
            name: "add",
            request: {
              workspaceId: "ws",
              namespaceName: "my-resolver",
            },
          },
        ],
        replaces: [],
      },
      {
        creates: [],
        updates: [],
        deletes: [{ name: "resolver--my-resolver--add" }],
        replaces: [],
      },
    );

    expect(entries).toEqual([
      {
        action: "delete",
        symbol: "-",
        name: "add",
        labels: ["resolver", "functionRegistry"],
      },
    ]);
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
