import { describe, test, expect, vi, beforeEach } from "vitest";
import { sdkNameLabelKey } from "./label";
import { applyTailorDB, planTailorDB } from "./tailordb";
import type { PlanContext } from "../index";
import type { Application } from "@/cli/application";
import type { TailorDBService } from "@/cli/application/tailordb/service";
import type { OperatorClient } from "@/cli/client";

// Mock label.ts
vi.mock("./label", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const original = (await importOriginal()) as typeof import("./label");
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

// Mock ChangeSet print method
vi.mock("./index", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const original = (await importOriginal()) as typeof import("./index");
  return {
    ...original,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ChangeSet: class extends original.ChangeSet<any, any, any> {
      print() {
        // Do nothing in tests
      }
    },
  };
});

describe("planTailorDB (service level)", () => {
  const workspaceId = "test-workspace";
  const appName = "test-app";

  // Helper to create mock TailorDB service
  function createMockTailorDBService(namespace: string): TailorDBService {
    return {
      namespace,
      loadTypes: vi.fn().mockResolvedValue({}),
      getTypes: vi.fn().mockReturnValue({}),
    } as unknown as TailorDBService;
  }

  // Helper to create mock client
  function createMockClient(
    existingServices: Array<{ name: string; label?: string }>,
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
            labels: service?.label ? { [sdkNameLabelKey]: service.label } : {},
          },
        };
      }),
    } as unknown as OperatorClient;
  }

  // Helper to create mock application
  function createMockApplication(
    tailorDBServices: TailorDBService[],
  ): Application {
    return {
      name: appName,
      env: {},
      tailorDBServices,
      executorService: {
        loadExecutors: vi.fn().mockResolvedValue({}),
      },
    } as unknown as Application;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("rename scenarios (service level)", () => {
    test("old service is deleted when renamed", async () => {
      // Existing service: "old-tailordb" with app label
      const client = createMockClient([
        { name: "old-tailordb", label: appName },
      ]);

      // New config has "new-tailordb" (renamed)
      const application = createMockApplication([
        createMockTailorDBService("new-tailordb"),
      ]);

      const ctx: PlanContext = {
        client,
        workspaceId,
        application,
        forRemoval: false,
      };

      const result = await planTailorDB(ctx);

      // "new-tailordb" should be created
      expect(result.changeSet.service.creates).toHaveLength(1);
      expect(result.changeSet.service.creates[0].name).toBe("new-tailordb");

      // "old-tailordb" should be deleted
      expect(result.changeSet.service.deletes).toHaveLength(1);
      expect(result.changeSet.service.deletes[0].name).toBe("old-tailordb");
    });
  });

  describe("delete scenarios (service level)", () => {
    test("service is deleted when removed from config", async () => {
      const client = createMockClient([
        { name: "tailordb-a", label: appName },
        { name: "tailordb-b", label: appName },
      ]);

      // Only tailordb-a in config
      const application = createMockApplication([
        createMockTailorDBService("tailordb-a"),
      ]);

      const ctx: PlanContext = {
        client,
        workspaceId,
        application,
        forRemoval: false,
      };

      const result = await planTailorDB(ctx);

      // "tailordb-a" should be updated
      expect(result.changeSet.service.updates).toHaveLength(1);
      expect(result.changeSet.service.updates[0].name).toBe("tailordb-a");

      // "tailordb-b" should be deleted
      expect(result.changeSet.service.deletes).toHaveLength(1);
      expect(result.changeSet.service.deletes[0].name).toBe("tailordb-b");
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
      };

      const result = await planTailorDB(ctx);

      expect(result.changeSet.service.deletes).toHaveLength(2);
      expect(
        result.changeSet.service.deletes.map((d) => d.name).sort(),
      ).toEqual(["tailordb-1", "tailordb-2"]);
    });
  });

  describe("label ownership scenarios (service level)", () => {
    test("service without label is NOT deleted", async () => {
      const client = createMockClient([
        { name: "unmanaged-tailordb" }, // No label
      ]);

      const application = createMockApplication([]);

      const ctx: PlanContext = {
        client,
        workspaceId,
        application,
        forRemoval: false,
      };

      const result = await planTailorDB(ctx);

      expect(result.changeSet.service.deletes).toHaveLength(0);
    });

    test("service owned by different app is NOT deleted", async () => {
      const client = createMockClient([
        { name: "other-tailordb", label: "other-app" },
      ]);

      const application = createMockApplication([]);

      const ctx: PlanContext = {
        client,
        workspaceId,
        application,
        forRemoval: false,
      };

      const result = await planTailorDB(ctx);

      expect(result.changeSet.service.deletes).toHaveLength(0);
      expect(result.resourceOwners.has("other-app")).toBe(true);
    });

    test("mixed ownership - only delete own services", async () => {
      const client = createMockClient([
        { name: "my-tailordb", label: appName },
        { name: "other-tailordb", label: "other-app" },
        { name: "unmanaged-tailordb" }, // No label
      ]);

      const application = createMockApplication([]);

      const ctx: PlanContext = {
        client,
        workspaceId,
        application,
        forRemoval: false,
      };

      const result = await planTailorDB(ctx);

      expect(result.changeSet.service.deletes).toHaveLength(1);
      expect(result.changeSet.service.deletes[0].name).toBe("my-tailordb");
      expect(result.resourceOwners.has("other-app")).toBe(true);
    });
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
          print: () => {},
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
          print: () => {},
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
          print: () => {},
        },
      },
      conflicts: [],
      unmanaged: [],
      resourceOwners: new Set<string>(),
    } as unknown as Awaited<ReturnType<typeof planTailorDB>>;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("delete-resources phase deletes gqlPermissions and types, but NOT services", async () => {
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

  test("create-update phase does not delete anything", async () => {
    const client = createMockClientWithSpies();
    const planResult = createMockPlanResult();

    await applyTailorDB(client, planResult, "create-update");

    // No deletes should happen in create-update phase
    expect(client.deleteTailorDBGQLPermission).not.toHaveBeenCalled();
    expect(client.deleteTailorDBType).not.toHaveBeenCalled();
    expect(client.deleteTailorDBService).not.toHaveBeenCalled();
  });
});
