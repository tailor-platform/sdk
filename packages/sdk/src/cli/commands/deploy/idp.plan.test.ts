import { IdPLang, IdPPermissionPermit } from "@tailor-platform/tailor-proto/idp_resource_pb";
import { describe, expect, test, vi } from "vitest";
import { logger } from "#/cli/shared/logger";
import { mockOperatorClient } from "#/cli/shared/test-helpers/operator-client";
import { silenceLogger } from "#/cli/shared/test-helpers/silence-logger";
import { planIdP } from "./idp";
import { applicationOwner, buildMetaRequest } from "./label";
import type { Application } from "#/cli/services/application";
import type { OperatorClient } from "#/cli/shared/client";
import type { PlanContext } from "./types";
import type { MessageInitShape } from "@bufbuild/protobuf";
import type {
  IdPClientSummarySchema,
  IdPDisableGqlOperationsSchema,
  IdPPermissionSchema,
  IdPServiceSchema,
  IdPUserAuthPolicySchema,
} from "@tailor-platform/tailor-proto/idp_resource_pb";

vi.mock("./label", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    buildMetaRequest: vi.fn().mockImplementation(async () => ({
      trn: "trn:v1:workspace:test-workspace:idp:idp-a",
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
} satisfies MessageInitShape<typeof IdPUserAuthPolicySchema>;

const defaultDisableGqlOperations = {
  create: false,
  update: false,
  delete: false,
  read: false,
  sendPasswordResetEmail: false,
} satisfies MessageInitShape<typeof IdPDisableGqlOperationsSchema>;

type MockIdpServiceOpts = {
  name?: string;
  clients?: string[];
  publishEvents?: boolean | undefined;
  gqlOperations?: Record<string, boolean | undefined>;
  omitUserAuthPolicy?: boolean;
  userAuthPolicy?: Record<string, unknown>;
  permission?: Record<string, unknown>;
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
          ...service.userAuthPolicy,
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
      if (service.permission) {
        result.permission = service.permission;
      }
      return result;
    }),
  } as unknown as Application;
}

