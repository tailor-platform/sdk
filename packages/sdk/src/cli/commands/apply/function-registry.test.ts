import { describe, test, expect, vi, beforeEach } from "vitest";
import {
  applyFunctionRegistry,
  executorFunctionName,
  planFunctionRegistry,
  resolverFunctionName,
  workflowJobFunctionName,
} from "./function-registry";
import { sdkNameLabelKey } from "./label";
import type { FunctionEntry } from "./function-registry";
import type { OperatorClient } from "@/cli/shared/client";

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
      print: () => {},
    }),
  };
});

describe("naming functions", () => {
  test("resolverFunctionName", () => {
    expect(resolverFunctionName("my-resolver", "getUser")).toBe("resolver--my-resolver--getUser");
  });

  test("executorFunctionName", () => {
    expect(executorFunctionName("user-created")).toBe("executor--user-created");
  });

  test("workflowJobFunctionName", () => {
    expect(workflowJobFunctionName("process-order")).toBe("workflow--process-order");
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
    existingFunctions: Array<{ name: string; contentHash: string; label?: string }>,
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
            labels: func?.label ? { [sdkNameLabelKey]: func.label } : {},
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

      await planFunctionRegistry(client, workspaceId, appName, entries);

      expect(client.listFunctionRegistries).toHaveBeenCalledWith(
        expect.objectContaining({ pageSize: expect.any(Number) }),
      );
    });
  });

  describe("create scenarios", () => {
    test("new function is created when no existing entries", async () => {
      const client = createMockClient([]);
      const entries = [createEntry("resolver/ns/getUser")];

      const result = await planFunctionRegistry(client, workspaceId, appName, entries);

      expect(result.changeSet.creates).toHaveLength(1);
      expect(result.changeSet.creates[0].name).toBe("resolver/ns/getUser");
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

      const result = await planFunctionRegistry(client, workspaceId, appName, entries);

      expect(result.changeSet.creates).toHaveLength(3);
      expect(result.changeSet.creates.map((c) => c.name).sort()).toEqual([
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

      const result = await planFunctionRegistry(client, workspaceId, appName, entries);

      expect(result.changeSet.updates).toHaveLength(1);
      expect(result.changeSet.updates[0].name).toBe("resolver/ns/getUser");
      expect(result.changeSet.creates).toHaveLength(0);
      expect(result.changeSet.deletes).toHaveLength(0);
    });

    test("existing function is updated even when content hash matches", async () => {
      const entry = createEntry("resolver/ns/getUser");
      const client = createMockClient([
        { name: "resolver/ns/getUser", contentHash: entry.contentHash, label: appName },
      ]);

      const result = await planFunctionRegistry(client, workspaceId, appName, [entry]);

      expect(result.changeSet.updates).toHaveLength(0);
      expect(result.changeSet.unchanged).toHaveLength(1);
      expect(result.changeSet.unchanged[0].name).toBe("resolver/ns/getUser");
      expect(result.changeSet.creates).toHaveLength(0);
      expect(result.changeSet.deletes).toHaveLength(0);
    });

    test("matching function content is updated when ownership metadata is missing", async () => {
      const entry = createEntry("resolver/ns/getUser");
      const client = createMockClient([
        { name: "resolver/ns/getUser", contentHash: entry.contentHash },
      ]);

      const result = await planFunctionRegistry(client, workspaceId, appName, [entry]);

      expect(result.changeSet.updates).toHaveLength(1);
      expect(result.changeSet.unchanged).toHaveLength(0);
      expect(result.unmanaged).toHaveLength(1);
    });

    test("matching function content is updated when owned by another app", async () => {
      const entry = createEntry("resolver/ns/getUser");
      const client = createMockClient([
        { name: "resolver/ns/getUser", contentHash: entry.contentHash, label: "other-app" },
      ]);

      const result = await planFunctionRegistry(client, workspaceId, appName, [entry]);

      expect(result.changeSet.updates).toHaveLength(1);
      expect(result.changeSet.unchanged).toHaveLength(0);
      expect(result.conflicts).toHaveLength(1);
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

      const result = await planFunctionRegistry(client, workspaceId, appName, entries);

      expect(result.changeSet.updates).toHaveLength(0);
      expect(result.changeSet.unchanged).toHaveLength(1);
      expect(result.changeSet.unchanged[0].name).toBe("resolver/ns/getUser");
      expect(result.changeSet.deletes).toHaveLength(1);
      expect(result.changeSet.deletes[0].name).toBe("resolver/ns/listUsers");
    });

    test("all functions are deleted when entries is empty", async () => {
      const client = createMockClient([
        { name: "resolver/ns/getUser", contentHash: "hash", label: appName },
        { name: "executor/my-executor", contentHash: "hash", label: appName },
      ]);

      const result = await planFunctionRegistry(client, workspaceId, appName, []);

      expect(result.changeSet.deletes).toHaveLength(2);
      expect(result.changeSet.deletes.map((d) => d.name).sort()).toEqual([
        "executor/my-executor",
        "resolver/ns/getUser",
      ]);
    });
  });

  describe("label ownership scenarios", () => {
    test("function without label is NOT deleted", async () => {
      const client = createMockClient([
        { name: "resolver/ns/unmanaged", contentHash: "hash" }, // No label
      ]);

      const result = await planFunctionRegistry(client, workspaceId, appName, []);

      expect(result.changeSet.deletes).toHaveLength(0);
    });

    test("function owned by different app is NOT deleted", async () => {
      const client = createMockClient([
        { name: "resolver/ns/other", contentHash: "hash", label: "other-app" },
      ]);

      const result = await planFunctionRegistry(client, workspaceId, appName, []);

      expect(result.changeSet.deletes).toHaveLength(0);
      expect(result.resourceOwners.has("other-app")).toBe(true);
    });

    test("mixed ownership - only delete own functions", async () => {
      const client = createMockClient([
        { name: "resolver/ns/mine", contentHash: "hash", label: appName },
        { name: "resolver/ns/other", contentHash: "hash", label: "other-app" },
        { name: "resolver/ns/unmanaged", contentHash: "hash" }, // No label
      ]);

      const result = await planFunctionRegistry(client, workspaceId, appName, []);

      expect(result.changeSet.deletes).toHaveLength(1);
      expect(result.changeSet.deletes[0].name).toBe("resolver/ns/mine");
      expect(result.resourceOwners.has("other-app")).toBe(true);
    });
  });

  describe("conflict and unmanaged detection", () => {
    test("detects unmanaged resource when entry targets existing function without label", async () => {
      const client = createMockClient([
        { name: "resolver/ns/getUser", contentHash: "hash" }, // No label
      ]);
      const entries = [createEntry("resolver/ns/getUser")];

      const result = await planFunctionRegistry(client, workspaceId, appName, entries);

      expect(result.unmanaged).toHaveLength(1);
      expect(result.unmanaged[0].resourceName).toBe("resolver/ns/getUser");
      expect(result.unmanaged[0].resourceType).toBe("Function registry");
    });

    test("detects conflict when entry targets function owned by different app", async () => {
      const client = createMockClient([
        { name: "resolver/ns/getUser", contentHash: "hash", label: "other-app" },
      ]);
      const entries = [createEntry("resolver/ns/getUser")];

      const result = await planFunctionRegistry(client, workspaceId, appName, entries);

      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].resourceName).toBe("resolver/ns/getUser");
      expect(result.conflicts[0].currentOwner).toBe("other-app");
    });
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
        print: () => {},
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
