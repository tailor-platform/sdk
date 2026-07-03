import { describe, test, expect, vi, beforeEach } from "vitest";
import { sdkNameLabelKey } from "./label";
import { applyPipeline, formatResolverChangeEntries, planPipeline } from "./resolver";
import type { Application } from "#/cli/services/application";
import type { ExecutorService } from "#/cli/services/executor/service";
import type { ResolverService } from "#/cli/services/resolver/service";
import type { OperatorClient } from "#/cli/shared/client";
import type { LoadedConfig } from "#/cli/shared/config-loader";
import type { PlanContext } from "./types";

const mockConfig = { path: "/test/tailor.config.ts" } as LoadedConfig;

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
      lines: () => [],
    }),
  };
});

const workspaceId = "test-workspace";
const appName = "test-app";

function createMockExecutorService(): ExecutorService {
  return {
    config: {},
    executors: {},
    loadExecutors: vi.fn().mockResolvedValue({}),
  } as unknown as ExecutorService;
}

function createMockResolverService(namespace: string): ResolverService {
  return {
    namespace,
    config: {},
    resolvers: {},
    loadResolvers: vi.fn().mockResolvedValue(undefined),
  } as unknown as ResolverService;
}

function createMockApplication(
  resolverServices: ResolverService[],
  extra: Record<string, unknown> = {},
): Application {
  return {
    name: appName,
    env: {},
    resolverServices,
    executorService: createMockExecutorService(),
    ...extra,
  } as unknown as Application;
}

