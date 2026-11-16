import { create, fromJson, type MessageInitShape } from "@bufbuild/protobuf";
import { ValueSchema } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import {
  AuthIDPConfigSchema,
  AuthOAuth2Client_ClientType,
  AuthOAuth2Client_GrantType,
  AuthSCIMAttribute_Type,
  AuthSCIMAttribute_Uniqueness,
  AuthSCIMConfig_AuthorizationType,
  AuthSCIMConfigSchema,
  AuthSCIMResourceSchema,
  TenantProviderConfigSchema,
  UserProfileProviderConfig_UserProfileProviderType,
  UserProfileProviderConfigSchema,
} from "@tailor-platform/tailor-proto/auth_resource_pb";
import { describe, expect, test, vi } from "vitest";
import { defineApplication } from "#/cli/services/application";
import { logger, symbols } from "#/cli/shared/logger";
import { defineConfig } from "#/configure/config/index";
import { defineAuth } from "#/configure/services/auth/index";
import { t } from "#/configure/types/type";
import { applyAuth, formatAuthHookChangeEntries, planAuth } from "./auth";
import type { Application } from "#/cli/services/application";
import type { OperatorClient } from "#/cli/shared/client";
import type { SCIMAuthorization } from "#/types/auth.generated";
import type { PlanContext } from "./types";

vi.mock("./label", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    buildMetaRequest: vi.fn().mockImplementation(async () => ({
      trn: "trn:v1:workspace:test-workspace:auth:auth-a",
      labels: {
        "sdk-name": "test-app",
        "sdk-version": "v1-0-0",
      },
    })),
  };
});

vi.mock("./change-set", async (importOriginal) => importOriginal());

const workspaceId = "test-workspace";
const appName = "test-app";
const sdkVersion = "v1-0-0";

function remoteOAuth2Client(overrides: {
  description?: string;
  redirectUris: string[];
  accessTokenLifetime: { seconds: bigint };
  refreshTokenLifetime: { seconds: bigint };
}) {
  return {
    name: "sample",
    description: overrides.description ?? "Sample client",
    grantTypes: [
      AuthOAuth2Client_GrantType.AUTHORIZATION_CODE,
      AuthOAuth2Client_GrantType.REFRESH_TOKEN,
    ],
    redirectUris: overrides.redirectUris,
    clientType: AuthOAuth2Client_ClientType.CONFIDENTIAL,
    accessTokenLifetime: overrides.accessTokenLifetime,
    refreshTokenLifetime: overrides.refreshTokenLifetime,
    requireDpop: false,
  };
}

const managerMachineUserRemote = {
  name: "manager-machine-user",
  attributes: ["role", "department"],
  attributeMap: {
    department: fromJson(ValueSchema, "sales"),
    role: fromJson(ValueSchema, "manager"),
  },
  clientSecret: "manager-machine-user-remote-secret",
};

function createMockApplication(): Application {
  return {
    name: appName,
    staticWebsiteServices: [],
    authService: {
      resolveNamespaces: vi.fn().mockResolvedValue(undefined),
      connections: {},
      config: {
        name: "auth-a",
        publishSessionEvents: true,
        oauth2Clients: {
          sample: {
            description: "Sample client",
            grantTypes: ["authorization_code", "refresh_token"],
            redirectURIs: ["https://b.example.com/callback", "https://a.example.com/callback"],
            clientType: "confidential",
            requireDpop: false,
          },
        },
        machineUsers: {
          "manager-machine-user": {
            attributeList: ["department", "role"],
            attributes: {
              department: "sales",
              role: "manager",
            },
          },
        },
        hooks: {
          beforeLogin: {
            handler: async () => undefined,
            invoker: "manager-machine-user",
          },
        },
      },
      userProfile: undefined,
    },
  } as unknown as Application;
}

type MockUserProfileOptions = {
  includeAttributes?: boolean;
};

function createMockApplicationWithUserProfile(options: MockUserProfileOptions = {}): Application {
  const application = createMockApplication();
  const includeAttributes = options.includeAttributes ?? true;
  return {
    ...application,
    authService: {
      ...application.authService,
      userProfile: {
        namespace: "tailordb",
        type: { name: "User" },
        usernameField: "email",
        attributeList: includeAttributes ? ["email"] : [],
        attributes: includeAttributes ? { email: true } : undefined,
      },
    },
  } as unknown as Application;
}

const bearerSCIMAuthorization: SCIMAuthorization = {
  type: "bearer",
  bearerSecret: { vaultName: "scim", secretKey: "token" },
};

function createMockApplicationWithSCIM(authorization: SCIMAuthorization): Application {
  const application = createMockApplication();
  return {
    ...application,
    authService: {
      ...application.authService,
      config: {
        ...application.authService?.config,
        scim: {
          machineUserName: "manager-machine-user",
          authorization,
          resources: [
            {
              name: "User",
              tailorDBNamespace: "tailordb",
              tailorDBType: "User",
              coreSchema: {
                name: "urn:ietf:params:scim:schemas:core:2.0:User",
                attributes: [
                  { type: "string", name: "userName", required: true },
                  {
                    type: "complex",
                    name: "name",
                    subAttributes: [{ type: "string", name: "givenName" }],
                  },
                ],
              },
              attributeMapping: [
                { tailorDBField: "email", scimPath: "userName" },
                { tailorDBField: "givenName", scimPath: "name.givenName" },
              ],
            },
          ],
        },
      },
    },
  } as unknown as Application;
}

