import { fromJson } from "@bufbuild/protobuf";
import { ValueSchema } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import {
  AuthOAuth2Client_ClientType,
  AuthOAuth2Client_GrantType,
} from "@tailor-proto/tailor/v1/auth_resource_pb";
import { describe, expect, test, vi } from "vitest";
import { formatAuthHookChangeEntries, planAuth } from "./auth";
import type { PlanContext } from "./apply";
import type { Application } from "@/cli/services/application";
import type { OperatorClient } from "@/cli/shared/client";

vi.mock("./label", async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    buildMetaRequest: vi.fn().mockResolvedValue({
      trn: "trn:v1:workspace:test-workspace:auth:auth-a",
      labels: {
        "sdk-name": "test-app",
        "sdk-version": "v1-0-0",
      },
    }),
  };
});

vi.mock("./change-set", async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  const createChangeSet = original.createChangeSet as (title: string) => {
    print: () => void;
  };
  return {
    ...original,
    createChangeSet: (title: string) => ({
      ...createChangeSet(title),
      print: () => {},
    }),
  };
});

const workspaceId = "test-workspace";
const appName = "test-app";
const sdkVersion = "v1-0-0";

function createMockApplication(): Application {
  return {
    name: appName,
    authService: {
      resolveNamespaces: vi.fn().mockResolvedValue(undefined),
      parsedConfig: {
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

function createMockApplicationWithCustomOAuth2Lifetimes(): Application {
  return {
    name: appName,
    authService: {
      resolveNamespaces: vi.fn().mockResolvedValue(undefined),
      parsedConfig: {
        name: "auth-a",
        oauth2Clients: {
          sample: {
            description: "Sample client",
            grantTypes: ["authorization_code", "refresh_token"],
            redirectURIs: ["https://b.example.com/callback", "https://a.example.com/callback"],
            clientType: "confidential",
            accessTokenLifetimeSeconds: 3600,
            refreshTokenLifetimeSeconds: 7200,
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
    authService: {
      resolveNamespaces: vi.fn().mockResolvedValue(undefined),
      parsedConfig: {
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

function notFound(): never {
  throw new ConnectError("not found", Code.NotFound);
}

function createMockClient(opts?: {
  authServices?: Array<{
    name: string;
    publishSessionEvents: boolean;
    label?: string;
  }>;
  authIdPConfigs?: Array<{
    name: string;
    authType?: number;
    config?: Record<string, unknown>;
  }>;
  machineUsers?: Array<{
    name: string;
    attributes: string[];
    attributeMap: Record<string, ReturnType<typeof fromJson<typeof ValueSchema>>>;
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
  }>;
  authHook?: {
    scriptRef: string;
    invoker?: {
      namespace: string;
      machineUserName: string;
    };
  };
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
    getUserProfileConfig: vi.fn().mockImplementation(notFound),
    getTenantConfig: vi.fn().mockImplementation(notFound),
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
    getAuthSCIMConfig: vi.fn().mockImplementation(notFound),
    getAuthSCIMResources: vi.fn().mockResolvedValue({
      scimResources: [],
    }),
    listAuthConnections: vi.fn().mockResolvedValue({
      connections: [],
      nextPageToken: "",
    }),
  } as unknown as OperatorClient;
}

function createContext(client: OperatorClient): PlanContext {
  return {
    client,
    workspaceId,
    application: createMockApplication(),
    forRemoval: false,
    config: { path: "/test/tailor.config.ts" } as PlanContext["config"],
  };
}

function createBuiltInIdPContext(client: OperatorClient): PlanContext {
  return {
    client,
    workspaceId,
    application: createMockApplicationWithBuiltInIdP(),
    forRemoval: false,
    config: { path: "/test/tailor.config.ts" } as PlanContext["config"],
  };
}

function createCustomOAuth2LifetimeContext(client: OperatorClient): PlanContext {
  return {
    client,
    workspaceId,
    application: createMockApplicationWithCustomOAuth2Lifetimes(),
    forRemoval: false,
    config: { path: "/test/tailor.config.ts" } as PlanContext["config"],
  };
}

describe("planAuth", () => {
  test("marks auth service, machine user, and oauth2 client unchanged when remote matches", async () => {
    const client = createMockClient({
      authServices: [{ name: "auth-a", publishSessionEvents: true, label: appName }],
      machineUsers: [
        {
          name: "manager-machine-user",
          attributes: ["role", "department"],
          attributeMap: {
            department: fromJson(ValueSchema, "sales"),
            role: fromJson(ValueSchema, "manager"),
          },
        },
      ],
      oauth2Clients: [
        {
          name: "sample",
          description: "Sample client",
          grantTypes: [
            AuthOAuth2Client_GrantType.AUTHORIZATION_CODE,
            AuthOAuth2Client_GrantType.REFRESH_TOKEN,
          ],
          redirectUris: ["https://a.example.com/callback", "https://b.example.com/callback"],
          clientType: AuthOAuth2Client_ClientType.CONFIDENTIAL,
          accessTokenLifetime: { seconds: 86400n },
          refreshTokenLifetime: { seconds: 604800n },
          requireDpop: false,
        },
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
    expect(result.changeSet.authHook.unchanged[0].name).toBe("auth-a/before-login");
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
      machineUsers: [
        {
          name: "manager-machine-user",
          attributes: ["role", "department"],
          attributeMap: {
            department: fromJson(ValueSchema, "sales"),
            role: fromJson(ValueSchema, "manager"),
          },
        },
      ],
      oauth2Clients: [
        {
          name: "sample",
          description: "Sample client",
          grantTypes: [
            AuthOAuth2Client_GrantType.AUTHORIZATION_CODE,
            AuthOAuth2Client_GrantType.REFRESH_TOKEN,
          ],
          redirectUris: ["https://a.example.com/callback", "https://b.example.com/callback"],
          clientType: AuthOAuth2Client_ClientType.CONFIDENTIAL,
          accessTokenLifetime: { seconds: 86400n },
          refreshTokenLifetime: { seconds: 604800n },
          requireDpop: false,
        },
      ],
    });

    const result = await planAuth({
      ...createContext(client),
      forceApplyAll: true,
    });

    expect(result.changeSet.service.updates).toHaveLength(1);
    expect(result.changeSet.service.unchanged).toHaveLength(0);
    expect(result.changeSet.machineUser.updates).toHaveLength(1);
    expect(result.changeSet.machineUser.unchanged).toHaveLength(0);
    expect(result.changeSet.oauth2Client.updates).toHaveLength(1);
    expect(result.changeSet.oauth2Client.unchanged).toHaveLength(0);
  });

  test("marks oauth2 client unchanged when custom token lifetimes match remote values", async () => {
    const client = createMockClient({
      authServices: [{ name: "auth-a", publishSessionEvents: false, label: appName }],
      oauth2Clients: [
        {
          name: "sample",
          description: "Sample client",
          grantTypes: [
            AuthOAuth2Client_GrantType.AUTHORIZATION_CODE,
            AuthOAuth2Client_GrantType.REFRESH_TOKEN,
          ],
          redirectUris: ["https://a.example.com/callback", "https://b.example.com/callback"],
          clientType: AuthOAuth2Client_ClientType.CONFIDENTIAL,
          accessTokenLifetime: { seconds: 3600n },
          refreshTokenLifetime: { seconds: 7200n },
          requireDpop: false,
        },
      ],
    });

    const result = await planAuth(createCustomOAuth2LifetimeContext(client));

    expect(result.changeSet.oauth2Client.unchanged).toHaveLength(1);
    expect(result.changeSet.oauth2Client.unchanged[0]?.name).toBe("sample");
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
    expect(result.unmanaged).toHaveLength(1);
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

    const result = await planAuth(createBuiltInIdPContext(client));

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

    const result = await planAuth(createBuiltInIdPContext(client));

    expect(result.changeSet.idpConfig.creates).toHaveLength(0);
    expect(result.changeSet.idpConfig.updates).toHaveLength(1);
    expect(result.changeSet.idpConfig.updates[0]?.name).toBe("default");
    expect(result.changeSet.idpConfig.unchanged).toHaveLength(0);
  });
});

describe("formatAuthHookChangeEntries", () => {
  test("groups auth hook updates with related function registry updates", () => {
    const entries = formatAuthHookChangeEntries(
      {
        creates: [],
        updates: [
          {
            name: "my-auth/before-login",
          },
        ],
        deletes: [],
        replaces: [],
      },
      {
        creates: [],
        updates: [{ name: "auth-hook--my-auth--before-login" }],
        deletes: [],
        replaces: [],
      },
    );

    expect(entries).toEqual([
      {
        action: "update",
        symbol: "~",
        name: "my-auth/before-login",
        labels: ["authHook", "functionRegistry"],
      },
    ]);
  });

  test("keeps cross-action function registry changes separate from auth hook updates", () => {
    const entries = formatAuthHookChangeEntries(
      {
        creates: [],
        updates: [
          {
            name: "my-auth/before-login",
          },
        ],
        deletes: [],
        replaces: [],
      },
      {
        creates: [{ name: "auth-hook--my-auth--before-login" }],
        updates: [],
        deletes: [],
        replaces: [],
      },
    );

    expect(entries).toEqual([
      {
        action: "update",
        symbol: "~",
        name: "my-auth/before-login",
        labels: ["authHook"],
      },
      {
        action: "create",
        symbol: "+",
        name: "my-auth/before-login",
        labels: ["functionRegistry"],
      },
    ]);
  });
});