function createMockClient(
  existingServices: Array<{ name: string; label?: string; sdkVersion?: string }>,
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
        pipelineResolvers: existingResolvers[namespaceName] ?? [],
        nextPageToken: "",
      })),
    getPipelineResolver: vi
      .fn()
      .mockImplementation(
        ({ namespaceName, resolverName }: { namespaceName: string; resolverName: string }) => ({
          pipelineResolver:
            resolverDetails[`${namespaceName}:${resolverName}`] ??
            (existingResolvers[namespaceName] ?? []).find(
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

function buildCtx(overrides: Partial<PlanContext>): PlanContext {
  return {
    client: createMockClient([]),
    workspaceId,
    application: createMockApplication([]),
    forRemoval: false,
    config: mockConfig,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("planPipeline (resolver service level)", () => {
  describe("rename scenarios (service level)", () => {
    test("old service is deleted when renamed", async () => {
      const client = createMockClient([{ name: "old-resolver", label: appName }]);
      const application = createMockApplication([createMockResolverService("new-resolver")]);

      const result = await planPipeline(buildCtx({ client, application }));

      expect(result.changeSet.service.creates).toHaveLength(1);
      expect(result.changeSet.service.creates[0]!.name).toBe("new-resolver");
      expect(result.changeSet.service.deletes).toHaveLength(1);
      expect(result.changeSet.service.deletes[0]!.name).toBe("old-resolver");
    });
  });

  describe("delete scenarios (service level)", () => {
    test("service is deleted when removed from config", async () => {
      const client = createMockClient([
        { name: "resolver-a", label: appName },
        { name: "resolver-b", label: appName },
      ]);
      const application = createMockApplication([createMockResolverService("resolver-a")]);

      const result = await planPipeline(buildCtx({ client, application }));

      expect(result.changeSet.service.unchanged).toHaveLength(1);
      expect(result.changeSet.service.unchanged[0]!.name).toBe("resolver-a");
      expect(result.changeSet.service.deletes).toHaveLength(1);
      expect(result.changeSet.service.deletes[0]!.name).toBe("resolver-b");
    });

    test("all services are deleted when config is empty", async () => {
      const client = createMockClient([
        { name: "resolver-1", label: appName },
        { name: "resolver-2", label: appName },
      ]);

      const result = await planPipeline(buildCtx({ client }));

      expect(result.changeSet.service.deletes).toHaveLength(2);
      expect(result.changeSet.service.deletes.map((d) => d.name).toSorted()).toEqual([
        "resolver-1",
        "resolver-2",
      ]);
    });
  });

  describe("label ownership scenarios (service level)", () => {
    test("service without label is NOT deleted", async () => {
      const client = createMockClient([{ name: "unmanaged-resolver" }]);

      const result = await planPipeline(buildCtx({ client }));

      expect(result.changeSet.service.deletes).toHaveLength(0);
    });

    test("service owned by different app is NOT deleted", async () => {
      const client = createMockClient([{ name: "other-resolver", label: "other-app" }]);

      const result = await planPipeline(buildCtx({ client }));

      expect(result.changeSet.service.deletes).toHaveLength(0);
      expect(result.resourceOwners.has("other-app")).toBe(true);
    });

    test("mixed ownership - only delete own services", async () => {
      const client = createMockClient([
        { name: "my-resolver", label: appName },
        { name: "other-resolver", label: "other-app" },
        { name: "unmanaged-resolver" },
      ]);

      const result = await planPipeline(buildCtx({ client }));

      expect(result.changeSet.service.deletes).toHaveLength(1);
      expect(result.changeSet.service.deletes[0]!.name).toBe("my-resolver");
      expect(result.resourceOwners.has("other-app")).toBe(true);
    });

    test("service is updated when sdk version differs", async () => {
      const client = createMockClient([
        { name: "resolver-a", label: appName, sdkVersion: "v0-9-0" },
      ]);
      const application = createMockApplication([createMockResolverService("resolver-a")]);

      const result = await planPipeline(buildCtx({ client, application }));

      expect(result.changeSet.service.updates).toHaveLength(1);
      expect(result.changeSet.service.unchanged).toHaveLength(0);
    });
  });

  describe("resolver no-op detection", () => {
    function createPipeline(resolver: Record<string, unknown>): ResolverService {
      return {
        namespace: "my-resolver",
        config: {},
        resolvers: { [resolver.name as string]: resolver },
        loadResolvers: vi.fn().mockResolvedValue(undefined),
      } as unknown as ResolverService;
    }

    // Plans against an empty workspace to derive the exact desired resolver definition,
    // so tests can feed it back in as the "existing remote state".
    async function getDesiredResolver(pipeline: ResolverService) {
      const createResult = await planPipeline(
        buildCtx({ client: createMockClient([]), application: createMockApplication([pipeline]) }),
      );
      return createResult.changeSet.resolver.creates[0]!.request.pipelineResolver;
    }

    test("resolver is unchanged when remote definition matches desired definition", async () => {
      const pipeline = createPipeline({
        name: "test-resolver",
        operation: 0,
        output: { type: "string", metadata: {} },
      });
      const desiredResolver = await getDesiredResolver(pipeline);

      const client = createMockClient([{ name: "my-resolver", label: appName }], {
        "my-resolver": [desiredResolver as Record<string, unknown>],
      });
      const result = await planPipeline(
        buildCtx({ client, application: createMockApplication([pipeline]) }),
      );

      expect(result.changeSet.resolver.unchanged).toHaveLength(1);
      expect(result.changeSet.resolver.unchanged[0]!.name).toBe("test-resolver");
      expect(result.changeSet.resolver.updates).toHaveLength(0);
    });

    test("resolver is unchanged when list response is summary-only but get returns full definition", async () => {
      const pipeline = createPipeline({
        name: "test-resolver",
        operation: 0,
        body: () => "hello",
        output: { type: "string", metadata: {} },
      });
      const desiredResolver = await getDesiredResolver(pipeline);

      const client = createMockClient(
        [{ name: "my-resolver", label: appName }],
        { "my-resolver": [{ name: "test-resolver" }] },
        { "my-resolver:test-resolver": desiredResolver as Record<string, unknown> },
      );
      const result = await planPipeline(
        buildCtx({ client, application: createMockApplication([pipeline]) }),
      );

      expect(result.changeSet.resolver.unchanged).toHaveLength(1);
      expect(result.changeSet.resolver.unchanged[0]!.name).toBe("test-resolver");
      expect(result.changeSet.resolver.updates).toHaveLength(0);
    });

    test("resolver is updated when forceApplyAll is enabled", async () => {
      const pipeline = createPipeline({
        name: "test-resolver",
        operation: 0,
        body: () => "hello",
        output: { type: "string", metadata: {} },
      });
      const desiredResolver = await getDesiredResolver(pipeline);

      const client = createMockClient([{ name: "my-resolver", label: appName }], {
        "my-resolver": [desiredResolver as Record<string, unknown>],
      });
      const result = await planPipeline(
        buildCtx({
          client,
          application: createMockApplication([pipeline]),
          forceApplyAll: true,
        }),
      );

      expect(result.changeSet.resolver.updates).toHaveLength(1);
      expect(result.changeSet.resolver.unchanged).toHaveLength(0);
    });

    test("resolver is updated when invoker differs", async () => {
      const pipeline = createPipeline({
        name: "test-resolver",
        operation: 0,
        body: () => "hello",
        output: { type: "string", metadata: {} },
        invoker: { namespace: "my-auth", machineUserName: "batch-user" },
      });
      const desiredResolver = structuredClone(await getDesiredResolver(pipeline));
      expect(desiredResolver).toBeDefined();
      delete desiredResolver!.pipelines?.[0]?.invoker;

      const client = createMockClient([{ name: "my-resolver", label: appName }], {
        "my-resolver": [desiredResolver as Record<string, unknown>],
      });
      const result = await planPipeline(
        buildCtx({ client, application: createMockApplication([pipeline]) }),
      );

      expect(result.changeSet.resolver.updates).toHaveLength(1);
      expect(result.changeSet.resolver.updates[0]!.name).toBe("test-resolver");
      expect(result.changeSet.resolver.unchanged).toHaveLength(0);
    });
  });
});

describe("processResolver invoker mapping", () => {
  function createResolverServiceWithAuthInvoker(
    invoker?: Record<string, unknown> | string,
  ): ResolverService {
    return {
      namespace: "test-ns",
      config: {},
      resolvers: {
        myResolver: {
          name: "myResolver",
          operation: "query",
          body: () => "hello",
          output: { type: "string", metadata: {}, fields: {} },
          ...(invoker !== undefined ? { invoker } : {}),
        },
      },
      loadResolvers: vi.fn().mockResolvedValue(undefined),
    } as unknown as ResolverService;
  }

  async function planWithResolverService(
    resolverService: ResolverService,
    extraApplicationFields: Record<string, unknown> = {},
  ) {
    const client = createMockClient([{ name: "test-ns", label: appName }]);
    const application = createMockApplication([resolverService], extraApplicationFields);
    return planPipeline(buildCtx({ client, application }));
  }

  test("invoker is mapped to proto invoker field", async () => {
    const resolverService = createResolverServiceWithAuthInvoker({
      namespace: "my-auth",
      machineUserName: "batch-user",
    });

    const result = await planWithResolverService(resolverService);

    const resolverCreate = result.changeSet.resolver.creates[0];
    expect(resolverCreate).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proto = (resolverCreate as any).request.pipelineResolver;
    expect(proto.pipelines[0].invoker).toEqual({
      namespace: "my-auth",
      machineUserName: "batch-user",
    });
  });

  test("string invoker is normalized using the configured auth service name", async () => {
    const resolverService = createResolverServiceWithAuthInvoker("batch-user");

    const result = await planWithResolverService(resolverService, {
      authService: { config: { name: "my-auth" } },
    });

    const resolverCreate = result.changeSet.resolver.creates[0];
    expect(resolverCreate).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proto = (resolverCreate as any).request.pipelineResolver;
    expect(proto.pipelines[0].invoker).toEqual({
      namespace: "my-auth",
      machineUserName: "batch-user",
    });
  });

  test("string invoker without auth service configured throws", async () => {
    const resolverService = createResolverServiceWithAuthInvoker("batch-user");

    await expect(planWithResolverService(resolverService)).rejects.toThrow(
      /no Auth service is configured/,
    );
  });

  test("invoker is undefined when invoker is not set", async () => {
    const resolverService = createResolverServiceWithAuthInvoker();

    const result = await planWithResolverService(resolverService);

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
        updates: [{ name: "add", request: { workspaceId: "ws", namespaceName: "my-resolver" } }],
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
        labels: ["resolver", "function"],
        namespace: "my-resolver",
      },
    ]);
  });

  test("groups resolver deletes with related function registry deletes", () => {
    const entries = formatResolverChangeEntries(
      {
        creates: [],
        updates: [],
        deletes: [{ name: "add", request: { workspaceId: "ws", namespaceName: "my-resolver" } }],
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
        labels: ["resolver", "function"],
        namespace: "my-resolver",
      },
    ]);
  });
});

describe("applyPipeline phase separation", () => {
  function createMockClientWithSpies() {
    return {
      deletePipelineResolver: vi.fn().mockResolvedValue({}),
      deletePipelineService: vi.fn().mockResolvedValue({}),
      createPipelineService: vi.fn().mockResolvedValue({}),
      createPipelineResolver: vi.fn().mockResolvedValue({}),
      updatePipelineResolver: vi.fn().mockResolvedValue({}),
      setMetadata: vi.fn().mockResolvedValue({}),
    } as unknown as OperatorClient;
  }

  function createMockPlanResult() {
    return {
      changeSet: {
        service: {
          creates: [],
          updates: [],
          deletes: [
            {
              name: "test-pipeline",
              request: { workspaceId: "test-workspace", namespaceName: "test-pipeline" },
            },
          ],
          title: "Pipeline Services",
          isEmpty: () => false,
          lines: () => [],
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
          lines: () => [],
        },
      },
      conflicts: [],
      unmanaged: [],
      resourceOwners: new Set<string>(),
    } as unknown as Awaited<ReturnType<typeof planPipeline>>;
  }

  test("delete-resources phase deletes resolvers, but NOT services", async () => {
    const client = createMockClientWithSpies();

    await applyPipeline(client, createMockPlanResult(), "delete-resources");

    expect(client.deletePipelineResolver).toHaveBeenCalledTimes(1);
    expect(client.deletePipelineService).not.toHaveBeenCalled();
  });

  test("delete-services phase deletes ONLY services", async () => {
    const client = createMockClientWithSpies();

    await applyPipeline(client, createMockPlanResult(), "delete-services");

    expect(client.deletePipelineResolver).not.toHaveBeenCalled();
    expect(client.deletePipelineService).toHaveBeenCalledTimes(1);
  });

  test("create-update phase does not delete anything", async () => {
    const client = createMockClientWithSpies();

    await applyPipeline(client, createMockPlanResult(), "create-update");

    expect(client.deletePipelineResolver).not.toHaveBeenCalled();
    expect(client.deletePipelineService).not.toHaveBeenCalled();
  });
});