function remoteSCIMConfig(
  authorization: SCIMAuthorization,
  machineUserName = "manager-machine-user",
) {
  return create(AuthSCIMConfigSchema, {
    machineUserName,
    ...(authorization.type === "bearer"
      ? {
          authorizationType: AuthSCIMConfig_AuthorizationType.BEARER,
          authorizationConfig: { case: "bearerSecret", value: authorization.bearerSecret ?? {} },
        }
      : { authorizationType: AuthSCIMConfig_AuthorizationType.OAUTH2 }),
  });
}

function remoteSCIMResource(userNameDescription?: string) {
  return create(AuthSCIMResourceSchema, {
    name: "User",
    tailorDbNamespace: "tailordb",
    tailorDbType: "User",
    coreSchema: {
      name: "urn:ietf:params:scim:schemas:core:2.0:User",
      attributes: [
        {
          type: AuthSCIMAttribute_Type.STRING,
          name: "userName",
          description: userNameDescription,
          required: true,
          uniqueness: AuthSCIMAttribute_Uniqueness.NONE,
        },
        {
          type: AuthSCIMAttribute_Type.COMPLEX,
          name: "name",
          uniqueness: AuthSCIMAttribute_Uniqueness.NONE,
          subAttributes: [
            {
              type: AuthSCIMAttribute_Type.STRING,
              name: "givenName",
              uniqueness: AuthSCIMAttribute_Uniqueness.NONE,
            },
          ],
        },
      ],
    },
    attributeMapping: [
      { tailorDbField: "email", scimPath: "userName" },
      { tailorDbField: "givenName", scimPath: "name.givenName" },
    ],
  });
}

function createMockApplicationWithCustomOAuth2Lifetimes(): Application {
  return {
    name: appName,
    staticWebsiteServices: [],
    authService: {
      resolveNamespaces: vi.fn().mockResolvedValue(undefined),
      connections: {},
      config: {
        name: "auth-a",
        oauth2Clients: {
          sample: {
            description: "Sample client",
            grantTypes: ["authorization_code", "refresh_token"],
            redirectURIs: ["https://b.example.com/callback", "https://a.example.com/callback"],
            clientType: "confidential",
            // config holds parse output: lifetimes are Duration, not numbers.
            accessTokenLifetimeSeconds: { seconds: 3600n, nanos: 0 },
            refreshTokenLifetimeSeconds: { seconds: 7200n, nanos: 0 },
            requireDpop: false,
          },
        },
      },
      userProfile: undefined,
    },
  } as unknown as Application;
}

function createMockApplicationWithBuiltInIdP(): Application {
  return {
    name: appName,
    staticWebsiteServices: [],
    authService: {
      resolveNamespaces: vi.fn().mockResolvedValue(undefined),
      connections: {},
      config: {
        name: "auth-a",
        idProvider: {
          name: "default",
          kind: "BuiltInIdP",
          namespace: "my-idp",
          clientName: "default-idp-client",
        },
      },
      userProfile: undefined,
    },
  } as unknown as Application;
}

function createMockApplicationWithSamlIdP(): Application {
  const application = createMockApplication();
  return {
    ...application,
    authService: {
      ...application.authService,
      config: {
        ...application.authService?.config,
        idProvider: {
          name: "saml",
          kind: "SAML",
          enableSignRequest: false,
          rawMetadata: "<EntityDescriptor />",
        },
      },
    },
  } as unknown as Application;
}

function createMockApplicationWithTenantProvider(): Application {
  const application = createMockApplication();
  return {
    ...application,
    authService: {
      ...application.authService,
      config: {
        ...application.authService?.config,
        tenantProvider: {
          namespace: "tailordb",
          type: "Tenant",
          signatureField: "signature",
        },
      },
    },
  } as unknown as Application;
}

type MachineUserReferences = {
  machineUsers: string[];
  scimMachineUser?: string;
  hookInvoker?: string;
};

function createMockApplicationNamingMachineUsers(references: MachineUserReferences): Application {
  const { machineUsers, scimMachineUser, hookInvoker } = references;
  const application = createMockApplication();
  return {
    ...application,
    authService: {
      ...application.authService,
      config: {
        ...application.authService?.config,
        machineUsers: Object.fromEntries(machineUsers.map((name) => [name, {}])),
        hooks: hookInvoker
          ? { beforeLogin: { handler: async () => undefined, invoker: hookInvoker } }
          : undefined,
        scim: scimMachineUser
          ? { machineUserName: scimMachineUser, authorization: { type: "oauth2" }, resources: [] }
          : undefined,
      },
    },
  } as unknown as Application;
}

function notFound(): never {
  throw new ConnectError("not found", Code.NotFound);
}

