import { describe, test, expect, vi, beforeEach } from "vitest";
import { applyAuth, type planAuth } from "./auth";
import type { OperatorClient } from "#/cli/shared/client";

describe("applyAuth phase separation", () => {
  function createMockClientWithSpies() {
    return {
      deleteAuthSCIMResource: vi.fn().mockResolvedValue({}),
      deleteAuthSCIMConfig: vi.fn().mockResolvedValue({}),
      deleteAuthOAuth2Client: vi.fn().mockResolvedValue({}),
      deleteAuthHook: vi.fn().mockResolvedValue({}),
      deleteAuthMachineUser: vi.fn().mockResolvedValue({}),
      deleteTenantConfig: vi.fn().mockResolvedValue({}),
      deleteUserProfileConfig: vi.fn().mockResolvedValue({}),
      deleteAuthIDPConfig: vi.fn().mockResolvedValue({}),
      deleteAuthService: vi.fn().mockResolvedValue({}),
      createAuthService: vi.fn().mockResolvedValue({}),
      createAuthIDPConfig: vi.fn().mockResolvedValue({}),
      createUserProfileConfig: vi.fn().mockResolvedValue({}),
      createTenantConfig: vi.fn().mockResolvedValue({}),
      createAuthMachineUser: vi.fn().mockResolvedValue({}),
      createAuthHook: vi.fn().mockResolvedValue({}),
      createAuthOAuth2Client: vi.fn().mockResolvedValue({}),
      createAuthSCIMConfig: vi.fn().mockResolvedValue({}),
      createAuthSCIMResource: vi.fn().mockResolvedValue({}),
      updateAuthIDPConfig: vi.fn().mockResolvedValue({}),
      updateUserProfileConfig: vi.fn().mockResolvedValue({}),
      updateTenantConfig: vi.fn().mockResolvedValue({}),
      updateAuthMachineUser: vi.fn().mockResolvedValue({}),
      updateAuthHook: vi.fn().mockResolvedValue({}),
      updateAuthOAuth2Client: vi.fn().mockResolvedValue({}),
      updateAuthSCIMConfig: vi.fn().mockResolvedValue({}),
      updateAuthSCIMResource: vi.fn().mockResolvedValue({}),
      setMetadata: vi.fn().mockResolvedValue({}),
    } as unknown as OperatorClient;
  }

  type OAuth2ClientReplace = {
    name: string;
    deleteRequest: Record<string, string>;
    createRequest: Record<string, unknown>;
  };

  function deletableChangeSet(title: string, name: string, request: Record<string, unknown>) {
    return {
      creates: [],
      updates: [],
      deletes: [{ name, request }],
      replaces: [] as OAuth2ClientReplace[],
      title,
      isEmpty: () => false,
      lines: () => [],
    };
  }

  function createMockPlanResult(opts?: { oauth2ClientReplaces?: OAuth2ClientReplace[] }) {
    return {
      changeSet: {
        service: deletableChangeSet("Auth Services", "test-auth", {
          workspaceId: "test-workspace",
          namespaceName: "test-auth",
        }),
        idpConfig: deletableChangeSet("Auth IdP Configs", "test-idp-config", {
          workspaceId: "test-workspace",
          namespaceName: "test-auth",
          name: "test-idp-config",
        }),
        userProfileConfig: deletableChangeSet(
          "Auth User Profile Configs",
          "test-user-profile-config",
          {
            workspaceId: "test-workspace",
            namespaceName: "test-auth",
            name: "test-user-profile-config",
          },
        ),
        tenantConfig: deletableChangeSet("Auth Tenant Configs", "test-tenant-config", {
          workspaceId: "test-workspace",
          namespaceName: "test-auth",
          name: "test-tenant-config",
        }),
        machineUser: deletableChangeSet("Auth Machine Users", "test-machine-user", {
          workspaceId: "test-workspace",
          namespaceName: "test-auth",
          name: "test-machine-user",
        }),
        authHook: deletableChangeSet("Auth Hooks", "test-auth/before-login", {
          workspaceId: "test-workspace",
          namespaceName: "test-auth",
          hookPoint: 1,
        }),
        oauth2Client: {
          ...deletableChangeSet("Auth OAuth2 Clients", "test-oauth2-client", {
            workspaceId: "test-workspace",
            namespaceName: "test-auth",
            name: "test-oauth2-client",
          }),
          replaces: opts?.oauth2ClientReplaces ?? [],
        },
        scim: deletableChangeSet("Auth SCIM Configs", "test-scim-config", {
          workspaceId: "test-workspace",
          namespaceName: "test-auth",
          name: "test-scim-config",
        }),
        scimResource: deletableChangeSet("Auth SCIM Resources", "test-scim-resource", {
          workspaceId: "test-workspace",
          namespaceName: "test-auth",
          name: "test-scim-resource",
        }),
        connection: {
          ...deletableChangeSet("Auth Connections", "", {}),
          deletes: [],
        },
      },
      conflicts: [],
      unmanaged: [],
      resourceOwners: new Set<string>(),
    } as unknown as Awaited<ReturnType<typeof planAuth>>;
  }

  const resourceDeleteMethods = [
    "deleteAuthSCIMResource",
    "deleteAuthSCIMConfig",
    "deleteAuthOAuth2Client",
    "deleteAuthMachineUser",
    "deleteTenantConfig",
    "deleteUserProfileConfig",
    "deleteAuthIDPConfig",
  ] as const;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test.each([
    { phase: "delete-resources", resourcesCalled: 1, servicesCalled: 0 },
    { phase: "delete-services", resourcesCalled: 0, servicesCalled: 1 },
    { phase: "create-update", resourcesCalled: 0, servicesCalled: 0 },
  ] as const)(
    "$phase phase calls resource deletes $resourcesCalled time(s) and service delete $servicesCalled time(s)",
    async ({ phase, resourcesCalled, servicesCalled }) => {
      const client = createMockClientWithSpies();
      const planResult = createMockPlanResult();

      await applyAuth(client, planResult, phase);

      for (const method of resourceDeleteMethods) {
        expect(client[method]).toHaveBeenCalledTimes(resourcesCalled);
      }
      expect(client.deleteAuthService).toHaveBeenCalledTimes(servicesCalled);
    },
  );

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
