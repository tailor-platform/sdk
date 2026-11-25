import { describe, test, expect, vi } from "vitest";
import { logger } from "#/cli/shared/logger";
import { mockOperatorClient } from "#/cli/shared/test-helpers/operator-client";
import { applyAuth, type planAuth } from "./auth";

describe("applyAuth phase separation", () => {
  function createMockClientWithSpies() {
    return mockOperatorClient({
      deleteAuthSCIMResource: {},
      deleteAuthSCIMConfig: {},
      deleteAuthOAuth2Client: {},
      deleteAuthHook: {},
      deleteAuthMachineUser: {},
      deleteTenantConfig: {},
      deleteUserProfileConfig: {},
      deleteAuthIDPConfig: {},
      deleteAuthService: {},
      createAuthService: {},
      createAuthIDPConfig: {},
      createUserProfileConfig: {},
      createTenantConfig: {},
      createAuthMachineUser: {},
      createAuthHook: {},
      createAuthOAuth2Client: {},
      createAuthSCIMConfig: {},
      createAuthSCIMResource: {},
      updateAuthIDPConfig: {},
      updateUserProfileConfig: {},
      updateTenantConfig: {},
      updateAuthMachineUser: {},
      updateAuthHook: {},
      updateAuthOAuth2Client: {},
      updateAuthSCIMConfig: {},
      updateAuthSCIMResource: {},
      setMetadata: {},
    });
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
      unchanged: [],
      title,
      isEmpty: () => false,
      lines: () => [],
    };
  }

  type CreateEntry = { name: string; request: Record<string, unknown> };
  type CreateMockPlanResultOptions = {
    oauth2ClientReplaces?: OAuth2ClientReplace[];
    oauth2ClientCreates?: CreateEntry[];
    machineUserCreates?: CreateEntry[];
  };

  function createMockPlanResult(opts?: CreateMockPlanResultOptions) {
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
        machineUser: {
          ...deletableChangeSet("Auth Machine Users", "test-machine-user", {
            workspaceId: "test-workspace",
            namespaceName: "test-auth",
            name: "test-machine-user",
          }),
          creates: opts?.machineUserCreates ?? [],
        },
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
          creates: opts?.oauth2ClientCreates ?? [],
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
      connectionStateScope: {
        workspaceId: "test-workspace",
        applicationId: "test-app-id",
        applicationName: "test-app",
        configPath: "/proj/app/tailor.config.ts",
      },
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

  test("registers a newly created OAuth2 client's server-generated secret", async () => {
    const client = createMockClientWithSpies();
    client.createAuthOAuth2Client.mockResolvedValue({
      oauth2Client: { name: "test-oauth2-client", clientSecret: "brand-new-oauth2-secret" },
    });
    using registerSecretSpy = vi.spyOn(logger, "registerSecret").mockImplementation(() => {});
    const planResult = createMockPlanResult({
      oauth2ClientCreates: [
        {
          name: "test-oauth2-client",
          request: {
            workspaceId: "test-workspace",
            namespaceName: "test-auth",
            oauth2Client: { name: "test-oauth2-client", redirectUris: [] },
          },
        },
      ],
    });

    await applyAuth(client, planResult, "create-update");

    expect(registerSecretSpy).toHaveBeenCalledWith("brand-new-oauth2-secret");
  });

  test("registers a newly created machine user's server-generated secret", async () => {
    const client = createMockClientWithSpies();
    client.createAuthMachineUser.mockResolvedValue({
      machineUser: { name: "test-machine-user", clientSecret: "brand-new-machineuser-secret" },
    });
    using registerSecretSpy = vi.spyOn(logger, "registerSecret").mockImplementation(() => {});
    const planResult = createMockPlanResult({
      machineUserCreates: [
        {
          name: "test-machine-user",
          request: {
            workspaceId: "test-workspace",
            namespaceName: "test-auth",
            name: "test-machine-user",
          },
        },
      ],
    });

    await applyAuth(client, planResult, "create-update");

    expect(registerSecretSpy).toHaveBeenCalledWith("brand-new-machineuser-secret");
  });
});
