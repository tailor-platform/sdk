import { describe, test, expect, vi, beforeEach } from "vitest";
import { applyAuth, type planAuth } from "./auth";
import type { OperatorClient } from "@/cli/client";

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

describe("applyAuth phase separation", () => {
  // Helper to create mock client with spies for delete operations
  function createMockClientWithSpies() {
    return {
      // Delete methods
      deleteAuthSCIMResource: vi.fn().mockResolvedValue({}),
      deleteAuthSCIMConfig: vi.fn().mockResolvedValue({}),
      deleteAuthOAuth2Client: vi.fn().mockResolvedValue({}),
      deleteAuthMachineUser: vi.fn().mockResolvedValue({}),
      deleteTenantConfig: vi.fn().mockResolvedValue({}),
      deleteUserProfileConfig: vi.fn().mockResolvedValue({}),
      deleteAuthIDPConfig: vi.fn().mockResolvedValue({}),
      deleteAuthService: vi.fn().mockResolvedValue({}),
      // Create/update methods for completeness
      createAuthService: vi.fn().mockResolvedValue({}),
      createAuthIDPConfig: vi.fn().mockResolvedValue({}),
      createUserProfileConfig: vi.fn().mockResolvedValue({}),
      createTenantConfig: vi.fn().mockResolvedValue({}),
      createAuthMachineUser: vi.fn().mockResolvedValue({}),
      createAuthOAuth2Client: vi.fn().mockResolvedValue({}),
      createAuthSCIMConfig: vi.fn().mockResolvedValue({}),
      createAuthSCIMResource: vi.fn().mockResolvedValue({}),
      updateAuthIDPConfig: vi.fn().mockResolvedValue({}),
      updateUserProfileConfig: vi.fn().mockResolvedValue({}),
      updateTenantConfig: vi.fn().mockResolvedValue({}),
      updateAuthMachineUser: vi.fn().mockResolvedValue({}),
      updateAuthOAuth2Client: vi.fn().mockResolvedValue({}),
      updateAuthSCIMConfig: vi.fn().mockResolvedValue({}),
      updateAuthSCIMResource: vi.fn().mockResolvedValue({}),
      setMetadata: vi.fn().mockResolvedValue({}),
    } as unknown as OperatorClient;
  }

  // Helper to create a mock plan result with deletes
  function createMockPlanResult() {
    const mockChangeSet = {
      creates: [],
      updates: [],
      deletes: [] as { name: string; request: Record<string, string> }[],
      title: "",
      isEmpty: () => false,
      print: () => {},
    };

    return {
      changeSet: {
        service: {
          ...mockChangeSet,
          title: "Auth Services",
          deletes: [
            {
              name: "test-auth",
              request: {
                workspaceId: "test-workspace",
                namespaceName: "test-auth",
              },
            },
          ],
        },
        idpConfig: {
          ...mockChangeSet,
          title: "Auth IdP Configs",
          deletes: [
            {
              name: "test-idp-config",
              request: {
                workspaceId: "test-workspace",
                namespaceName: "test-auth",
                name: "test-idp-config",
              },
            },
          ],
        },
        userProfileConfig: {
          ...mockChangeSet,
          title: "Auth User Profile Configs",
          deletes: [
            {
              name: "test-user-profile-config",
              request: {
                workspaceId: "test-workspace",
                namespaceName: "test-auth",
                name: "test-user-profile-config",
              },
            },
          ],
        },
        tenantConfig: {
          ...mockChangeSet,
          title: "Auth Tenant Configs",
          deletes: [
            {
              name: "test-tenant-config",
              request: {
                workspaceId: "test-workspace",
                namespaceName: "test-auth",
                name: "test-tenant-config",
              },
            },
          ],
        },
        machineUser: {
          ...mockChangeSet,
          title: "Auth Machine Users",
          deletes: [
            {
              name: "test-machine-user",
              request: {
                workspaceId: "test-workspace",
                namespaceName: "test-auth",
                name: "test-machine-user",
              },
            },
          ],
        },
        oauth2Client: {
          ...mockChangeSet,
          title: "Auth OAuth2 Clients",
          deletes: [
            {
              name: "test-oauth2-client",
              request: {
                workspaceId: "test-workspace",
                namespaceName: "test-auth",
                name: "test-oauth2-client",
              },
            },
          ],
        },
        scim: {
          ...mockChangeSet,
          title: "Auth SCIM Configs",
          deletes: [
            {
              name: "test-scim-config",
              request: {
                workspaceId: "test-workspace",
                namespaceName: "test-auth",
                name: "test-scim-config",
              },
            },
          ],
        },
        scimResource: {
          ...mockChangeSet,
          title: "Auth SCIM Resources",
          deletes: [
            {
              name: "test-scim-resource",
              request: {
                workspaceId: "test-workspace",
                namespaceName: "test-auth",
                name: "test-scim-resource",
              },
            },
          ],
        },
      },
      conflicts: [],
      unmanaged: [],
      resourceOwners: new Set<string>(),
    } as unknown as Awaited<ReturnType<typeof planAuth>>;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("delete-resources phase deletes all resources, but NOT services", async () => {
    const client = createMockClientWithSpies();
    const planResult = createMockPlanResult();

    await applyAuth(client, planResult, "delete-resources");

    // All resources should be deleted
    expect(client.deleteAuthSCIMResource).toHaveBeenCalledTimes(1);
    expect(client.deleteAuthSCIMConfig).toHaveBeenCalledTimes(1);
    expect(client.deleteAuthOAuth2Client).toHaveBeenCalledTimes(1);
    expect(client.deleteAuthMachineUser).toHaveBeenCalledTimes(1);
    expect(client.deleteTenantConfig).toHaveBeenCalledTimes(1);
    expect(client.deleteUserProfileConfig).toHaveBeenCalledTimes(1);
    expect(client.deleteAuthIDPConfig).toHaveBeenCalledTimes(1);
    // Services should NOT be deleted
    expect(client.deleteAuthService).not.toHaveBeenCalled();
  });

  test("delete-services phase deletes ONLY services", async () => {
    const client = createMockClientWithSpies();
    const planResult = createMockPlanResult();

    await applyAuth(client, planResult, "delete-services");

    // Resources should NOT be deleted
    expect(client.deleteAuthSCIMResource).not.toHaveBeenCalled();
    expect(client.deleteAuthSCIMConfig).not.toHaveBeenCalled();
    expect(client.deleteAuthOAuth2Client).not.toHaveBeenCalled();
    expect(client.deleteAuthMachineUser).not.toHaveBeenCalled();
    expect(client.deleteTenantConfig).not.toHaveBeenCalled();
    expect(client.deleteUserProfileConfig).not.toHaveBeenCalled();
    expect(client.deleteAuthIDPConfig).not.toHaveBeenCalled();
    // Services should be deleted
    expect(client.deleteAuthService).toHaveBeenCalledTimes(1);
  });

  test("create-update phase does not delete anything", async () => {
    const client = createMockClientWithSpies();
    const planResult = createMockPlanResult();

    await applyAuth(client, planResult, "create-update");

    // No deletes should happen in create-update phase
    expect(client.deleteAuthSCIMResource).not.toHaveBeenCalled();
    expect(client.deleteAuthSCIMConfig).not.toHaveBeenCalled();
    expect(client.deleteAuthOAuth2Client).not.toHaveBeenCalled();
    expect(client.deleteAuthMachineUser).not.toHaveBeenCalled();
    expect(client.deleteTenantConfig).not.toHaveBeenCalled();
    expect(client.deleteUserProfileConfig).not.toHaveBeenCalled();
    expect(client.deleteAuthIDPConfig).not.toHaveBeenCalled();
    expect(client.deleteAuthService).not.toHaveBeenCalled();
  });
});
