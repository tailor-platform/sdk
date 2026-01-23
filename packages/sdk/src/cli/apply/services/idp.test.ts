import { describe, test, expect, vi, beforeEach } from "vitest";
import { applyIdP, type planIdP } from "./idp";
import type { OperatorClient } from "@/cli/client";

describe("applyIdP phase separation", () => {
  // Helper to create mock client with spies for delete operations
  function createMockClientWithSpies() {
    return {
      // Delete methods
      deleteIdPClient: vi.fn().mockResolvedValue({}),
      deleteIdPService: vi.fn().mockResolvedValue({}),
      deleteSecretManagerVault: vi.fn().mockResolvedValue({}),
      // Create/update methods for completeness
      createIdPService: vi.fn().mockResolvedValue({}),
      createIdPClient: vi.fn().mockResolvedValue({}),
      updateIdPClient: vi.fn().mockResolvedValue({}),
      createSecretManagerVault: vi.fn().mockResolvedValue({}),
      createSecretManagerSecret: vi.fn().mockResolvedValue({}),
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
              name: "test-idp",
              request: {
                workspaceId: "test-workspace",
                namespaceName: "test-idp",
              },
            },
          ],
          title: "IdP Services",
          isEmpty: () => false,
          print: () => {},
        },
        client: {
          creates: [],
          updates: [],
          deletes: [
            {
              name: "test-client",
              request: {
                workspaceId: "test-workspace",
                namespaceName: "test-idp",
                name: "test-client",
              },
            },
          ],
          title: "IdP Clients",
          isEmpty: () => false,
          print: () => {},
        },
      },
      conflicts: [],
      unmanaged: [],
      resourceOwners: new Set<string>(),
    } as unknown as Awaited<ReturnType<typeof planIdP>>;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("delete-resources phase deletes clients and vaults, but NOT services", async () => {
    const client = createMockClientWithSpies();
    const planResult = createMockPlanResult();

    await applyIdP(client, planResult, "delete-resources");

    // Clients should be deleted
    expect(client.deleteIdPClient).toHaveBeenCalledTimes(1);
    // Secret vaults should be deleted
    expect(client.deleteSecretManagerVault).toHaveBeenCalledTimes(1);
    // Services should NOT be deleted
    expect(client.deleteIdPService).not.toHaveBeenCalled();
  });

  test("delete-services phase deletes ONLY services", async () => {
    const client = createMockClientWithSpies();
    const planResult = createMockPlanResult();

    await applyIdP(client, planResult, "delete-services");

    // Clients should NOT be deleted
    expect(client.deleteIdPClient).not.toHaveBeenCalled();
    // Secret vaults should NOT be deleted
    expect(client.deleteSecretManagerVault).not.toHaveBeenCalled();
    // Services should be deleted
    expect(client.deleteIdPService).toHaveBeenCalledTimes(1);
  });

  test("create-update phase does not delete anything", async () => {
    const client = createMockClientWithSpies();
    const planResult = createMockPlanResult();

    await applyIdP(client, planResult, "create-update");

    // No deletes should happen in create-update phase
    expect(client.deleteIdPClient).not.toHaveBeenCalled();
    expect(client.deleteSecretManagerVault).not.toHaveBeenCalled();
    expect(client.deleteIdPService).not.toHaveBeenCalled();
  });
});