type MockRemoteService = {
  name: string;
  lang: IdPLang;
  publishEvents: boolean;
  userAuthPolicy?: MessageInitShape<typeof IdPUserAuthPolicySchema>;
  disableGqlOperations?: MessageInitShape<typeof IdPDisableGqlOperationsSchema>;
  permission?: MessageInitShape<typeof IdPPermissionSchema>;
  label?: string;
  sdkVersion?: string;
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

type RemoteIdPClients = Record<string, Array<MessageInitShape<typeof IdPClientSummarySchema>>>;

function createMockClient(opts?: {
  services?: MockRemoteService[];
  clients?: RemoteIdPClients;
}): OperatorClient {
  const services = opts?.services ?? [];
  const clients = opts?.clients ?? {};

  return mockOperatorClient({
    listIdPServices: {
      idpServices: services.map((service): MessageInitShape<typeof IdPServiceSchema> => ({
        namespace: { name: service.name },
        authorization: "",
        lang: service.lang,
        publishUserEvents: service.publishEvents,
        userAuthPolicy: service.userAuthPolicy,
        disableGqlOperations: service.disableGqlOperations,
        permission: service.permission,
      })),
      nextPageToken: "",
    },
    listIdPClients: (request) => ({
      clients: clients[request.namespaceName ?? ""] ?? [],
      nextPageToken: "",
    }),
    getMetadata: (request) => {
      const name = request.trn?.split(":").pop();
      const service = services.find((entry) => entry.name === name);
      const labels: Record<string, string> = service?.label
        ? { "sdk-name": service.label, "sdk-version": service.sdkVersion ?? sdkVersion }
        : {};
      return { metadata: { labels } };
    },
  });
}

function createContext(client: OperatorClient): PlanContext {
  return {
    client,
    workspaceId,
    application: createMockApplication(),
    applications: [],
    owner: applicationOwner(createMockApplication()),
    forRemoval: false,
    config: { path: "/test/tailor.config.ts" },
  };
}

const defaultIdpClients = {
  "idp-a": [{ name: "default-idp-client", clientId: "default-idp-client-id" }],
} satisfies RemoteIdPClients;

describe("planIdP", () => {
  test("marks idp service and client unchanged when remote state matches", async () => {
    const client = createMockClient({
      services: [createMatchingRemoteService()],
      clients: defaultIdpClients,
    });

    const result = await planIdP(createContext(client));

    expect(result.changeSet.service.unchanged).toHaveLength(1);
    expect(result.changeSet.client.unchanged).toHaveLength(1);
    expect(result.changeSet.service.updates).toHaveLength(0);
    expect(result.changeSet.client.updates).toHaveLength(0);
  });

  test("labels a workspace IdP with the applications that list it", async () => {
    await planIdP({
      ...createContext(createMockClient({ services: [], clients: {} })),
      owner: { kind: "workspace" },
      applications: [
        {
          name: "shop",
          subgraphs: [{ Type: "idp", Name: "idp-a" }],
          authNamespace: undefined,
          settings: {},
        },
        {
          name: "admin",
          subgraphs: [{ Type: "idp", Name: "idp-a" }],
          authNamespace: undefined,
          settings: {},
        },
        { name: "landing", subgraphs: [], authNamespace: undefined, settings: {} },
      ],
    });

    expect(buildMetaRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        trn: expect.stringMatching(/:idp:idp-a$/),
        onApps: ["shop", "admin"],
      }),
    );
  });

  test("refreshes the labels of an unchanged idp service whose SDK labels differ", async () => {
    const client = createMockClient({
      services: [createMatchingRemoteService()],
      clients: defaultIdpClients,
    });
    const desiredLabels = { "sdk-name": appName, "sdk-version": sdkVersion, "sdk-app-id": "app-1" };
    vi.mocked(buildMetaRequest).mockImplementationOnce(async ({ trn }) => ({
      trn,
      labels: desiredLabels,
    }));

    const result = await planIdP(createContext(client));

    expect(result.changeSet.service.updates).toEqual([]);
    expect(result.changeSet.service.unchanged).toEqual([
      expect.objectContaining({
        name: "idp-a",
        labelRefresh: expect.objectContaining({ labels: desiredLabels }),
      }),
    ]);
  });

  test("marks idp service and client updated when forceApplyAll is enabled", async () => {
    const client = createMockClient({
      services: [createMatchingRemoteService()],
      clients: defaultIdpClients,
    });

    const result = await planIdP({
      ...createContext(client),
      forceApplyAll: true,
    });

    expect(result.changeSet.service.updates).toHaveLength(0);
    expect(result.changeSet.service.unchanged).toHaveLength(1);
    expect(result.changeSet.client.updates).toHaveLength(1);
    expect(result.changeSet.client.updates[0]?.forcedBySdkVersion).toBe(true);
    expect(result.changeSet.client.unchanged).toHaveLength(0);
  });

  test("marks an idp service update forced by the SDK version when only its sdk-version differs", async () => {
    const client = createMockClient({
      services: [createMatchingRemoteService({ sdkVersion: "v0-9-0" })],
      clients: defaultIdpClients,
    });

    const result = await planIdP(createContext(client));

    expect(result.changeSet.service.updates).toHaveLength(1);
    expect(result.changeSet.service.updates[0]?.forcedBySdkVersion).toBe(true);
  });

  test("does not mark an idp service update whose config also differs as forced by the SDK version", async () => {
    const client = createMockClient({
      services: [createMatchingRemoteService({ lang: IdPLang.EN, sdkVersion: "v0-9-0" })],
      clients: defaultIdpClients,
    });

    const result = await planIdP(createContext(client));

    expect(result.changeSet.service.updates).toHaveLength(1);
    expect(result.changeSet.service.updates[0]).not.toHaveProperty("forcedBySdkVersion");
  });

  test("does not mark an idp service update that takes over ownership as forced by the SDK version", async () => {
    const client = createMockClient({
      services: [createMatchingRemoteService({ label: "other-app" })],
      clients: defaultIdpClients,
    });

    const result = await planIdP(createContext(client));

    expect(result.changeSet.service.updates).toHaveLength(1);
    expect(result.changeSet.service.updates[0]).not.toHaveProperty("forcedBySdkVersion");
  });

  test("marks idp service updated when remote state differs", async () => {
    const client = createMockClient({
      services: [{ name: "idp-a", lang: IdPLang.EN, publishEvents: false, label: appName }],
      clients: defaultIdpClients,
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
      clients: defaultIdpClients,
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
      clients: defaultIdpClients,
    });

    const result = await planIdP(createContext(client));

    expect(result.changeSet.service.updates).toHaveLength(1);
    expect(result.changeSet.service.unchanged).toHaveLength(0);
    expect(result.unmanaged).toEqual([
      { resourceType: "idp.service", resourceLabel: "IdP service", resourceName: "idp-a" },
    ]);
  });

  test("marks idp service updated when config matches but resource is owned by another app", async () => {
    const client = createMockClient({
      services: [createMatchingRemoteService({ label: "other-app" })],
      clients: defaultIdpClients,
    });

    const result = await planIdP(createContext(client));

    expect(result.changeSet.service.updates).toHaveLength(1);
    expect(result.changeSet.service.unchanged).toHaveLength(0);
    expect(result.conflicts).toHaveLength(1);
  });

  test("marks idp service updated when permission changes", async () => {
    const client = createMockClient({
      services: [createMatchingRemoteService()],
      clients: defaultIdpClients,
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
      clients: defaultIdpClients,
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

  const denyAllPermission = {
    create: [],
    read: [],
    update: [],
    delete: [],
    sendPasswordResetEmail: [],
    unenrollMfa: [],
  } satisfies MessageInitShape<typeof IdPPermissionSchema>;

  test.each([
    { case: "denies every operation and remote omits it", local: denyAllPermission },
    {
      case: "denies every operation and remote returns empty lists",
      local: denyAllPermission,
      remote: denyAllPermission,
    },
    { case: "is omitted and remote returns empty lists", remote: denyAllPermission },
  ])(
    "marks idp service unchanged when its permission $case",
    async ({
      local,
      remote,
    }: {
      local?: Record<string, unknown>;
      remote?: typeof denyAllPermission;
    }) => {
      const client = createMockClient({
        services: [createMatchingRemoteService({ permission: remote })],
        clients: defaultIdpClients,
      });
      const context = createContext(client);
      // oxlint-disable-next-line no-explicit-any
      (context.application as any).idpServices[0].permission = local;

      const result = await planIdP(context);

      expect(result.changeSet.service.unchanged).toHaveLength(1);
      expect(result.changeSet.service.updates).toHaveLength(0);
    },
  );

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

describe("planIdP and a client name the platform cannot delete", () => {
  test("warns instead of deleting a removed client with that name", async () => {
    using _logger = silenceLogger("warn");
    const client = createMockClient({
      services: [createMatchingRemoteService()],
      clients: {
        "idp-a": [
          ...defaultIdpClients["idp-a"],
          { name: "c1", clientId: "c1-id" },
          { name: "old-client", clientId: "old-client-id" },
        ],
      },
    });

    const result = await planIdP(createContext(client));

    expect(result.changeSet.client.deletes.map((del) => del.name)).toEqual(["old-client"]);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('IdP client "c1" in "idp-a"'));
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        "The client and its secret vault stay in the workspace. Both are deleted when that IdP is removed.",
      ),
    );
  });

  test("deletes only the vault of such a client of a removed service", async () => {
    using _logger = silenceLogger("warn");
    const client = createMockClient({
      services: [
        createMatchingRemoteService(),
        { name: "idp-removed", lang: IdPLang.JA, publishEvents: true, label: appName },
      ],
      clients: {
        ...defaultIdpClients,
        "idp-removed": [
          { name: "-ab", clientId: "ab-id" },
          { name: "old-client", clientId: "old-client-id" },
        ],
      },
    });

    const result = await planIdP(createContext(client));

    expect(result.changeSet.client.deletes).toEqual([
      expect.objectContaining({ name: "-ab", vaultOnly: true }),
      {
        name: "old-client",
        request: { workspaceId, namespaceName: "idp-removed", name: "old-client" },
      },
    ]);
    expect(result.changeSet.service.deletes.map((del) => del.name)).toEqual(["idp-removed"]);
    expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining("IdP client"));
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

  test("explicit publishEvents:true stays true without a subscribing executor", async () => {
    const app = createMockApplication({ idpServices: [{ publishEvents: true }] });
    const client = createMockClient({ services: [], clients: { "idp-a": [] } });

    const result = await planIdP({
      ...createContext(client),
      application: app,
      idpUserTriggerTargets: new Set(),
    });

    expect(result.changeSet.service.creates[0]!.request.publishUserEvents).toBe(true);
  });

  test("turns a remote opt-in back off once nothing subscribes", async () => {
    const app = createMockApplication({ idpServices: [{ publishEvents: undefined }] });
    const client = createMockClient({
      services: [createMatchingRemoteService({ publishEvents: true })],
      clients: defaultIdpClients,
    });

    const result = await planIdP({
      ...createContext(client),
      application: app,
      idpUserTriggerTargets: new Set(),
    });

    expect(result.changeSet.service.updates).toHaveLength(1);
    expect(result.changeSet.service.updates[0]!.request.publishUserEvents).toBe(false);
  });

  test("keeps a remote opt-in while an executor still subscribes", async () => {
    const app = createMockApplication({ idpServices: [{ publishEvents: undefined }] });
    const client = createMockClient({
      services: [createMatchingRemoteService({ publishEvents: true })],
      clients: defaultIdpClients,
    });

    const result = await planIdP({
      ...createContext(client),
      application: app,
      idpUserTriggerTargets: new Set(["idp-a"]),
    });

    expect(result.changeSet.service.updates).toHaveLength(0);
    expect(result.changeSet.service.unchanged).toHaveLength(1);
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

describe("planIdP and an unchanged service's dependency records", () => {
  const buyer = "0191b0f4-1c4e-7d3a-9f2b-8c5a4e6d7b81";

  test("carries the metadata write on a service whose definition is unchanged", async () => {
    // Only the cross-config subscription changed, so the definition matches and
    // the service is planned as unchanged. Dropping its write here would leave the
    // record on the remote resource and prompt about a config already deployed.
    const client = createMockClient({
      services: [createMatchingRemoteService()],
      clients: defaultIdpClients,
    });

    const result = await planIdP({
      ...createContext(client),
      application: createMockApplication({ idpServices: [{ publishEvents: undefined }] }),
      idpUserTriggerTargets: new Set(["idp-a"]),
      dependentApps: new Map([["idp:idp-a", new Map([[buyer, "publish-events" as const]])]]),
      runAppIds: new Set([buyer]),
    });

    expect(result.changeSet.service.unchanged).toHaveLength(1);
    expect(result.changeSet.service.unchanged[0]?.metaRequest?.dependencies).toEqual([
      {
        dependentApps: new Map([[buyer, "publish-events"]]),
        runAppIds: new Set([buyer]),
        pinned: false,
        scope: undefined,
      },
    ]);
  });
});

describe("planIdP and an implicit all-domains policy", () => {
  test.each([
    ["userAuthPolicy is omitted", { omitUserAuthPolicy: true }],
    ["allowedEmailDomains is empty", { userAuthPolicy: { allowedEmailDomains: [] } }],
  ])("warns when %s", async (_name, service) => {
    using _logger = silenceLogger("warn");
    const client = createMockClient({ services: [], clients: defaultIdpClients });

    await planIdP({
      ...createContext(client),
      application: createMockApplication({ idpServices: [service] }),
    });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        "leaves userAuthPolicy.allowedEmailDomains empty, which the platform rejects when deploy creates or updates the IdP.",
      ),
    );
  });

  test.each([
    ["domains are enumerated", { allowedEmailDomains: ["example.com"] }],
    ["the all-domains entry is set", { allowedEmailDomains: ["*"] }],
    [
      "the namespace uses a non-email identifier",
      { useNonEmailIdentifier: true, allowedEmailDomains: [] },
    ],
  ])("stays quiet when %s", async (_name, userAuthPolicy) => {
    using _logger = silenceLogger("warn");
    const client = createMockClient({ services: [], clients: defaultIdpClients });

    await planIdP({
      ...createContext(client),
      application: createMockApplication({ idpServices: [{ userAuthPolicy }] }),
    });

    expect(logger.warn).not.toHaveBeenCalledWith(
      expect.stringContaining("leaves userAuthPolicy.allowedEmailDomains empty"),
    );
  });
});

describe("planIdP and a _loggedIn permission", () => {
  const adminOnly = [{ conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true }];
  const loggedInOnly = [{ conditions: [[{ user: "_loggedIn" }, "=", true]], permit: true }];
  const permissionWith = (overrides: Record<string, unknown>) => ({
    create: adminOnly,
    read: adminOnly,
    update: adminOnly,
    delete: adminOnly,
    sendPasswordResetEmail: adminOnly,
    unenrollMfa: adminOnly,
    ...overrides,
  });

  test("warns with the offending operations and how to restrict them", async () => {
    using _logger = silenceLogger("warn");
    const client = createMockClient({ services: [], clients: defaultIdpClients });

    await planIdP({
      ...createContext(client),
      application: createMockApplication({
        idpServices: [
          {
            name: "partner-idp",
            permission: permissionWith({
              read: loggedInOnly,
              sendPasswordResetEmail: loggedInOnly,
            }),
          },
        ],
      }),
    });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(
        /IdP service "partner-idp" permits every authenticated user .*read\[0\], sendPasswordResetEmail\[0\]/,
      ),
    );
  });

  test("stays quiet when every operation is restricted to an administrator role", async () => {
    using _logger = silenceLogger("warn");
    const client = createMockClient({ services: [], clients: defaultIdpClients });

    await planIdP({
      ...createContext(client),
      application: createMockApplication({ idpServices: [{ permission: permissionWith({}) }] }),
    });

    expect(logger.warn).not.toHaveBeenCalledWith(
      expect.stringContaining("every authenticated user"),
    );
  });
});

describe("planIdP and allowedEmailDomains normalization", () => {
  test("does not plan an update for domains that differ only in case", async () => {
    // The platform lowercases domains before storing, so a mixed-case local entry
    // would otherwise be re-applied on every deploy.
    const client = createMockClient({
      services: [createMatchingRemoteService()],
      clients: defaultIdpClients,
    });

    const result = await planIdP({
      ...createContext(client),
      application: createMockApplication({
        idpServices: [
          { userAuthPolicy: { allowedEmailDomains: ["B.Example.com", "A.EXAMPLE.COM"] } },
        ],
      }),
    });

    expect(result.changeSet.service.updates).toHaveLength(0);
    expect(result.changeSet.service.unchanged).toHaveLength(1);
  });
});