function createMockClient(opts?: {
  authServices?: Array<{
    name: string;
    publishSessionEvents: boolean;
    label?: string;
  }>;
  authIdPConfigs?: Array<MessageInitShape<typeof AuthIDPConfigSchema>>;
  machineUsers?: Array<{
    name: string;
    attributes: string[];
    attributeMap: Record<string, ReturnType<typeof fromJson<typeof ValueSchema>>>;
    clientSecret?: string;
  }>;
  oauth2Clients?: Array<{
    name: string;
    description: string;
    grantTypes: AuthOAuth2Client_GrantType[];
    redirectUris: string[];
    clientType: AuthOAuth2Client_ClientType;
    accessTokenLifetime?: { seconds: bigint };
    refreshTokenLifetime?: { seconds: bigint };
    requireDpop: boolean;
    clientSecret?: string;
  }>;
  authHook?: {
    scriptRef: string;
    invoker?: {
      namespace: string;
      machineUserName: string;
    };
  };
  userProfileConfig?: Record<string, unknown>;
  tenantConfig?: Record<string, unknown>;
  scimConfig?: MessageInitShape<typeof AuthSCIMConfigSchema>;
  scimResources?: Array<MessageInitShape<typeof AuthSCIMResourceSchema>>;
}): OperatorClient {
  const authServices = opts?.authServices ?? [];
  const authIdPConfigs = opts?.authIdPConfigs ?? [];
  const machineUsers = opts?.machineUsers ?? [];
  const oauth2Clients = opts?.oauth2Clients ?? [];
  const authHook = opts?.authHook;

  return {
    listAuthServices: vi.fn().mockResolvedValue({
      authServices: authServices.map((service) => ({
        namespace: { name: service.name },
        publishSessionEvents: service.publishSessionEvents,
      })),
      nextPageToken: "",
    }),
    getMetadata: vi.fn().mockImplementation(({ trn }: { trn: string }) => {
      const name = trn.split(":").pop();
      const service = authServices.find((entry) => entry.name === name);
      return {
        metadata: {
          labels: service?.label ? { "sdk-name": service.label, "sdk-version": sdkVersion } : {},
        },
      };
    }),
    listAuthIDPConfigs: vi.fn().mockResolvedValue({
      idpConfigs: authIdPConfigs,
      nextPageToken: "",
    }),
    getIdPService: vi.fn().mockImplementation(notFound),
    getIdPClient: vi.fn().mockImplementation(notFound),
    getUserProfileConfig: opts?.userProfileConfig
      ? vi.fn().mockResolvedValue(opts.userProfileConfig)
      : vi.fn().mockImplementation(notFound),
    deleteUserProfileConfig: vi.fn().mockResolvedValue({}),
    getTenantConfig: opts?.tenantConfig
      ? vi.fn().mockResolvedValue(opts.tenantConfig)
      : vi.fn().mockImplementation(notFound),
    listAuthMachineUsers: vi.fn().mockResolvedValue({
      machineUsers,
      nextPageToken: "",
    }),
    listAuthOAuth2Clients: vi.fn().mockResolvedValue({
      oauth2Clients,
      nextPageToken: "",
    }),
    getAuthHook: vi.fn().mockImplementation(() => {
      if (!authHook) {
        return notFound();
      }
      return {
        hook: {
          hookPoint: 1,
          scriptRef: authHook.scriptRef,
          invoker: authHook.invoker,
        },
      };
    }),
    getAuthSCIMConfig: opts?.scimConfig
      ? vi.fn().mockResolvedValue({ scimConfig: opts.scimConfig })
      : vi.fn().mockImplementation(notFound),
    getAuthSCIMResources: vi.fn().mockResolvedValue({
      scimResources: opts?.scimResources ?? [],
    }),
    listAuthConnections: vi.fn().mockResolvedValue({
      connections: [],
      nextPageToken: "",
    }),
  } as unknown as OperatorClient;
}

function createContext(
  client: OperatorClient,
  application: Application = createMockApplication(),
): PlanContext {
  return {
    client,
    workspaceId,
    application,
    forRemoval: false,
    config: { path: "/test/tailor.config.ts" } as PlanContext["config"],
  };
}

