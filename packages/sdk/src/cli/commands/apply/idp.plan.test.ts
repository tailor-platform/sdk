import { IdPLang } from "@tailor-proto/tailor/v1/idp_resource_pb";
import { describe, expect, test, vi } from "vitest";
import { logger } from "@/cli/shared/logger";
import { planIdP } from "./idp";
import type { PlanContext } from "./apply";
import type { Application } from "@/cli/services/application";
import type { OperatorClient } from "@/cli/shared/client";

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

type MockIdpServiceOpts = {
  name?: string;
  clients?: string[];
  publishUserEvents?: boolean | undefined;
};

function createMockApplication(opts?: {
  idpServices?: ReadonlyArray<MockIdpServiceOpts>;
}): Application {
  const serviceOpts = opts?.idpServices ?? [{}];
  return {
    name: appName,
    idpServices: serviceOpts.map((service) => {
      const result: Record<string, unknown> = {
        name: service.name ?? "idp-a",
        authorization: "loggedIn",
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
        },
        clients: service.clients ?? ["default-idp-client"],
      };
      if ("publishUserEvents" in service) {
        if (service.publishUserEvents !== undefined) {
          result.publishUserEvents = service.publishUserEvents;
        }
      } else {
        result.publishUserEvents = true;
      }
      return result;
    }),
  } as unknown as Application;
}

