import { IdPLang, IdPPermissionPermit } from "@tailor-platform/tailor-proto/idp_resource_pb";
import { describe, expect, test, vi } from "vitest";
import { planIdP } from "./idp";
import type { Application } from "#/cli/services/application";
import type { OperatorClient } from "#/cli/shared/client";
import type { PlanContext } from "./types";

vi.mock("./label", async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    buildMetaRequest: vi.fn().mockResolvedValue({
      trn: "trn:v1:workspace:test-workspace:idp:idp-a",
      labels: {
        "sdk-name": "test-app",
        "sdk-version": "v1-0-0",
      },
    }),
  };
});

vi.mock("./change-set", async (importOriginal) => importOriginal());

const workspaceId = "test-workspace";
const appName = "test-app";
const sdkVersion = "v1-0-0";

const defaultUserAuthPolicy = {
  useNonEmailIdentifier: false,
  allowSelfPasswordReset: true,
  passwordRequireUppercase: true,
  passwordRequireLowercase: true,
  passwordRequireNonAlphanumeric: false,
  passwordRequireNumeric: true,
  passwordMinLength: 8,
  passwordMaxLength: 64,
  allowedEmailDomains: ["a.example.com", "b.example.com"],
  allowGoogleOauth: false,
  disablePasswordAuth: false,
  allowMicrosoftOauth: false,
};

const defaultDisableGqlOperations = {
  create: false,
  update: false,
  delete: false,
  read: false,
  sendPasswordResetEmail: false,
};

type MockIdpServiceOpts = {
  name?: string;
  clients?: string[];
  publishEvents?: boolean | undefined;
  gqlOperations?: Record<string, boolean | undefined>;
  omitUserAuthPolicy?: boolean;
};

function createMockApplication(opts?: {
  idpServices?: ReadonlyArray<MockIdpServiceOpts>;
}): Application {
  const serviceOpts = opts?.idpServices ?? [{}];
  return {
    name: appName,
    staticWebsiteServices: [],
    idpServices: serviceOpts.map((service) => {
      const result: Record<string, unknown> = {
        name: service.name ?? "idp-a",
        lang: "ja",
        userAuthPolicy: {
          useNonEmailIdentifier: false,
          allowSelfPasswordReset: true,
          passwordRequireUppercase: true,
          passwordRequireLowercase: true,
          passwordRequireNonAlphanumeric: false,
          passwordRequireNumeric: true,
          passwordMinLength: 8,
          passwordMaxLength: 64,
          allowedEmailDomains: ["b.example.com", "a.example.com"],
          allowGoogleOauth: false,
          disablePasswordAuth: false,
          allowMicrosoftOauth: false,
        },
        gqlOperations: {
          create: true,
          update: true,
          delete: true,
          read: true,
          sendPasswordResetEmail: true,
          ...service.gqlOperations,
        },
        clients: service.clients ?? ["default-idp-client"],
      };
      if ("publishEvents" in service) {
        if (service.publishEvents !== undefined) {
          result.publishEvents = service.publishEvents;
        }
      } else {
        result.publishEvents = true;
      }
      if (service.omitUserAuthPolicy) {
        delete result.userAuthPolicy;
      }
      return result;
    }),
  } as unknown as Application;
}

type MockRemoteService = {
  name: string;
  lang: IdPLang;
  publishEvents: boolean;
  userAuthPolicy?: Record<string, unknown>;
  disableGqlOperations?: Record<string, boolean>;
  permission?: Record<string, unknown>;
  label?: string;
};

function createMatchingRemoteService(overrides?: Partial<MockRemoteService>): MockRemoteService {
  return {
    name: "idp-a",
    lang: IdPLang.JA,
    publishEvents: true,
    userAuthPolicy: defaultUserAuthPolicy,
    disableGqlOperations: defaultDisableGqlOperations,
    label: appName,
    ...overrides,
  };
}