describe("planAuth", () => {
  test("plans user profiles from the application while keeping machine users", async () => {
    const strippedApplication = createMockApplication();
    const emptyTarget = await planAuth(createContext(createMockClient(), strippedApplication));

    expect(emptyTarget.changeSet.userProfileConfig.creates).toHaveLength(0);
    expect(emptyTarget.changeSet.machineUser.creates).toHaveLength(1);

    const retainedClient = createMockClient({
      authServices: [{ name: "auth-a", publishSessionEvents: true, label: appName }],
      machineUsers: [managerMachineUserRemote],
      userProfileConfig: {
        userProfileProviderConfig: {
          providerType: UserProfileProviderConfig_UserProfileProviderType.TAILORDB,
        },
      },
    });
    const retainedTarget = await planAuth(createContext(retainedClient, strippedApplication));

    expect(retainedTarget.changeSet.userProfileConfig.deletes).toHaveLength(1);
    await applyAuth(retainedClient, retainedTarget, "create-update-prerequisites");
    expect(retainedClient.deleteUserProfileConfig).not.toHaveBeenCalled();
    await applyAuth(retainedClient, retainedTarget, "delete-resources");
    expect(retainedClient.deleteUserProfileConfig).toHaveBeenCalledTimes(1);

    const migratedTarget = await planAuth(
      createContext(createMockClient(), createMockApplicationWithUserProfile()),
    );

    expect(migratedTarget.changeSet.userProfileConfig.creates).toHaveLength(1);
  });

  test("marks auth service, machine user, and oauth2 client unchanged when remote matches", async () => {
    const client = createMockClient({
      authServices: [{ name: "auth-a", publishSessionEvents: true, label: appName }],
      machineUsers: [managerMachineUserRemote],
      oauth2Clients: [
        remoteOAuth2Client({
          redirectUris: ["https://a.example.com/callback", "https://b.example.com/callback"],
          accessTokenLifetime: { seconds: 86400n },
          refreshTokenLifetime: { seconds: 604800n },
        }),
      ],
    });

    const result = await planAuth(createContext(client));

    expect(result.changeSet.service.unchanged).toHaveLength(1);
    expect(result.changeSet.machineUser.unchanged).toHaveLength(1);
    expect(result.changeSet.oauth2Client.unchanged).toHaveLength(1);
    expect(result.changeSet.service.updates).toHaveLength(0);
    expect(result.changeSet.machineUser.updates).toHaveLength(0);
    expect(result.changeSet.oauth2Client.updates).toHaveLength(0);
  });

  test("registers an existing machine user's secret fetched during planning", async () => {
    const client = createMockClient({
      authServices: [{ name: "auth-a", publishSessionEvents: true, label: appName }],
      machineUsers: [managerMachineUserRemote],
    });
    using registerSecretSpy = vi.spyOn(logger, "registerSecret").mockImplementation(() => {});

    await planAuth(createContext(client));

    expect(registerSecretSpy).toHaveBeenCalledWith(managerMachineUserRemote.clientSecret);
  });

  test("registers a deleted auth service's machine user and oauth2 client secrets before scheduling removal", async () => {
    using registerSecretSpy = vi.spyOn(logger, "registerSecret").mockImplementation(() => {});
    const client = createMockClient({
      authServices: [{ name: "auth-a", publishSessionEvents: true, label: appName }],
      machineUsers: [managerMachineUserRemote],
      oauth2Clients: [
        {
          ...remoteOAuth2Client({
            redirectUris: ["https://a.example.com/callback"],
            accessTokenLifetime: { seconds: 86400n },
            refreshTokenLifetime: { seconds: 604800n },
          }),
          clientSecret: "removed-oauth2-client-secret",
        },
      ],
    });
    const application = {
      ...createMockApplication(),
      authService: undefined,
    } as unknown as Application;

    const result = await planAuth(createContext(client, application));

    expect(result.changeSet.service.deletes.map((del) => del.name)).toContain("auth-a");
    expect(registerSecretSpy).toHaveBeenCalledWith(managerMachineUserRemote.clientSecret);
    expect(registerSecretSpy).toHaveBeenCalledWith("removed-oauth2-client-secret");
  });

  test("marks a SAML idpConfig unchanged when its remote proto materializes defaults", async () => {
    const application = createMockApplicationWithSamlIdP();
    const createResult = await planAuth(createContext(createMockClient(), application));
    const desired = createResult.changeSet.idpConfig.creates[0]?.request.idpConfig;
    expect(desired).toBeDefined();
    const remote = create(AuthIDPConfigSchema, desired);
    const client = createMockClient({
      authServices: [{ name: "auth-a", publishSessionEvents: true, label: appName }],
      authIdPConfigs: [remote],
    });

    const result = await planAuth(createContext(client, application));

    expect(result.changeSet.idpConfig.unchanged).toHaveLength(1);
    expect(result.changeSet.idpConfig.updates).toHaveLength(0);
  });

  test("marks a user profile unchanged when a remote nested proto has an implicit default", async () => {
    const application = createMockApplicationWithUserProfile({ includeAttributes: false });
    const createResult = await planAuth(createContext(createMockClient(), application));
    const desired =
      createResult.changeSet.userProfileConfig.creates[0]?.request.userProfileProviderConfig;
    expect(desired).toBeDefined();
    const remote = create(UserProfileProviderConfigSchema, desired);
    const desiredConfig = desired?.config?.config;
    const remoteConfig = remote.config?.config;
    if (desiredConfig?.case !== "tailordb" || remoteConfig?.case !== "tailordb") {
      throw new Error("Expected TailorDB user profile configs");
    }
    expect(desiredConfig.value.attributeMap).toBeUndefined();
    expect(remoteConfig.value.attributeMap).toEqual({});
    const client = createMockClient({
      authServices: [{ name: "auth-a", publishSessionEvents: true, label: appName }],
      userProfileConfig: { userProfileProviderConfig: remote },
    });

    const result = await planAuth(createContext(client, application));

    expect(result.changeSet.userProfileConfig.unchanged).toHaveLength(1);
    expect(result.changeSet.userProfileConfig.updates).toHaveLength(0);
  });

  test("marks a tenant provider unchanged when its remote proto materializes defaults", async () => {
    const application = createMockApplicationWithTenantProvider();
    const createResult = await planAuth(createContext(createMockClient(), application));
    const desired = createResult.changeSet.tenantConfig.creates[0]?.request.tenantProviderConfig;
    expect(desired).toBeDefined();
    const remote = create(TenantProviderConfigSchema, desired);
    const client = createMockClient({
      authServices: [{ name: "auth-a", publishSessionEvents: true, label: appName }],
      tenantConfig: { tenantProviderConfig: remote },
    });

    const result = await planAuth(createContext(client, application));

    expect(result.changeSet.tenantConfig.unchanged).toHaveLength(1);
    expect(result.changeSet.tenantConfig.updates).toHaveLength(0);
  });

  test("marks machine user without attributes unchanged when remote attribute map is empty", async () => {
    const application = {
      name: appName,
      staticWebsiteServices: [],
      authService: {
        resolveNamespaces: vi.fn().mockResolvedValue(undefined),
        connections: {},
        config: {
          name: "auth-a",
          publishSessionEvents: true,
          machineUsers: {
            // parse output for a machine user whose attributes were all
            // omitted or normalized away (null/undefined values)
            "bare-machine-user": { attributes: undefined },
          },
        },
        userProfile: undefined,
      },
    } as unknown as Application;

    const client = createMockClient({
      authServices: [{ name: "auth-a", publishSessionEvents: true, label: appName }],
      machineUsers: [{ name: "bare-machine-user", attributes: [], attributeMap: {} }],
    });

    const result = await planAuth(createContext(client, application));

    expect(result.changeSet.machineUser.unchanged).toHaveLength(1);
    expect(result.changeSet.machineUser.updates).toHaveLength(0);
    expect(result.changeSet.machineUser.creates).toHaveLength(0);
  });

  test("marks auth hook unchanged when remote definition matches", async () => {
    const client = createMockClient({
      authServices: [{ name: "auth-a", publishSessionEvents: true, label: appName }],
      authHook: {
        scriptRef: "auth-hook--auth-a--before-login",
        invoker: {
          namespace: "auth-a",
          machineUserName: "manager-machine-user",
        },
      },
    });

    const result = await planAuth(createContext(client));

    expect(result.changeSet.authHook.unchanged).toHaveLength(1);
    expect(result.changeSet.authHook.unchanged[0]!.name).toBe("auth-a/before-login");
    expect(result.changeSet.authHook.updates).toHaveLength(0);
  });

  test("marks auth hook updated when forceApplyAll is enabled", async () => {
    const client = createMockClient({
      authServices: [{ name: "auth-a", publishSessionEvents: true, label: appName }],
      authHook: {
        scriptRef: "auth-hook--auth-a--before-login",
        invoker: {
          namespace: "auth-a",
          machineUserName: "manager-machine-user",
        },
      },
    });

    const result = await planAuth({
      ...createContext(client),
      forceApplyAll: true,
    });

    expect(result.changeSet.authHook.updates).toHaveLength(1);
    expect(result.changeSet.authHook.updates[0]?.forcedBySdkVersion).toBe(true);
    expect(result.changeSet.authHook.unchanged).toHaveLength(0);
  });

  test("reuses auth hook payload from existence check instead of fetching twice", async () => {
    const client = createMockClient({
      authServices: [{ name: "auth-a", publishSessionEvents: true, label: appName }],
      authHook: {
        scriptRef: "auth-hook--auth-a--before-login",
        invoker: {
          namespace: "auth-a",
          machineUserName: "manager-machine-user",
        },
      },
    });

    await planAuth(createContext(client));

    expect(client.getAuthHook).toHaveBeenCalledTimes(1);
  });

  test("marks auth child resources updated when forceApplyAll is enabled", async () => {
    const client = createMockClient({
      authServices: [{ name: "auth-a", publishSessionEvents: true, label: appName }],
      machineUsers: [managerMachineUserRemote],
      oauth2Clients: [
        remoteOAuth2Client({
          redirectUris: ["https://a.example.com/callback", "https://b.example.com/callback"],
          accessTokenLifetime: { seconds: 86400n },
          refreshTokenLifetime: { seconds: 604800n },
        }),
      ],
    });

    const result = await planAuth({
      ...createContext(client),
      forceApplyAll: true,
    });

    expect(result.changeSet.service.updates).toHaveLength(1);
    expect(result.changeSet.service.updates[0]?.forcedBySdkVersion).toBe(true);
    expect(result.changeSet.service.unchanged).toHaveLength(0);
    expect(result.changeSet.machineUser.updates).toHaveLength(1);
    expect(result.changeSet.machineUser.updates[0]?.forcedBySdkVersion).toBe(true);
    expect(result.changeSet.machineUser.unchanged).toHaveLength(0);
    expect(result.changeSet.oauth2Client.updates).toHaveLength(1);
    expect(result.changeSet.oauth2Client.updates[0]?.forcedBySdkVersion).toBe(true);
    expect(result.changeSet.oauth2Client.unchanged).toHaveLength(0);
  });

  test.each([
    { authorization: bearerSCIMAuthorization, forceApplyAll: false, forced: [], unchanged: 1 },
    { authorization: { type: "oauth2" }, forceApplyAll: false, forced: [], unchanged: 1 },
    { authorization: bearerSCIMAuthorization, forceApplyAll: true, forced: [true], unchanged: 0 },
    { authorization: { type: "oauth2" }, forceApplyAll: true, forced: [true], unchanged: 0 },
  ] satisfies Array<{
    authorization: SCIMAuthorization;
    forceApplyAll: boolean;
    forced: boolean[];
    unchanged: number;
  }>)(
    "plans a $authorization.type SCIM config and resource that match remote with forceApplyAll $forceApplyAll",
    async ({ authorization, forceApplyAll, forced, unchanged }) => {
      const client = createMockClient({
        authServices: [{ name: "auth-a", publishSessionEvents: true, label: appName }],
        scimConfig: remoteSCIMConfig(authorization),
        scimResources: [remoteSCIMResource()],
      });

      const result = await planAuth({
        ...createContext(client, createMockApplicationWithSCIM(authorization)),
        forceApplyAll,
      });

      for (const changeSet of [result.changeSet.scim, result.changeSet.scimResource]) {
        expect(changeSet.updates.map((update) => update.forcedBySdkVersion)).toEqual(forced);
        expect(changeSet.unchanged).toHaveLength(unchanged);
      }
    },
  );

  test("does not mark forceApplyAll updates whose config differs from remote", async () => {
    const client = createMockClient({
      authServices: [{ name: "auth-a", publishSessionEvents: false, label: appName }],
      machineUsers: [{ ...managerMachineUserRemote, attributes: ["role"] }],
      oauth2Clients: [
        remoteOAuth2Client({
          description: "Outdated description",
          redirectUris: ["https://a.example.com/callback", "https://b.example.com/callback"],
          accessTokenLifetime: { seconds: 86400n },
          refreshTokenLifetime: { seconds: 604800n },
        }),
      ],
      authHook: {
        scriptRef: "auth-hook--auth-a--before-login",
        invoker: { namespace: "auth-a", machineUserName: "another-machine-user" },
      },
      scimConfig: remoteSCIMConfig(bearerSCIMAuthorization, "another-machine-user"),
      scimResources: [remoteSCIMResource("Outdated description")],
    });

    const result = await planAuth({
      ...createContext(client, createMockApplicationWithSCIM(bearerSCIMAuthorization)),
      forceApplyAll: true,
    });

    for (const updates of [
      result.changeSet.service.updates,
      result.changeSet.machineUser.updates,
      result.changeSet.oauth2Client.updates,
      result.changeSet.authHook.updates,
      result.changeSet.scim.updates,
      result.changeSet.scimResource.updates,
    ]) {
      expect(updates).toHaveLength(1);
      expect(updates[0]).not.toHaveProperty("forcedBySdkVersion");
    }
  });

  test("does not mark a forceApplyAll auth service update that takes over ownership", async () => {
    const client = createMockClient({
      authServices: [{ name: "auth-a", publishSessionEvents: true, label: "other-app" }],
    });

    const result = await planAuth({ ...createContext(client), forceApplyAll: true });

    expect(result.changeSet.service.updates).toHaveLength(1);
    expect(result.changeSet.service.updates[0]).not.toHaveProperty("forcedBySdkVersion");
  });

  test("marks forceApplyAll idpConfig, user profile, and tenant provider updates that match remote", async () => {
    const application = createMockApplicationWithTenantProvider();
    const samlApplication = createMockApplicationWithSamlIdP();
    const profileApplication = createMockApplicationWithUserProfile({ includeAttributes: false });
    const combined = {
      ...application,
      authService: {
        ...profileApplication.authService,
        config: {
          ...application.authService?.config,
          idProvider: samlApplication.authService?.config.idProvider,
        },
      },
    } as unknown as Application;
    const createResult = await planAuth(createContext(createMockClient(), combined));
    const idpConfig = createResult.changeSet.idpConfig.creates[0]?.request.idpConfig;
    const userProfile =
      createResult.changeSet.userProfileConfig.creates[0]?.request.userProfileProviderConfig;
    const tenant = createResult.changeSet.tenantConfig.creates[0]?.request.tenantProviderConfig;
    expect(idpConfig && userProfile && tenant).toBeDefined();
    const client = createMockClient({
      authServices: [{ name: "auth-a", publishSessionEvents: true, label: appName }],
      authIdPConfigs: [create(AuthIDPConfigSchema, idpConfig)],
      userProfileConfig: {
        userProfileProviderConfig: create(UserProfileProviderConfigSchema, userProfile),
      },
      tenantConfig: { tenantProviderConfig: create(TenantProviderConfigSchema, tenant) },
    });

    const result = await planAuth({ ...createContext(client, combined), forceApplyAll: true });

    for (const updates of [
      result.changeSet.idpConfig.updates,
      result.changeSet.userProfileConfig.updates,
      result.changeSet.tenantConfig.updates,
    ]) {
      expect(updates).toHaveLength(1);
      expect(updates[0]?.forcedBySdkVersion).toBe(true);
    }
  });

  test("marks oauth2 client unchanged when custom token lifetimes match remote values", async () => {
    const client = createMockClient({
      authServices: [{ name: "auth-a", publishSessionEvents: false, label: appName }],
      oauth2Clients: [
        remoteOAuth2Client({
          redirectUris: ["https://a.example.com/callback", "https://b.example.com/callback"],
          accessTokenLifetime: { seconds: 3600n },
          refreshTokenLifetime: { seconds: 7200n },
        }),
      ],
    });

    const result = await planAuth(
      createContext(client, createMockApplicationWithCustomOAuth2Lifetimes()),
    );

    expect(result.changeSet.oauth2Client.unchanged).toHaveLength(1);
    expect(result.changeSet.oauth2Client.unchanged[0]?.name).toBe("sample");
    expect(result.changeSet.oauth2Client.updates).toHaveLength(0);
  });

  // Regression: drive planAuth through the real defineApplication pipeline (parse ->
  // createAuthService) so oauth2 token lifetimes flow exactly as they do at deploy.
  test("handles oauth2 token lifetimes through the real defineApplication pipeline", async () => {
    const application = defineApplication({
      config: {
        ...defineConfig({
          name: appName,
          auth: defineAuth("auth-a", {
            machineUserAttributes: { role: t.string() },
            oauth2Clients: {
              sample: {
                description: "Sample client",
                grantTypes: ["authorization_code", "refresh_token"],
                redirectURIs: ["https://a.example.com/callback", "https://b.example.com/callback"],
                clientType: "confidential",
                accessTokenLifetimeSeconds: 3600,
                refreshTokenLifetimeSeconds: 7200,
                requireDpop: false,
              },
            },
          }),
        }),
        path: "tailor.config.ts",
      },
    });

    const client = createMockClient({
      authServices: [{ name: "auth-a", publishSessionEvents: false, label: appName }],
      oauth2Clients: [
        remoteOAuth2Client({
          redirectUris: ["https://a.example.com/callback", "https://b.example.com/callback"],
          accessTokenLifetime: { seconds: 3600n },
          refreshTokenLifetime: { seconds: 7200n },
        }),
      ],
    });

    const result = await planAuth({
      client,
      workspaceId,
      application,
      forRemoval: false,
      config: { path: "/test/tailor.config.ts" } as PlanContext["config"],
    });

    expect(result.changeSet.oauth2Client.unchanged).toHaveLength(1);
    expect(result.changeSet.oauth2Client.unchanged[0]?.name).toBe("sample");
    expect(result.changeSet.oauth2Client.updates).toHaveLength(0);
  });

  test("marks oauth2 client unchanged when description is omitted locally and remote is empty string", async () => {
    const app = {
      name: appName,
      staticWebsiteServices: [],
      authService: {
        resolveNamespaces: vi.fn().mockResolvedValue(undefined),
        connections: {},
        config: {
          name: "auth-a",
          oauth2Clients: {
            sample: {
              grantTypes: ["authorization_code", "refresh_token"],
              redirectURIs: ["https://a.example.com/callback"],
              clientType: "confidential",
            },
          },
        },
        userProfile: undefined,
      },
    } as unknown as Application;

    const client = createMockClient({
      authServices: [{ name: "auth-a", publishSessionEvents: false, label: appName }],
      oauth2Clients: [
        remoteOAuth2Client({
          // Platform returns the proto default empty string when no description was set
          description: "",
          redirectUris: ["https://a.example.com/callback"],
          accessTokenLifetime: { seconds: 86400n },
          refreshTokenLifetime: { seconds: 604800n },
        }),
      ],
    });

    const result = await planAuth(createContext(client, app));

    expect(result.changeSet.oauth2Client.unchanged).toHaveLength(1);
    expect(result.changeSet.oauth2Client.updates).toHaveLength(0);
  });

  test("marks auth service updated when remote publishSessionEvents differs", async () => {
    const client = createMockClient({
      authServices: [{ name: "auth-a", publishSessionEvents: false, label: appName }],
    });

    const result = await planAuth(createContext(client));

    expect(result.changeSet.service.updates).toHaveLength(1);
    expect(result.changeSet.service.unchanged).toHaveLength(0);
  });

  test("marks auth service updated when config matches but ownership metadata is missing", async () => {
    const client = createMockClient({
      authServices: [{ name: "auth-a", publishSessionEvents: true }],
    });

    const result = await planAuth(createContext(client));

    expect(result.changeSet.service.updates).toHaveLength(1);
    expect(result.changeSet.service.unchanged).toHaveLength(0);
    expect(result.unmanaged).toEqual([
      { resourceType: "auth.service", resourceLabel: "Auth service", resourceName: "auth-a" },
    ]);
  });

  test("marks auth service updated when config matches but resource is owned by another app", async () => {
    const client = createMockClient({
      authServices: [{ name: "auth-a", publishSessionEvents: true, label: "other-app" }],
    });

    const result = await planAuth(createContext(client));

    expect(result.changeSet.service.updates).toHaveLength(1);
    expect(result.changeSet.service.unchanged).toHaveLength(0);
    expect(result.conflicts).toHaveLength(1);
  });

  test("falls back to create when built-in IdP is not found during idpConfig diff", async () => {
    const client = createMockClient({
      authServices: [{ name: "auth-a", publishSessionEvents: false, label: appName }],
    });

    const result = await planAuth(createContext(client, createMockApplicationWithBuiltInIdP()));

    expect(result.changeSet.idpConfig.creates).toHaveLength(1);
    expect(result.changeSet.idpConfig.creates[0]?.name).toBe("default");
    expect(result.changeSet.idpConfig.updates).toHaveLength(0);
    expect(result.changeSet.idpConfig.unchanged).toHaveLength(0);
  });

  test("falls back to update when built-in IdP is not found but auth idpConfig already exists", async () => {
    const client = createMockClient({
      authServices: [{ name: "auth-a", publishSessionEvents: false, label: appName }],
      authIdPConfigs: [{ name: "default" }],
    });

    const result = await planAuth(createContext(client, createMockApplicationWithBuiltInIdP()));

    expect(result.changeSet.idpConfig.creates).toHaveLength(0);
    expect(result.changeSet.idpConfig.updates).toHaveLength(1);
    expect(result.changeSet.idpConfig.updates[0]?.name).toBe("default");
    expect(result.changeSet.idpConfig.unchanged).toHaveLength(0);
  });

  test("plans a SCIM config and a login hook whose machine users the Auth service defines", async () => {
    const result = await planAuth(
      createContext(
        createMockClient(),
        createMockApplicationNamingMachineUsers({
          machineUsers: ["manager-machine-user"],
          scimMachineUser: "manager-machine-user",
          hookInvoker: "manager-machine-user",
        }),
      ),
    );

    expect(result.changeSet.scim.creates).toHaveLength(1);
    expect(result.changeSet.authHook.creates).toHaveLength(1);
  });

  test.each([
    {
      label: "a SCIM machine user that the workspace has but the config drops",
      remoteMachineUsers: ["manager-machine-user", "scim-bot"],
      references: { machineUsers: ["manager-machine-user"], scimMachineUser: "scim-bot" },
      message:
        'Auth service "auth-a" names machine user "scim-bot" in scim.machineUserName, but defines no machine user with that name.',
      suggestion:
        "Add each listed machine user to machineUsers, or name a defined one instead: manager-machine-user.",
      missing: [{ field: "scim.machineUserName", machineUserName: "scim-bot" }],
    },
    {
      label: "a login hook invoker and a SCIM machine user when the Auth service defines none",
      remoteMachineUsers: [],
      references: {
        machineUsers: [],
        scimMachineUser: "scim-bot",
        hookInvoker: "manager-machine-user",
      },
      message: [
        'Auth service "auth-a" names machine user "scim-bot" in scim.machineUserName, but defines no machine user with that name.',
        'Auth service "auth-a" names machine user "manager-machine-user" in hooks.beforeLogin.invoker, but defines no machine user with that name.',
      ].join("\n"),
      suggestion: "Add each listed machine user to machineUsers.",
      missing: [
        { field: "scim.machineUserName", machineUserName: "scim-bot" },
        { field: "hooks.beforeLogin.invoker", machineUserName: "manager-machine-user" },
      ],
    },
  ])("rejects $label", async ({ remoteMachineUsers, references, message, suggestion, missing }) => {
    const client = createMockClient({
      authServices: [{ name: "auth-a", publishSessionEvents: true, label: appName }],
      machineUsers: remoteMachineUsers.map((name) => ({ name, attributes: [], attributeMap: {} })),
    });

    await expect(
      planAuth(createContext(client, createMockApplicationNamingMachineUsers(references))),
    ).rejects.toMatchObject({
      code: "AUTH_MACHINE_USER_NOT_FOUND",
      message,
      suggestion,
      context: { authNamespace: "auth-a", missing, machineUsers: references.machineUsers },
    });
  });

  test("does not mark a forceApplyAll idpConfig update that has nothing to compare against", async () => {
    const client = createMockClient({
      authServices: [{ name: "auth-a", publishSessionEvents: false, label: appName }],
      authIdPConfigs: [{ name: "default" }],
    });

    const result = await planAuth({
      ...createContext(client, createMockApplicationWithBuiltInIdP()),
      forceApplyAll: true,
    });

    expect(result.changeSet.idpConfig.updates).toHaveLength(1);
    expect(result.changeSet.idpConfig.updates[0]).not.toHaveProperty("forcedBySdkVersion");
  });

  describe("OAuth2 redirect URI resolution on first deployment (issue #1030)", () => {
    function createApplicationWithStaticWebsiteRedirectURI(): Application {
      return {
        name: appName,
        staticWebsiteServices: [{ name: "my-frontend" }],
        authService: {
          resolveNamespaces: vi.fn().mockResolvedValue(undefined),
          connections: {},
          config: {
            name: "auth-a",
            oauth2Clients: {
              sample: {
                description: "Sample client",
                grantTypes: ["authorization_code", "refresh_token"],
                redirectURIs: ["my-frontend:url/callback"],
                clientType: "confidential",
                requireDpop: false,
              },
            },
          },
          userProfile: undefined,
        },
      } as unknown as Application;
    }

    test("does not warn when redirect URI references a locally-defined static website that is not yet on the platform", async () => {
      using warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      const baseClient = createMockClient({});
      const client = {
        ...baseClient,
        getStaticWebsite: vi.fn().mockRejectedValue(new ConnectError("not found", Code.NotFound)),
      } as unknown as OperatorClient;

      const result = await planAuth(
        createContext(client, createApplicationWithStaticWebsiteRedirectURI()),
      );

      expect(result.changeSet.oauth2Client.creates).toHaveLength(1);
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });
});

describe("formatAuthHookChangeEntries", () => {
  const authHookChanges = {
    creates: [],
    updates: [{ name: "my-auth/before-login" }],
    deletes: [],
    replaces: [],
  };

  test.each([
    {
      name: "groups auth hook updates with related function registry updates",
      functionChanges: {
        creates: [],
        updates: [{ name: "auth-hook--my-auth--before-login" }],
        deletes: [],
        replaces: [],
      },
      expected: [
        {
          action: "update",
          symbol: symbols.update,
          name: "before-login",
          labels: ["authHook", "function"],
          namespace: "my-auth",
        },
      ],
    },
    {
      name: "keeps cross-action function registry changes separate from auth hook updates",
      functionChanges: {
        creates: [{ name: "auth-hook--my-auth--before-login" }],
        updates: [],
        deletes: [],
        replaces: [],
      },
      expected: [
        {
          action: "update",
          symbol: symbols.update,
          name: "before-login",
          labels: ["authHook"],
          namespace: "my-auth",
        },
        {
          action: "create",
          symbol: symbols.create,
          name: "before-login",
          labels: ["function"],
          namespace: "my-auth",
        },
      ],
    },
  ])("$name", ({ functionChanges, expected }) => {
    const entries = formatAuthHookChangeEntries(authHookChanges, functionChanges);

    expect(entries).toEqual(expected);
  });
});