function createMockClient(opts?: {
  services?: Array<{
    name: string;
    authorization: string;
    lang: IdPLang;
    publishUserEvents: boolean;
    userAuthPolicy?: Record<string, unknown>;
    disableGqlOperations?: Record<string, boolean>;
    permission?: Record<string, unknown>;
    label?: string;
  }>;
  clients?: Record<string, Array<{ name: string; clientSecret: string }>>;
}): OperatorClient {
  const services = opts?.services ?? [];
  const clients = opts?.clients ?? {};

  return {
    listIdPServices: vi.fn().mockResolvedValue({
      idpServices: services.map((service) => ({
        namespace: { name: service.name },
        authorization: service.authorization,
        lang: service.lang,
        publishUserEvents: service.publishUserEvents,
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

describe("planIdP", () => {
  test("marks idp service and client unchanged when remote state matches", async () => {
    const client = createMockClient({
      services: [
        {
          name: "idp-a",
          authorization: "user != null && size(user.id) > 0",
          lang: IdPLang.JA,
          publishUserEvents: true,
          userAuthPolicy: {
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
          },
          disableGqlOperations: {
            create: false,
            update: false,
            delete: false,
            read: false,
            sendPasswordResetEmail: false,
          },
          label: appName,
        },
      ],
      clients: {
        "idp-a": [{ name: "default-idp-client", clientSecret: "secret" }],
      },
    });

    const result = await planIdP(createContext(client));

    expect(result.changeSet.service.unchanged).toHaveLength(1);
    expect(result.changeSet.client.unchanged).toHaveLength(1);
    expect(result.changeSet.service.updates).toHaveLength(0);
    expect(result.changeSet.client.updates).toHaveLength(0);
  });

  test("marks idp service and client updated when forceApplyAll is enabled", async () => {
    const client = createMockClient({
      services: [
        {
          name: "idp-a",
          authorization: "user != null && size(user.id) > 0",
          lang: IdPLang.JA,
          publishUserEvents: true,
          userAuthPolicy: {
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
          },
          disableGqlOperations: {
            create: false,
            update: false,
            delete: false,
            read: false,
            sendPasswordResetEmail: false,
          },
          label: appName,
        },
      ],
      clients: {
        "idp-a": [{ name: "default-idp-client", clientSecret: "secret" }],
      },
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
      services: [
        {
          name: "idp-a",
          authorization: "true==true",
          lang: IdPLang.EN,
          publishUserEvents: false,
          label: appName,
        },
      ],
      clients: {
        "idp-a": [{ name: "default-idp-client", clientSecret: "secret" }],
      },
    });

    const result = await planIdP(createContext(client));

    expect(result.changeSet.service.updates).toHaveLength(1);
    expect(result.changeSet.service.unchanged).toHaveLength(0);
  });

  test("marks idp service updated when config matches but ownership metadata is missing", async () => {
    const client = createMockClient({
      services: [
        {
          name: "idp-a",
          authorization: "user != null && size(user.id) > 0",
          lang: IdPLang.JA,
          publishUserEvents: true,
          userAuthPolicy: {
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
          },
          disableGqlOperations: {
            create: false,
            update: false,
            delete: false,
            read: false,
            sendPasswordResetEmail: false,
          },
        },
      ],
      clients: {
        "idp-a": [{ name: "default-idp-client", clientSecret: "secret" }],
      },
    });

    const result = await planIdP(createContext(client));

    expect(result.changeSet.service.updates).toHaveLength(1);
    expect(result.changeSet.service.unchanged).toHaveLength(0);
    expect(result.unmanaged).toHaveLength(1);
  });

  test("marks idp service updated when config matches but resource is owned by another app", async () => {
    const client = createMockClient({
      services: [
        {
          name: "idp-a",
          authorization: "user != null && size(user.id) > 0",
          lang: IdPLang.JA,
          publishUserEvents: true,
          userAuthPolicy: {
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
          },
          disableGqlOperations: {
            create: false,
            update: false,
            delete: false,
            read: false,
            sendPasswordResetEmail: false,
          },
          label: "other-app",
        },
      ],
      clients: {
        "idp-a": [{ name: "default-idp-client", clientSecret: "secret" }],
      },
    });

    const result = await planIdP(createContext(client));

    expect(result.changeSet.service.updates).toHaveLength(1);
    expect(result.changeSet.service.unchanged).toHaveLength(0);
    expect(result.conflicts).toHaveLength(1);
  });

  test("marks idp service updated when permission changes", async () => {
    const client = createMockClient({
      services: [
        {
          name: "idp-a",
          authorization: "user != null && size(user.id) > 0",
          lang: IdPLang.JA,
          publishUserEvents: true,
          userAuthPolicy: {
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
          },
          disableGqlOperations: {
            create: false,
            update: false,
            delete: false,
            read: false,
            sendPasswordResetEmail: false,
          },
          label: appName,
        },
      ],
      clients: {
        "idp-a": [{ name: "default-idp-client", clientSecret: "secret" }],
      },
    });

    const context = createContext(client);
    // oxlint-disable-next-line no-explicit-any
    (context.application as any).idpServices[0].permission = {
      create: [{ conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true }],
      read: [{ conditions: [], permit: true }],
      update: [{ conditions: [], permit: true }],
      delete: [{ conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true }],
      sendPasswordResetEmail: [{ conditions: [], permit: true }],
    };

    const result = await planIdP(context);

    expect(result.changeSet.service.updates).toHaveLength(1);
    expect(result.changeSet.service.unchanged).toHaveLength(0);
  });

  test("marks idp service unchanged when authorization is omitted and remote is empty string", async () => {
    const app = createMockApplication();
    // oxlint-disable-next-line no-explicit-any
    delete (app.idpServices[0] as any).authorization;

    const client = createMockClient({
      services: [
        {
          name: "idp-a",
          authorization: "",
          lang: IdPLang.JA,
          publishUserEvents: true,
          userAuthPolicy: {
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
          },
          disableGqlOperations: {
            create: false,
            update: false,
            delete: false,
            read: false,
            sendPasswordResetEmail: false,
          },
          label: appName,
        },
      ],
      clients: {
        "idp-a": [{ name: "default-idp-client", clientSecret: "secret" }],
      },
    });

    const context = {
      ...createContext(client),
      application: app,
    };

    const result = await planIdP(context);

    expect(result.changeSet.service.unchanged).toHaveLength(1);
    expect(result.changeSet.service.updates).toHaveLength(0);
  });

  test("marks idp service unchanged when permission is omitted and remote is empty permission", async () => {
    const client = createMockClient({
      services: [
        {
          name: "idp-a",
          authorization: "user != null && size(user.id) > 0",
          lang: IdPLang.JA,
          publishUserEvents: true,
          userAuthPolicy: {
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
          },
          disableGqlOperations: {
            create: false,
            update: false,
            delete: false,
            read: false,
            sendPasswordResetEmail: false,
          },
          permission: {
            create: [],
            read: [],
            update: [],
            delete: [],
            sendPasswordResetEmail: [],
          },
          label: appName,
        },
      ],
      clients: {
        "idp-a": [{ name: "default-idp-client", clientSecret: "secret" }],
      },
    });

    const result = await planIdP(createContext(client));

    expect(result.changeSet.service.unchanged).toHaveLength(1);
    expect(result.changeSet.service.updates).toHaveLength(0);
  });

  test("creates idp client when it does not exist remotely", async () => {
    const client = createMockClient({
      services: [
        {
          name: "idp-a",
          authorization: "user != null && size(user.id) > 0",
          lang: IdPLang.JA,
          publishUserEvents: true,
          label: appName,
        },
      ],
      clients: {
        "idp-a": [],
      },
    });

    const result = await planIdP(createContext(client));

    expect(result.changeSet.client.creates).toHaveLength(1);
    expect(result.changeSet.client.unchanged).toHaveLength(0);
  });
});

describe("planIdP / publishUserEvents auto-configuration", () => {
  test("undefined publishUserEvents stays false when no executor uses idpUser trigger", async () => {
    const app = createMockApplication({ idpServices: [{ publishUserEvents: undefined }] });
    const client = createMockClient({ services: [], clients: { "idp-a": [] } });

    const result = await planIdP({
      ...createContext(client),
      application: app,
      hasIdpUserTrigger: false,
    });

    expect(result.changeSet.service.creates).toHaveLength(1);
    expect(result.changeSet.service.creates[0].request.publishUserEvents).toBe(false);
  });

  test("undefined publishUserEvents is auto-enabled when an executor uses idpUser trigger", async () => {
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => {});
    try {
      const app = createMockApplication({ idpServices: [{ publishUserEvents: undefined }] });
      const client = createMockClient({ services: [], clients: { "idp-a": [] } });

      const result = await planIdP({
        ...createContext(client),
        application: app,
        hasIdpUserTrigger: true,
      });

      expect(result.changeSet.service.creates).toHaveLength(1);
      expect(result.changeSet.service.creates[0].request.publishUserEvents).toBe(true);
      expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining(`IdP service "idp-a"`));
      expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining("automatically enabled"));
    } finally {
      infoSpy.mockRestore();
    }
  });

  test("explicit publishUserEvents:true stays true without auto-enable info", async () => {
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => {});
    try {
      const app = createMockApplication({ idpServices: [{ publishUserEvents: true }] });
      const client = createMockClient({ services: [], clients: { "idp-a": [] } });

      const result = await planIdP({
        ...createContext(client),
        application: app,
        hasIdpUserTrigger: true,
      });

      expect(result.changeSet.service.creates[0].request.publishUserEvents).toBe(true);
      expect(infoSpy).not.toHaveBeenCalled();
    } finally {
      infoSpy.mockRestore();
    }
  });

  test("explicit publishUserEvents:false stays false but warns when executor uses idpUser trigger", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    try {
      const app = createMockApplication({ idpServices: [{ publishUserEvents: false }] });
      const client = createMockClient({ services: [], clients: { "idp-a": [] } });

      const result = await planIdP({
        ...createContext(client),
        application: app,
        hasIdpUserTrigger: true,
      });

      expect(result.changeSet.service.creates[0].request.publishUserEvents).toBe(false);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(`publishUserEvents: false`));
    } finally {
      warnSpy.mockRestore();
    }
  });

  test("auto-enables publishUserEvents on every IdP when any executor uses idpUser trigger", async () => {
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => {});
    try {
      const app = createMockApplication({
        idpServices: [
          { publishUserEvents: undefined },
          { name: "idp-b", clients: ["client-b"], publishUserEvents: undefined },
        ],
      });
      const client = createMockClient({
        services: [],
        clients: { "idp-a": [], "idp-b": [] },
      });

      const result = await planIdP({
        ...createContext(client),
        application: app,
        hasIdpUserTrigger: true,
      });

      expect(result.changeSet.service.creates).toHaveLength(2);
      expect(
        result.changeSet.service.creates.every(
          (create) => create.request.publishUserEvents === true,
        ),
      ).toBe(true);
      const autoEnableMessages = infoSpy.mock.calls.filter(([msg]) =>
        typeof msg === "string" ? msg.includes("automatically enabled") : false,
      );
      expect(autoEnableMessages).toHaveLength(2);
    } finally {
      infoSpy.mockRestore();
    }
  });
});
