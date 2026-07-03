import { describe, test, expect, vi, beforeEach } from "vitest";
import {
  applyFunctionRegistry,
  authHookFunctionName,
  collectFunctionEntries,
  executorFunctionName,
  planFunctionRegistry,
  resolverFunctionName,
  splitFunctionRegistryChanges,
  workflowJobFunctionName,
} from "./function-registry";
import { sdkNameLabelKey } from "./label";
import type { Application } from "#/cli/services/application";
import type { CollectedJob } from "#/cli/services/workflow/service";
import type { OperatorClient } from "#/cli/shared/client";
import type { BundledScripts, FunctionEntry } from "./function-registry";

// Mock label.ts
vi.mock("./label", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const original = (await importOriginal()) as typeof import("./label");
  return {
    ...original,
    buildMetaRequest: vi.fn().mockResolvedValue({
      trn: "trn:v1:workspace:test-workspace:function_registry:test",
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

describe("naming functions", () => {
  test.each([
    [
      "resolverFunctionName",
      () => resolverFunctionName("my-resolver", "getUser"),
      "resolver--my-resolver--getUser",
    ],
    ["executorFunctionName", () => executorFunctionName("user-created"), "executor--user-created"],
    [
      "workflowJobFunctionName",
      () => workflowJobFunctionName("process-order"),
      "workflow--process-order",
    ],
  ] as const)("%s", (_name, fn, expected) => {
    expect(fn()).toBe(expected);
  });
});

describe("planFunctionRegistry", () => {
  const workspaceId = "test-workspace";
  const appName = "test-app";

  function createEntry(name: string, content = "// script"): FunctionEntry {
    return {
      name,
      scriptContent: content,
      contentHash: `hash-${name}`,
      description: `Function: ${name}`,
    };
  }

  function createMockClient(
    existingFunctions: Array<{
      name: string;
      contentHash: string;
      label?: string;
      sdkVersion?: string;
    }>,
  ): OperatorClient {
    return {
      listFunctionRegistries: vi.fn().mockResolvedValue({
        functions: existingFunctions.map((f) => ({
          name: f.name,
          contentHash: f.contentHash,
        })),
        nextPageToken: "",
      }),
      getMetadata: vi.fn().mockImplementation(({ trn }: { trn: string }) => {
        // TRN format: trn:v1:workspace:{workspaceId}:function_registry:{name}
        // Name may contain colons (e.g., "resolver/ns/getUser"), so extract after the prefix
        const prefix = `trn:v1:workspace:${workspaceId}:function_registry:`;
        const name = trn.startsWith(prefix) ? trn.slice(prefix.length) : trn.split(":").pop();
        const func = existingFunctions.find((f) => f.name === name);
        return {
          metadata: {
            labels: func?.label
              ? {
                  [sdkNameLabelKey]: func.label,
                  "sdk-version": func.sdkVersion ?? "v1-0-0",
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

  describe("pagination", () => {
    test("passes maxPageSize from fetchAll as pageSize", async () => {
      const client = createMockClient([]);
      const entries = [createEntry("resolver/ns/getUser")];

      await planFunctionRegistry(client, workspaceId, appName, undefined, entries);

      expect(client.listFunctionRegistries).toHaveBeenCalledWith(
        expect.objectContaining({ pageSize: expect.any(Number) }),
      );
    });
  });

  describe("create scenarios", () => {
    test("new function is created when no existing entries", async () => {
      const client = createMockClient([]);
      const entries = [createEntry("resolver/ns/getUser")];

      const result = await planFunctionRegistry(client, workspaceId, appName, undefined, entries);

      expect(result.changeSet.creates).toHaveLength(1);
      expect(result.changeSet.creates[0]!.name).toBe("resolver/ns/getUser");
      expect(result.changeSet.updates).toHaveLength(0);
      expect(result.changeSet.deletes).toHaveLength(0);
    });

    test("multiple new functions are created", async () => {
      const client = createMockClient([]);
      const entries = [
        createEntry("resolver/ns/getUser"),
        createEntry("executor/user-created"),
        createEntry("workflow-job/process-order"),
      ];

      const result = await planFunctionRegistry(client, workspaceId, appName, undefined, entries);

      expect(result.changeSet.creates).toHaveLength(3);
      expect(result.changeSet.creates.map((c) => c.name).toSorted()).toEqual([
        "executor/user-created",
        "resolver/ns/getUser",
        "workflow-job/process-order",
      ]);
    });
  });

  describe("update scenarios", () => {
    test("existing function is updated when content hash differs", async () => {
      const client = createMockClient([
        { name: "resolver/ns/getUser", contentHash: "old-hash", label: appName },
      ]);
      const entries = [createEntry("resolver/ns/getUser", "// new script")];

      const result = await planFunctionRegistry(client, workspaceId, appName, undefined, entries);

      expect(result.changeSet.updates).toHaveLength(1);
      expect(result.changeSet.updates[0]!.name).toBe("resolver/ns/getUser");
      expect(result.changeSet.creates).toHaveLength(0);
      expect(result.changeSet.deletes).toHaveLength(0);
    });

    test.each([
      ["ownership metadata is missing", {}, { unmanaged: 1, conflicts: 0 }],
      ["owned by another app", { label: "other-app" }, { unmanaged: 0, conflicts: 1 }],
      [
        "sdk version differs",
        { label: appName, sdkVersion: "v0-9-0" },
        { unmanaged: 0, conflicts: 0 },
      ],
    ] as const)(
      "matching function content is updated when %s",
      async (_desc, existingOverrides, expected) => {
        const entry = createEntry("resolver/ns/getUser");
        const client = createMockClient([
          { name: "resolver/ns/getUser", contentHash: entry.contentHash, ...existingOverrides },
        ]);

        const result = await planFunctionRegistry(client, workspaceId, appName, undefined, [entry]);

        expect(result.changeSet.updates).toHaveLength(1);
        expect(result.changeSet.unchanged).toHaveLength(0);
        expect(result.unmanaged).toHaveLength(expected.unmanaged);
        expect(result.conflicts).toHaveLength(expected.conflicts);
      },
    );

    test("existing function is updated even when content hash matches", async () => {
      const entry = createEntry("resolver/ns/getUser");
      const client = createMockClient([
        { name: "resolver/ns/getUser", contentHash: entry.contentHash, label: appName },
      ]);

      const result = await planFunctionRegistry(client, workspaceId, appName, undefined, [entry]);

      expect(result.changeSet.updates).toHaveLength(0);
      expect(result.changeSet.unchanged).toHaveLength(1);
      expect(result.changeSet.unchanged[0]!.name).toBe("resolver/ns/getUser");
      expect(result.changeSet.creates).toHaveLength(0);
      expect(result.changeSet.deletes).toHaveLength(0);
    });
  });

  describe("delete scenarios", () => {
    test("function is deleted when removed from entries", async () => {
      const existingEntry = createEntry("resolver/ns/getUser");
      const client = createMockClient([
        { name: "resolver/ns/getUser", contentHash: existingEntry.contentHash, label: appName },
        { name: "resolver/ns/listUsers", contentHash: "hash", label: appName },
      ]);

      // Only getUser in entries (listUsers removed)
      const entries = [existingEntry];

      const result = await planFunctionRegistry(client, workspaceId, appName, undefined, entries);

      expect(result.changeSet.updates).toHaveLength(0);
      expect(result.changeSet.unchanged).toHaveLength(1);
      expect(result.changeSet.unchanged[0]!.name).toBe("resolver/ns/getUser");
      expect(result.changeSet.deletes).toHaveLength(1);
      expect(result.changeSet.deletes[0]!.name).toBe("resolver/ns/listUsers");
    });

    test("all functions are deleted when entries is empty", async () => {
      const client = createMockClient([
        { name: "resolver/ns/getUser", contentHash: "hash", label: appName },
        { name: "executor/my-executor", contentHash: "hash", label: appName },
      ]);

      const result = await planFunctionRegistry(client, workspaceId, appName, undefined, []);

      expect(result.changeSet.deletes).toHaveLength(2);
      expect(result.changeSet.deletes.map((d) => d.name).toSorted()).toEqual([
        "executor/my-executor",
        "resolver/ns/getUser",
      ]);
    });
  });

  describe("label ownership scenarios", () => {
    test.each([
      {
        name: "function without label",
        existingFunctions: [{ name: "resolver/ns/unmanaged", contentHash: "hash" }],
        resourceOwners: [],
      },
      {
        name: "function owned by different app",
        existingFunctions: [{ name: "resolver/ns/other", contentHash: "hash", label: "other-app" }],
        resourceOwners: ["other-app"],
      },
    ] as const)("$name is NOT deleted", async ({ existingFunctions, resourceOwners }) => {
      const client = createMockClient([...existingFunctions]);

      const result = await planFunctionRegistry(client, workspaceId, appName, undefined, []);

      expect(result.changeSet.deletes).toHaveLength(0);
      expect([...result.resourceOwners]).toEqual(resourceOwners);
    });

    test("mixed ownership - only delete own functions", async () => {
      const client = createMockClient([
        { name: "resolver/ns/mine", contentHash: "hash", label: appName },
        { name: "resolver/ns/other", contentHash: "hash", label: "other-app" },
        { name: "resolver/ns/unmanaged", contentHash: "hash" }, // No label
      ]);

      const result = await planFunctionRegistry(client, workspaceId, appName, undefined, []);

      expect(result.changeSet.deletes).toHaveLength(1);
      expect(result.changeSet.deletes[0]!.name).toBe("resolver/ns/mine");
      expect(result.resourceOwners.has("other-app")).toBe(true);
    });
  });

  describe("conflict and unmanaged detection", () => {
    test("detects unmanaged resource when entry targets existing function without label", async () => {
      const client = createMockClient([
        { name: "resolver/ns/getUser", contentHash: "hash" }, // No label
      ]);
      const entries = [createEntry("resolver/ns/getUser")];

      const result = await planFunctionRegistry(client, workspaceId, appName, undefined, entries);

      expect(result.unmanaged).toHaveLength(1);
      expect(result.unmanaged[0]!.resourceName).toBe("resolver/ns/getUser");
      expect(result.unmanaged[0]!.resourceType).toBe("Function registry");
    });

    test("detects conflict when entry targets function owned by different app", async () => {
      const client = createMockClient([
        { name: "resolver/ns/getUser", contentHash: "hash", label: "other-app" },
      ]);
      const entries = [createEntry("resolver/ns/getUser")];

      const result = await planFunctionRegistry(client, workspaceId, appName, undefined, entries);

      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0]!.resourceName).toBe("resolver/ns/getUser");
      expect(result.conflicts[0]!.currentOwner).toBe("other-app");
    });
  });
});

describe("splitFunctionRegistryChanges", () => {
  test("separates workflow and resolver functions from other function registry entries", () => {
    const {
      workflowJobChanges,
      resolverFunctionChanges,
      executorFunctionChanges,
      authHookFunctionChanges,
      otherChanges,
    } = splitFunctionRegistryChanges({
      title: "Function registry",
      creates: [
        { name: "workflow--process-order" },
        { name: "resolver--my-resolver--add" },
        { name: "executor--new-function" },
        { name: "auth-hook--my-auth--before-login" },
      ],
      updates: [{ name: "workflow--send-notification" }],
      deletes: [],
      replaces: [],
      unchanged: [{ name: "workflow--check-inventory" }, { name: "executor--user-created" }],
      isEmpty: () => false,
      lines: () => [],
    });

    expect(workflowJobChanges.creates).toEqual([{ name: "workflow--process-order" }]);
    expect(workflowJobChanges.updates).toEqual([{ name: "workflow--send-notification" }]);
    expect(workflowJobChanges.unchanged).toEqual([{ name: "workflow--check-inventory" }]);
    expect(resolverFunctionChanges.creates).toEqual([{ name: "resolver--my-resolver--add" }]);
    expect(executorFunctionChanges.creates).toEqual([{ name: "executor--new-function" }]);
    expect(authHookFunctionChanges.creates).toEqual([{ name: "auth-hook--my-auth--before-login" }]);
    expect(otherChanges.creates).toEqual([]);
    expect(executorFunctionChanges.unchanged).toEqual([{ name: "executor--user-created" }]);
    expect(otherChanges.unchanged).toEqual([]);
  });
});

describe("applyFunctionRegistry phase separation", () => {
  function createMockClientWithSpies() {
    return {
      createFunctionRegistry: vi.fn().mockResolvedValue({}),
      updateFunctionRegistry: vi.fn().mockResolvedValue({}),
      deleteFunctionRegistry: vi.fn().mockResolvedValue({}),
      setMetadata: vi.fn().mockResolvedValue({}),
    } as unknown as OperatorClient;
  }

  function createMockPlanResult() {
    const entry: FunctionEntry = {
      name: "resolver/ns/test",
      scriptContent: "// script",
      contentHash: "hash",
      description: "Test function",
    };
    return {
      changeSet: {
        creates: [
          {
            name: "resolver/ns/create-test",
            entry,
            metaRequest: { trn: "trn:test", labels: {} },
          },
        ],
        updates: [
          {
            name: "resolver/ns/update-test",
            entry,
            metaRequest: { trn: "trn:test", labels: {} },
          },
        ],
        deletes: [
          {
            name: "resolver/ns/delete-test",
            workspaceId: "test-workspace",
          },
        ],
        unchanged: [],
        title: "Function registry",
        isEmpty: () => false,
        lines: () => [],
      },
      conflicts: [],
      unmanaged: [],
      resourceOwners: new Set<string>(),
    } as unknown as Awaited<ReturnType<typeof planFunctionRegistry>>;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("create-update phase uploads functions and sets metadata", async () => {
    const client = createMockClientWithSpies();
    const planResult = createMockPlanResult();

    await applyFunctionRegistry(client, "test-workspace", planResult, "create-update");

    // Creates should call createFunctionRegistry + setMetadata
    expect(client.createFunctionRegistry).toHaveBeenCalledTimes(1);
    // Updates should call updateFunctionRegistry + setMetadata
    expect(client.updateFunctionRegistry).toHaveBeenCalledTimes(1);
    expect(client.setMetadata).toHaveBeenCalledTimes(2);
    // No deletes in create-update phase
    expect(client.deleteFunctionRegistry).not.toHaveBeenCalled();
  });

  test("delete phase deletes functions only", async () => {
    const client = createMockClientWithSpies();
    const planResult = createMockPlanResult();

    await applyFunctionRegistry(client, "test-workspace", planResult, "delete");

    expect(client.deleteFunctionRegistry).toHaveBeenCalledTimes(1);
    expect(client.deleteFunctionRegistry).toHaveBeenCalledWith({
      workspaceId: "test-workspace",
      name: "resolver/ns/delete-test",
    });
    // No creates or updates in delete phase
    expect(client.createFunctionRegistry).not.toHaveBeenCalled();
    expect(client.updateFunctionRegistry).not.toHaveBeenCalled();
    expect(client.setMetadata).not.toHaveBeenCalled();
  });
});

describe("collectFunctionEntries", () => {
  function createBundledScripts(overrides?: Partial<BundledScripts>): BundledScripts {
    return {
      resolvers: overrides?.resolvers ?? new Map(),
      executors: overrides?.executors ?? new Map(),
      workflowJobs: overrides?.workflowJobs ?? new Map(),
      authHooks: overrides?.authHooks ?? new Map(),
    };
  }

  function createMockApplication(overrides?: {
    resolverServices?: Array<{ namespace: string; resolvers: Record<string, { name: string }> }>;
    executorService?: {
      executors: Record<string, { name: string; operation: { kind: string } }>;
    };
    authService?: { config: { name: string; hooks?: { beforeLogin?: unknown } } };
  }): Application {
    const app = {
      name: "test-app",
      config: {} as Application["config"],
      subgraphs: [],
      tailorDBServices: [],
      externalTailorDBNamespaces: [],
      resolverServices: overrides?.resolverServices ?? [],
      idpServices: [],
      authService: overrides?.authService,
      executorService: overrides?.executorService,
      workflowService: undefined,
      staticWebsiteServices: [],
      secrets: [],
      env: {},
      applications: [] as Application[],
    } as unknown as Application;
    // Self-reference for applications array
    (app as unknown as { applications: Application[] }).applications = [app];
    return app;
  }

  test("collects resolver entries with correct names and hashes", () => {
    const scripts = createBundledScripts({
      resolvers: new Map([
        ["getUser", "// getUser code"],
        ["listUsers", "// listUsers code"],
      ]),
    });

    const app = createMockApplication({
      resolverServices: [
        {
          namespace: "my-ns",
          resolvers: {
            getUser: { name: "getUser" },
            listUsers: { name: "listUsers" },
          },
        },
      ],
    });

    const entries = collectFunctionEntries(app, [], scripts);

    expect(entries).toHaveLength(2);
    expect(entries[0]!.name).toBe(resolverFunctionName("my-ns", "getUser"));
    expect(entries[0]!.scriptContent).toBe("// getUser code");
    expect(entries[0]!.contentHash).toBeTruthy();
    expect(entries[0]!.description).toBe("Resolver: my-ns/getUser");
    expect(entries[1]!.name).toBe(resolverFunctionName("my-ns", "listUsers"));
  });

  test("collects executor entries only for function/jobFunction kinds", () => {
    const scripts = createBundledScripts({
      executors: new Map([
        ["on-created", "// executor code"],
        ["gql-exec", "// gql code"],
      ]),
    });

    const app = createMockApplication({
      executorService: {
        executors: {
          "on-created": { name: "on-created", operation: { kind: "function" } },
          "gql-exec": { name: "gql-exec", operation: { kind: "graphql" } },
        },
      },
    });

    const entries = collectFunctionEntries(app, [], scripts);

    expect(entries).toHaveLength(1);
    expect(entries[0]!.name).toBe(executorFunctionName("on-created"));
    expect(entries[0]!.scriptContent).toBe("// executor code");
  });

  test("collects workflow job entries", () => {
    const scripts = createBundledScripts({
      workflowJobs: new Map([["process-order", "// job code"]]),
    });

    const jobs: CollectedJob[] = [
      { name: "process-order", exportName: "processOrder", sourceFile: "workflows/order.ts" },
    ];

    const entries = collectFunctionEntries(createMockApplication(), jobs, scripts);

    expect(entries).toHaveLength(1);
    expect(entries[0]!.name).toBe(workflowJobFunctionName("process-order"));
    expect(entries[0]!.scriptContent).toBe("// job code");
  });

  test("collects auth hook entries", () => {
    const authName = "my-auth";
    const funcName = authHookFunctionName(authName, "before-login");
    const scripts = createBundledScripts({
      authHooks: new Map([[funcName, "// auth hook code"]]),
    });

    const app = createMockApplication({
      authService: {
        config: { name: authName, hooks: { beforeLogin: {} } },
      },
    });

    const entries = collectFunctionEntries(app, [], scripts);

    expect(entries).toHaveLength(1);
    expect(entries[0]!.name).toBe(funcName);
    expect(entries[0]!.description).toBe(`Auth hook: ${authName}/before-login`);
  });

  test("skips entries with missing bundled code and warns", () => {
    using _warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const scripts = createBundledScripts(); // empty maps

    const app = createMockApplication({
      resolverServices: [{ namespace: "ns", resolvers: { missing: { name: "missing" } } }],
    });

    const entries = collectFunctionEntries(app, [], scripts);

    expect(entries).toHaveLength(0);
  });

  test("returns empty array when application has no services", () => {
    const scripts = createBundledScripts();
    const entries = collectFunctionEntries(createMockApplication(), [], scripts);
    expect(entries).toHaveLength(0);
  });
});