function createMockClient(opts?: {
  services?: MockRemoteService[];
  clients?: Record<string, Array<{ name: string; clientSecret: string }>>;
}): OperatorClient {
  const services = opts?.services ?? [];
  const clients = opts?.clients ?? {};

  return {
    listIdPServices: vi.fn().mockResolvedValue({
      idpServices: services.map((service) => ({
        namespace: { name: service.name },
        authorization: "",
        lang: service.lang,
        publishUserEvents: service.publishEvents,
        userAuthPolicy: service.userAuthPolicy,
        disableGqlOperations: service.disableGqlOperations,
        permission: service.permission,
      })),
      nextPageToken: "",
    }),
    listIdPClients: vi.fn().mockImplementation(({ namespaceName }: { namespaceName: string }) => ({
      clients: clients[namespaceName] ?? [],
      nextPageToken: "",
    })),
    getMetadata: vi.fn().mockImplementation(({ trn }: { trn: string }) => {
      const name = trn.split(":").pop();
      const service = services.find((entry) => entry.name === name);
      return {
        metadata: {
          labels: service?.label ? { "sdk-name": service.label, "sdk-version": sdkVersion } : {},
        },
      };
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

const defaultIdpClientSecret = {
  "idp-a": [{ name: "default-idp-client", clientSecret: "secret" }],
};

describe("planIdP", () => {
  test("marks idp service and client unchanged when remote state matches", async () => {
    const client = createMockClient({
      services: [createMatchingRemoteService()],
      clients: defaultIdpClientSecret,
    });

    const result = await planIdP(createContext(client));

    expect(result.changeSet.service.unchanged).toHaveLength(1);
    expect(result.changeSet.client.unchanged).toHaveLength(1);
    expect(result.changeSet.service.updates).toHaveLength(0);
    expect(result.changeSet.client.updates).toHaveLength(0);
  });

  test("marks idp service and client updated when forceApplyAll is enabled", async () => {
    const client = createMockClient({
      services: [createMatchingRemoteService()],
      clients: defaultIdpClientSecret,
    });

    const result = await planIdP({
      ...createContext(client),
      forceApplyAll: true,
    });

    expect(result.changeSet.service.updates).toHaveLength(0);
    expect(result.changeSet.service.unchanged).toHaveLength(1);
    expect(result.changeSet.client.updates).toHaveLength(1);
    expect(result.changeSet.client.unchanged).toHaveLength(0);
  });

  test("marks idp service updated when remote state differs", async () => {
    const client = createMockClient({
      services: [{ name: "idp-a", lang: IdPLang.EN, publishEvents: false, label: appName }],
      clients: defaultIdpClientSecret,
    });

    const result = await planIdP(createContext(client));

    expect(result.changeSet.service.updates).toHaveLength(1);
    expect(result.changeSet.service.unchanged).toHaveLength(0);
  });

  test("marks idp service unchanged when userAuthPolicy is omitted and remote returns server defaults", async () => {
    // The platform fills an omitted userAuthPolicy with its own defaults
    // (password_min_length 6 / password_max_length 4096, everything else zero)
    // and echoes them back; that must not read as drift.
    const client = createMockClient({
      services: [
        createMatchingRemoteService({
          userAuthPolicy: {
            useNonEmailIdentifier: false,
            allowSelfPasswordReset: false,
            passwordRequireUppercase: false,
            passwordRequireLowercase: false,
            passwordRequireNonAlphanumeric: false,
            passwordRequireNumeric: false,
            passwordMinLength: 6,
            passwordMaxLength: 4096,
            allowedEmailDomains: [],
            allowGoogleOauth: false,
            disablePasswordAuth: false,
            allowMicrosoftOauth: false,
            enableMfa: false,
            requireMfa: false,
            allowedReturnOrigins: [],
            mfaIssuer: "",
          },
        }),
      ],
      clients: defaultIdpClientSecret,
    });

    const result = await planIdP({
      ...createContext(client),
      application: createMockApplication({ idpServices: [{ omitUserAuthPolicy: true }] }),
    });

    expect(result.changeSet.service.updates).toHaveLength(0);
    expect(result.changeSet.service.unchanged).toHaveLength(1);
  });

  test("marks idp service updated when config matches but ownership metadata is missing", async () => {
    const client = createMockClient({
      services: [createMatchingRemoteService({ label: undefined })],
      clients: defaultIdpClientSecret,
    });

    const result = await planIdP(createContext(client));

    expect(result.changeSet.service.updates).toHaveLength(1);
    expect(result.changeSet.service.unchanged).toHaveLength(0);
    expect(result.unmanaged).toHaveLength(1);
  });

  test("marks idp service updated when config matches but resource is owned by another app", async () => {
    const client = createMockClient({
      services: [createMatchingRemoteService({ label: "other-app" })],
      clients: defaultIdpClientSecret,
    });

    const result = await planIdP(createContext(client));

    expect(result.changeSet.service.updates).toHaveLength(1);
    expect(result.changeSet.service.unchanged).toHaveLength(0);
    expect(result.conflicts).toHaveLength(1);
  });

  test("marks idp service updated when permission changes", async () => {
    const client = createMockClient({
      services: [createMatchingRemoteService()],
      clients: defaultIdpClientSecret,
    });

    const context = createContext(client);
    // oxlint-disable-next-line no-explicit-any
    (context.application as any).idpServices[0].permission = {
      create: [{ conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true }],
      read: [{ conditions: [], permit: true }],
      update: [{ conditions: [], permit: true }],
      delete: [{ conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true }],
      sendPasswordResetEmail: [{ conditions: [], permit: true }],
      unenrollMfa: [{ conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true }],
    };

    const result = await planIdP(context);

    expect(result.changeSet.service.updates).toHaveLength(1);
    expect(result.changeSet.service.unchanged).toHaveLength(0);
  });

  test("marks idp service unchanged when permission policies omit description and remote returns empty string", async () => {
    const client = createMockClient({
      services: [
        createMatchingRemoteService({
          // Platform returns the proto default empty string for policy descriptions
          permission: {
            create: [{ conditions: [], permit: IdPPermissionPermit.ALLOW, description: "" }],
            read: [],
            update: [],
            delete: [],
            sendPasswordResetEmail: [],
            unenrollMfa: [],
          },
        }),
      ],
      clients: defaultIdpClientSecret,
    });

    const context = createContext(client);
    // oxlint-disable-next-line no-explicit-any
    (context.application as any).idpServices[0].permission = {
      create: [{ conditions: [], permit: true }],
      read: [],
      update: [],
      delete: [],
      sendPasswordResetEmail: [],
      unenrollMfa: [],
    };

    const result = await planIdP(context);

    expect(result.changeSet.service.unchanged).toHaveLength(1);
    expect(result.changeSet.service.updates).toHaveLength(0);
  });

  test("marks idp service unchanged when permission is omitted and remote is empty permission", async () => {
    const client = createMockClient({
      services: [
        createMatchingRemoteService({
          permission: {
            create: [],
            read: [],
            update: [],
            delete: [],
            sendPasswordResetEmail: [],
            unenrollMfa: [],
          },
        }),
      ],
      clients: defaultIdpClientSecret,
    });

    const result = await planIdP(createContext(client));

    expect(result.changeSet.service.unchanged).toHaveLength(1);
    expect(result.changeSet.service.updates).toHaveLength(0);
  });

  test("creates idp client when it does not exist remotely", async () => {
    const client = createMockClient({
      services: [{ name: "idp-a", lang: IdPLang.JA, publishEvents: true, label: appName }],
      clients: { "idp-a": [] },
    });

    const result = await planIdP(createContext(client));

    expect(result.changeSet.client.creates).toHaveLength(1);
    expect(result.changeSet.client.unchanged).toHaveLength(0);
  });
});

describe("planIdP / gqlOperations MFA mapping", () => {
  test.each`
    label                                       | gqlOperations                                           | expected
    ${"defaults to false when not disabled"}    | ${undefined}                                            | ${false}
    ${"flips to true when explicitly disabled"} | ${{ requestMfaSettingsUrl: false, unenrollMfa: false }} | ${true}
  `("$label", async ({ gqlOperations, expected }) => {
    const app = createMockApplication(
      gqlOperations ? { idpServices: [{ gqlOperations }] } : undefined,
    );
    const client = createMockClient({ services: [], clients: { "idp-a": [] } });

    const result = await planIdP({
      ...createContext(client),
      application: app,
      idpUserTriggerTargets: new Set(),
    });

    expect(result.changeSet.service.creates).toHaveLength(1);
    const request = result.changeSet.service.creates[0]!.request;
    expect(request.disableGqlOperations?.requestMfaSettingsUrl).toBe(expected);
    expect(request.disableGqlOperations?.unenrollMfa).toBe(expected);
  });
});

describe("planIdP / publishEvents auto-configuration", () => {
  test("undefined publishEvents stays false when no executor uses idpUser trigger", async () => {
    const app = createMockApplication({ idpServices: [{ publishEvents: undefined }] });
    const client = createMockClient({ services: [], clients: { "idp-a": [] } });

    const result = await planIdP({
      ...createContext(client),
      application: app,
      idpUserTriggerTargets: new Set(),
    });

    expect(result.changeSet.service.creates).toHaveLength(1);
    expect(result.changeSet.service.creates[0]!.request.publishUserEvents).toBe(false);
  });

  test("undefined publishEvents is auto-enabled when the IdP is targeted by an idpUser trigger", async () => {
    const app = createMockApplication({ idpServices: [{ publishEvents: undefined }] });
    const client = createMockClient({ services: [], clients: { "idp-a": [] } });

    const result = await planIdP({
      ...createContext(client),
      application: app,
      idpUserTriggerTargets: new Set(["idp-a"]),
    });

    expect(result.changeSet.service.creates).toHaveLength(1);
    expect(result.changeSet.service.creates[0]!.request.publishUserEvents).toBe(true);
  });

  test("explicit publishEvents:true stays true", async () => {
    const app = createMockApplication({ idpServices: [{ publishEvents: true }] });
    const client = createMockClient({ services: [], clients: { "idp-a": [] } });

    const result = await planIdP({
      ...createContext(client),
      application: app,
      idpUserTriggerTargets: new Set(["idp-a"]),
    });

    expect(result.changeSet.service.creates[0]!.request.publishUserEvents).toBe(true);
  });

  test("explicit publishEvents:false throws when executor targets the IdP", async () => {
    const app = createMockApplication({ idpServices: [{ publishEvents: false }] });
    const client = createMockClient({ services: [], clients: { "idp-a": [] } });

    await expect(
      planIdP({
        ...createContext(client),
        application: app,
        idpUserTriggerTargets: new Set(["idp-a"]),
      }),
    ).rejects.toThrow(/publishEvents.*false/);
  });

  test("publishEvents:false on a non-targeted IdP is honored when executors only target other IdPs", async () => {
    const app = createMockApplication({
      idpServices: [
        { publishEvents: undefined },
        { name: "idp-b", clients: ["client-b"], publishEvents: false },
      ],
    });
    const client = createMockClient({
      services: [],
      clients: { "idp-a": [], "idp-b": [] },
    });

    const result = await planIdP({
      ...createContext(client),
      application: app,
      idpUserTriggerTargets: new Set(["idp-a"]),
    });

    expect(result.changeSet.service.creates).toHaveLength(2);
    const byName = new Map(
      result.changeSet.service.creates.map((create) => [create.name, create.request]),
    );
    expect(byName.get("idp-a")?.publishUserEvents).toBe(true);
    expect(byName.get("idp-b")?.publishUserEvents).toBe(false);
  });

  test("auto-enables publishEvents only on IdPs targeted by idpUser triggers", async () => {
    const app = createMockApplication({
      idpServices: [
        { publishEvents: undefined },
        { name: "idp-b", clients: ["client-b"], publishEvents: undefined },
      ],
    });
    const client = createMockClient({
      services: [],
      clients: { "idp-a": [], "idp-b": [] },
    });

    const result = await planIdP({
      ...createContext(client),
      application: app,
      idpUserTriggerTargets: new Set(["idp-a"]),
    });

    expect(result.changeSet.service.creates).toHaveLength(2);
    const byName = new Map(
      result.changeSet.service.creates.map((create) => [create.name, create.request]),
    );
    expect(byName.get("idp-a")?.publishUserEvents).toBe(true);
    expect(byName.get("idp-b")?.publishUserEvents).toBe(false);
  });
});
