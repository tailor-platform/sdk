import { describe, test, expect, vi, beforeEach, type Mock } from "vitest";

type MockProcedure = (...args: Parameters<Mock>) => ReturnType<Mock>;
import { applyAuth, type planAuth } from "./auth";
import type { OperatorClient } from "@/cli/shared/client";

describe("applyAuth phase separation", () => {
  // Helper to create mock client with spies for delete operations
  function createMockClientWithSpies() {
    return {
      // Delete methods
      deleteAuthSCIMResource: vi.fn<MockProcedure>().mockResolvedValue({}),
      deleteAuthSCIMConfig: vi.fn<MockProcedure>().mockResolvedValue({}),
      deleteAuthOAuth2Client: vi.fn<MockProcedure>().mockResolvedValue({}),
      deleteAuthHook: vi.fn<MockProcedure>().mockResolvedValue({}),
      deleteAuthMachineUser: vi.fn<MockProcedure>().mockResolvedValue({}),
      deleteTenantConfig: vi.fn<MockProcedure>().mockResolvedValue({}),
      deleteUserProfileConfig: vi.fn<MockProcedure>().mockResolvedValue({}),
      deleteAuthIDPConfig: vi.fn<MockProcedure>().mockResolvedValue({}),
      deleteAuthService: vi.fn<MockProcedure>().mockResolvedValue({}),
      // Create/update methods for completeness
      createAuthService: vi.fn<MockProcedure>().mockResolvedValue({}),
      createAuthIDPConfig: vi.fn<MockProcedure>().mockResolvedValue({}),
      createUserProfileConfig: vi.fn<MockProcedure>().mockResolvedValue({}),
      createTenantConfig: vi.fn<MockProcedure>().mockResolvedValue({}),
      createAuthMachineUser: vi.fn<MockProcedure>().mockResolvedValue({}),
      createAuthHook: vi.fn<MockProcedure>().mockResolvedValue({}),
      createAuthOAuth2Client: vi.fn<MockProcedure>().mockResolvedValue({}),
      createAuthSCIMConfig: vi.fn<MockProcedure>().mockResolvedValue({}),
      createAuthSCIMResource: vi.fn<MockProcedure>().mockResolvedValue({}),
      updateAuthIDPConfig: vi.fn<MockProcedure>().mockResolvedValue({}),
      updateUserProfileConfig: vi.fn<MockProcedure>().mockResolvedValue({}),
      updateTenantConfig: vi.fn<MockProcedure>().mockResolvedValue({}),
      updateAuthMachineUser: vi.fn<MockProcedure>().mockResolvedValue({}),
      updateAuthHook: vi.fn<MockProcedure>().mockResolvedValue({}),
      updateAuthOAuth2Client: vi.fn<MockProcedure>().mockResolvedValue({}),
      updateAuthSCIMConfig: vi.fn<MockProcedure>().mockResolvedValue({}),
      updateAuthSCIMResource: vi.fn<MockProcedure>().mockResolvedValue({}),
      setMetadata: vi.fn<MockProcedure>().mockResolvedValue({}),
    } as unknown as OperatorClient;
  }

  type OAuth2ClientReplace = {
    name: string;
    deleteRequest: Record<string, string>;
    createRequest: Record<string, unknown>;
  };

  // Helper to create a mock plan result with deletes
  function createMockPlanResult(opts?: { oauth2ClientReplaces?: OAuth2ClientReplace[] }) {
    const mockChangeSet = {
      creates: [],
      updates: [],
      deletes: [] as { name: string; request: Record<string, string> }[],
      replaces: [] as OAuth2ClientReplace[],
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
        authHook: {
          ...mockChangeSet,
          title: "Auth Hooks",
          deletes: [
            {
              name: "test-auth/before-login",
              request: {
                workspaceId: "test-workspace",
                namespaceName: "test-auth",
                hookPoint: 1,
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
          replaces: opts?.oauth2ClientReplaces ?? [],
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

  test("create-update phase does not delete anything (except replaces)", async () => {
    const client = createMockClientWithSpies();
    const planResult = createMockPlanResult();

    await applyAuth(client, planResult, "create-update");

    // No deletes should happen in create-update phase (except OAuth2 client replaces)
    expect(client.deleteAuthSCIMResource).not.toHaveBeenCalled();
    expect(client.deleteAuthSCIMConfig).not.toHaveBeenCalled();
    expect(client.deleteAuthOAuth2Client).not.toHaveBeenCalled();
    expect(client.deleteAuthMachineUser).not.toHaveBeenCalled();
    expect(client.deleteTenantConfig).not.toHaveBeenCalled();
    expect(client.deleteUserProfileConfig).not.toHaveBeenCalled();
    expect(client.deleteAuthIDPConfig).not.toHaveBeenCalled();
    expect(client.deleteAuthService).not.toHaveBeenCalled();
  });

  test("create-update phase handles OAuth2 client replaces (delete then create)", async () => {
    const client = createMockClientWithSpies();
    const planResult = createMockPlanResult({
      oauth2ClientReplaces: [
        {
          name: "test-replace-client",
          deleteRequest: {
            workspaceId: "test-workspace",
            namespaceName: "test-auth",
            name: "test-replace-client",
          },
          createRequest: {
            workspaceId: "test-workspace",
            namespaceName: "test-auth",
            oauth2Client: {
              name: "test-replace-client",
              redirectUris: [],
            },
          },
        },
      ],
    });

    await applyAuth(client, planResult, "create-update");

    // Replace should delete then create
    expect(client.deleteAuthOAuth2Client).toHaveBeenCalledTimes(1);
    expect(client.deleteAuthOAuth2Client).toHaveBeenCalledWith({
      workspaceId: "test-workspace",
      namespaceName: "test-auth",
      name: "test-replace-client",
    });
    expect(client.createAuthOAuth2Client).toHaveBeenCalledTimes(1);
  });

  test("delete-resources phase does not delete replaced OAuth2 clients", async () => {
    const client = createMockClientWithSpies();
    const planResult = createMockPlanResult({
      oauth2ClientReplaces: [
        {
          name: "test-replace-client",
          deleteRequest: {
            workspaceId: "test-workspace",
            namespaceName: "test-auth",
            name: "test-replace-client",
          },
          createRequest: {
            workspaceId: "test-workspace",
            namespaceName: "test-auth",
            oauth2Client: {
              name: "test-replace-client",
              redirectUris: [],
            },
          },
        },
      ],
    });

    await applyAuth(client, planResult, "delete-resources");

    // Only the regular delete should be called, not the replace delete
    expect(client.deleteAuthOAuth2Client).toHaveBeenCalledTimes(1);
    expect(client.deleteAuthOAuth2Client).toHaveBeenCalledWith({
      workspaceId: "test-workspace",
      namespaceName: "test-auth",
      name: "test-oauth2-client",
    });
    // Create should not be called in delete-resources phase
    expect(client.createAuthOAuth2Client).not.toHaveBeenCalled();
  });
});
