import * as fs from "node:fs";
import { Code, ConnectError } from "@connectrpc/connect";
import * as path from "pathe";
import { afterEach, describe, expect, test, vi } from "vitest";
import { getErrorDiagnostics } from "#/cli/shared/error-diagnostics";
import { errorToJson } from "#/cli/shared/error-json";
import { extractInlineSourcemap } from "#/cli/shared/stack-trace";
import { defineConfig, definePlugins } from "#/configure/config/index";
import { defineAIGateway } from "#/configure/services/aigateway/index";
import { defineAuth } from "#/configure/services/auth/index";
import { defineIdp } from "#/configure/services/idp/index";
import { defineSecretManager } from "#/configure/services/secrets/index";
import { defineStaticWebSite } from "#/configure/services/staticwebsite/index";
import { db } from "#/configure/services/tailordb/schema";
import { kyselyTypePlugin } from "#/plugin/builtin/kysely-type/index";
import { PluginManager } from "#/plugin/manager";
import { getRegisteredWaitPoints, restoreWaitPointRegistry } from "#/utils/wait-point-registry";
import { defineApplication, loadApplication } from "./application";
import type { OperatorClient } from "#/cli/shared/client";

describe("defineAuth parse wiring", () => {
  test("preserves an explicit userProfile.namespace through AuthConfigSchema.parse", async () => {
    const userType = db.table("User", {
      email: db.string().unique(),
      role: db.string(),
    });

    const config = {
      ...defineConfig({
        name: "testApp",
        // A single TailorDB namespace ("main"). Without the fix the explicit
        // namespace is stripped by parse and auto-resolution falls back to "main".
        db: { main: { files: [] } },
        auth: defineAuth("my-auth", {
          userProfile: {
            namespace: "external-ns",
            type: userType,
            usernameField: "email",
            attributes: { role: true },
          },
          machineUsers: {
            admin: { attributes: { role: "ADMIN" } },
          },
        }),
      }),
      path: "tailor.config.ts",
    };

    const application = defineApplication({ config });
    expect(application.authService).toBeDefined();

    await application.authService!.resolveNamespaces();

    expect(application.authService!.userProfile?.namespace).toBe("external-ns");
  });

  test("accepts defineIdp helper objects when parsing IdP services", () => {
    const idp = defineIdp("my-idp", {
      clients: ["default-client"],
    });

    const config = {
      ...defineConfig({
        name: "testApp",
        idp: [idp],
      }),
      path: "tailor.config.ts",
    };

    const application = defineApplication({ config });

    expect(application.idpServices).toHaveLength(1);
    expect(application.idpServices[0]?.name).toBe("my-idp");
  });

  test("accepts defineStaticWebSite helper objects when parsing static websites", () => {
    const website = defineStaticWebSite("my-site", {
      description: "my website",
    });

    const config = {
      ...defineConfig({
        name: "testApp",
        staticWebsites: [website],
      }),
      path: "tailor.config.ts",
    };

    const application = defineApplication({ config });

    expect(application.staticWebsiteServices).toHaveLength(1);
    expect(application.staticWebsiteServices[0]?.name).toBe("my-site");
  });
});

describe("AI Gateway authNamespace default", () => {
  test("defaults an omitted authNamespace to the local auth service's name", () => {
    const auth = defineAuth("my-auth", { machineUserAttributes: {}, machineUsers: {} });
    const aiGateway = defineAIGateway("my-aigateway", {});

    const config = {
      ...defineConfig({ name: "testApp", auth, aiGateways: [aiGateway] }),
      path: "tailor.config.ts",
    };

    const application = defineApplication({ config });

    expect(application.aiGatewayServices[0]?.authNamespace).toBe("my-auth");
  });

  test("defaults an omitted authNamespace to an external auth service's name", () => {
    const aiGateway = defineAIGateway("my-aigateway", {});

    const config = {
      ...defineConfig({
        name: "testApp",
        auth: { name: "shared-auth", external: true },
        aiGateways: [aiGateway],
      }),
      path: "tailor.config.ts",
    };

    const application = defineApplication({ config });

    expect(application.aiGatewayServices[0]?.authNamespace).toBe("shared-auth");
  });

  test("treats an external auth reference carrying machine users as another app's auth", () => {
    const coreAuth = defineAuth("core-auth", {
      machineUserAttributes: {},
      machineUsers: { portal: {} },
    });
    const aiGateway = defineAIGateway("my-aigateway", {});

    const config = {
      ...defineConfig({ name: "portalApp", auth: coreAuth.asExternal(), aiGateways: [aiGateway] }),
      path: "tailor.config.ts",
    };

    const application = defineApplication({ config });

    expect(application.authService).toBeUndefined();
    expect(application.aiGatewayServices[0]?.authNamespace).toBe("core-auth");
  });

  test("keeps an explicit authNamespace even when it differs from the local auth service", () => {
    const auth = defineAuth("my-auth", { machineUserAttributes: {}, machineUsers: {} });
    const aiGateway = defineAIGateway("my-aigateway", { authNamespace: "other-apps-auth" });

    const config = {
      ...defineConfig({ name: "testApp", auth, aiGateways: [aiGateway] }),
      path: "tailor.config.ts",
    };

    const application = defineApplication({ config });

    expect(application.aiGatewayServices[0]?.authNamespace).toBe("other-apps-auth");
  });

  test("throws when authNamespace is omitted and no Auth service is configured", () => {
    const aiGateway = defineAIGateway("my-aigateway", {});

    const config = {
      ...defineConfig({ name: "testApp", aiGateways: [aiGateway] }),
      path: "tailor.config.ts",
    };

    expect(() => defineApplication({ config })).toThrow(
      expect.objectContaining({
        code: "CONFIG_INVALID",
        message:
          "Invalid Tailor config:\n  - aiGateways.0.authNamespace: No Auth service is configured to default to",
        suggestion: 'Define an Auth service, or set "authNamespace" explicitly.',
        context: expect.objectContaining({ configKey: "aiGateways", name: "my-aigateway" }),
      }),
    );
  });

  test("reports secrets without a value as CONFIG_INVALID", () => {
    const config = {
      ...defineConfig({
        name: "testApp",
        secrets: defineSecretManager({
          vault: { first: undefined, second: "set", third: null },
        } as never),
      }),
      path: "tailor.config.ts",
    };

    expect(() => defineApplication({ config })).toThrow(
      expect.objectContaining({
        code: "CONFIG_INVALID",
        message:
          "Invalid Tailor config:\n  - secrets.vaults.vault.first: Has no value\n  - secrets.vaults.vault.third: Has no value",
        suggestion: expect.stringContaining("ignoreNullishValues: true"),
        context: expect.objectContaining({ configKey: "secrets" }),
      }),
    );
  });

  test("reports a userProfile type no TailorDB namespace defines as CONFIG_INVALID", async () => {
    const userType = db.table("User", { email: db.string().unique() });
    const config = {
      ...defineConfig({
        name: "testApp",
        db: { main: { files: [] }, other: { files: [] } },
        auth: defineAuth("my-auth", {
          userProfile: { type: userType, usernameField: "email" },
          machineUsers: {},
        }),
      }),
      path: "tailor.config.ts",
    };

    await expect(
      defineApplication({ config }).authService!.resolveNamespaces(),
    ).rejects.toMatchObject({
      code: "CONFIG_INVALID",
      message:
        'Invalid Tailor config:\n  - auth.userProfile.type: Type "User" not found in any TailorDB namespace',
      context: { file: "tailor.config.ts", configKey: "auth", name: "my-auth" },
    });
  });
});

describe("service config validation", () => {
  function defineInvalidApplication(serviceConfig: Record<string, unknown>): unknown {
    const config = {
      ...defineConfig({ name: "testApp", ...serviceConfig }),
      path: "tailor.config.ts",
    };
    try {
      defineApplication({ config });
    } catch (error) {
      return error;
    }
    throw new Error("expected defineApplication to throw");
  }

  test.each([
    {
      configKey: "idp",
      kind: "idp",
      label: "IdP",
      entries: [
        defineIdp("duplicate", { clients: ["client"] }),
        { name: "distinct", external: true },
        { name: "duplicate", external: true },
        defineIdp("duplicate", { clients: ["other-client"] }),
      ],
    },
    {
      configKey: "staticWebsites",
      kind: "staticwebsite",
      label: "static website",
      entries: [
        defineStaticWebSite("duplicate", {}),
        defineStaticWebSite("distinct", {}),
        defineStaticWebSite("duplicate", {}),
        defineStaticWebSite("duplicate", {}),
      ],
    },
    {
      configKey: "aiGateways",
      kind: "aigateway",
      label: "AI Gateway",
      entries: [
        defineAIGateway("duplicate", { authNamespace: "my-auth" }),
        defineAIGateway("distinct", { authNamespace: "my-auth" }),
        defineAIGateway("duplicate", { authNamespace: "my-auth" }),
        defineAIGateway("duplicate", { authNamespace: "my-auth" }),
      ],
    },
  ])(
    "reports all duplicate $configKey entries with their config paths",
    ({ configKey, kind, label, entries }) => {
      const error = defineInvalidApplication({ [configKey]: entries });
      expect(errorToJson(error).error).toMatchObject({
        code: "DEFINITION_NAME_DUPLICATE",
        message: [
          `Duplicate ${label} name "duplicate" found:`,
          `  - tailor.config.ts (path: ${configKey}.0)`,
          `  - tailor.config.ts (path: ${configKey}.2)`,
          `  - tailor.config.ts (path: ${configKey}.3)`,
        ].join("\n"),
        context: {
          kind,
          duplicates: [
            {
              name: "duplicate",
              definitions: [0, 2, 3].map((index) => ({
                file: "tailor.config.ts",
                exportName: "default",
                path: [configKey, index],
              })),
            },
          ],
        },
      });
    },
  );

  describe.each([
    { configKey: "idp", entry: { clients: ["client"] } },
    { configKey: "staticWebsites", entry: {} },
    { configKey: "aiGateways", entry: { authNamespace: "my-auth" } },
  ])("invalid $configKey names", ({ configKey, entry }) => {
    test.each([{}, { name: null }, { name: 123 }])(
      "reports repeated invalid names %j as CONFIG_INVALID",
      (invalidName) => {
        const invalidEntry = { ...entry, ...invalidName };
        const error = defineInvalidApplication({ [configKey]: [invalidEntry, invalidEntry] });
        expect(errorToJson(error).error).toMatchObject({
          code: "CONFIG_INVALID",
          context: {
            file: "tailor.config.ts",
            configKey,
            issues: [
              { path: [configKey, 0, "name"], message: expect.stringContaining("expected string") },
            ],
          },
        });
      },
    );

    test("preserves duplicate entry positions after an invalid name", () => {
      const duplicate = { ...entry, name: "duplicate" };
      const error = defineInvalidApplication({ [configKey]: [entry, duplicate, duplicate] });
      expect(errorToJson(error).error).toMatchObject({
        code: "DEFINITION_NAME_DUPLICATE",
        context: {
          duplicates: [
            {
              name: "duplicate",
              definitions: [{ path: [configKey, 1] }, { path: [configKey, 2] }],
            },
          ],
        },
      });
    });
  });

  test("names the offending auth field when a machine user attribute is not a db field", () => {
    const error = defineInvalidApplication({
      auth: defineAuth("my-auth", {
        machineUserAttributes: { role: { type: "string" } } as never,
      }),
    });

    expect(error).toMatchObject({
      name: "CLIError",
      code: "CONFIG_INVALID",
      message:
        'Invalid config for Auth service "my-auth":\n' +
        "  - auth.machineUserAttributes.role.metadata: Invalid input: expected object, received undefined\n" +
        "  - auth.machineUserAttributes.role.fields: Invalid input: expected record, received undefined",
      context: {
        file: "tailor.config.ts",
        exportName: "default",
        configKey: "auth",
        name: "my-auth",
        issues: [
          {
            path: ["auth", "machineUserAttributes", "role", "metadata"],
            message: "Invalid input: expected object, received undefined",
          },
          {
            path: ["auth", "machineUserAttributes", "role", "fields"],
            message: "Invalid input: expected record, received undefined",
          },
        ],
      },
    });
    expect(getErrorDiagnostics(error as Error).location).toEqual({ file: "tailor.config.ts" });
  });

  test.each([
    {
      label: "an OAuth2 client name",
      serviceConfig: {
        auth: defineAuth("my-auth", {
          machineUserAttributes: {},
          oauth2Clients: { c1: { redirectURIs: ["https://example.com/callback"] } },
        }),
      },
      path: ["auth", "oauth2Clients", "c1"],
    },
    {
      label: "a secret manager vault name",
      serviceConfig: { secrets: defineSecretManager({ My_Vault: { key: "value" } }) },
      path: ["secrets", "vaults", "My_Vault"],
    },
    {
      label: "a secret manager secret name",
      serviceConfig: { secrets: defineSecretManager({ "my-vault": { My_Key: "value" } }) },
      path: ["secrets", "vaults", "my-vault", "My_Key"],
    },
    {
      label: "an AI Gateway authNamespace",
      serviceConfig: {
        aiGateways: [defineAIGateway("my-gateway", { authNamespace: "My_Auth" })],
      },
      path: ["aiGateways", 0, "authNamespace"],
    },
  ])("names $label the platform rejects", ({ serviceConfig, path }) => {
    const error = defineInvalidApplication(serviceConfig);

    expect(error).toMatchObject({
      code: "CONFIG_INVALID",
      context: {
        issues: [
          {
            path,
            message:
              "must be 3-63 lowercase letters, digits, or hyphens, starting and ending with a letter or digit",
          },
        ],
      },
    });
  });

  test("keeps the auth message for setting both userProfile and machineUserAttributes", () => {
    const userType = db.table("User", { email: db.string().unique() });
    const error = defineInvalidApplication({
      auth: defineAuth("my-auth", {
        userProfile: { type: userType, usernameField: "email" },
        machineUserAttributes: { role: db.string() },
      } as never),
    });

    expect(error).toMatchObject({
      context: {
        issues: [
          {
            path: ["auth"],
            message: "Specify either `userProfile` or `machineUserAttributes`, not both.",
          },
        ],
      },
    });
  });

  test("reports only an unknown auth key next to a valid userProfile", () => {
    const userType = db.table("User", { email: db.string().unique() });
    const error = defineInvalidApplication({
      auth: {
        ...defineAuth("my-auth", { userProfile: { type: userType, usernameField: "email" } }),
        machineUser: {},
      },
    });

    expect(error).toMatchObject({
      context: { issues: [{ path: ["auth"], message: 'Unrecognized key: "machineUser"' }] },
    });
  });

  test("reports an unknown auth idProvider kind with the accepted kinds", () => {
    const error = defineInvalidApplication({
      auth: defineAuth("my-auth", {
        machineUserAttributes: {},
        idProvider: { kind: "OAuth", name: "provider" },
      } as never),
    });

    expect(error).toMatchObject({
      context: {
        issues: [
          {
            path: ["auth", "idProvider", "kind"],
            message:
              "Invalid discriminator value. Expected 'OIDC' | 'SAML' | 'IDToken' | 'BuiltInIdP'",
          },
        ],
      },
    });
  });

  test("reports every invalid auth field when both machine user settings are wrong", () => {
    const error = defineInvalidApplication({
      auth: defineAuth("my-auth", {
        machineUserAttributes: { role: { type: "string" } },
        machineUsers: { admin: { attributes: { role: 1 } } },
      } as never),
    });

    expect(error).toMatchObject({
      context: {
        issues: [
          {
            path: ["auth", "machineUsers", "admin", "attributes", "role"],
            message: "Invalid input: expected string | boolean | array",
          },
          {
            path: ["auth", "machineUserAttributes", "role", "metadata"],
            message: "Invalid input: expected object, received undefined",
          },
          {
            path: ["auth", "machineUserAttributes", "role", "fields"],
            message: "Invalid input: expected record, received undefined",
          },
        ],
      },
    });
  });

  test.each([
    {
      serviceConfig: { db: { main: { files: "tailordb/*.ts" } } },
      heading: 'TailorDB service "main"',
      configKey: "db",
      name: "main",
      path: ["db", "main", "files"],
    },
    {
      serviceConfig: {
        resolver: {
          main: {
            files: [],
            defaultPermission: [{ conditions: [[{ user: "role" }, "=", "BANNED"]], permit: false }],
          },
        },
      },
      heading: 'resolver namespace "main"',
      configKey: "resolver",
      name: "main",
      path: ["resolver", "main", "defaultPermission"],
    },
    {
      serviceConfig: {
        idp: [
          defineIdp("other-idp", { clients: ["default"] }),
          { ...defineIdp("my-idp", { clients: ["default"] }), clients: "default" },
        ],
      },
      heading: 'IdP "my-idp"',
      configKey: "idp",
      name: "my-idp",
      path: ["idp", 1, "clients"],
    },
    {
      serviceConfig: {
        staticWebsites: [{ ...defineStaticWebSite("my-site", {}), customDomains: "example.com" }],
      },
      heading: 'static website "my-site"',
      configKey: "staticWebsites",
      name: "my-site",
      path: ["staticWebsites", 0, "customDomains"],
    },
    {
      serviceConfig: { aiGateways: [defineAIGateway("my-gateway", { cors: "*" } as never)] },
      heading: 'AI Gateway "my-gateway"',
      configKey: "aiGateways",
      name: "my-gateway",
      path: ["aiGateways", 0, "cors"],
    },
    {
      serviceConfig: { secrets: defineSecretManager({ "my-vault": { key: 1 } } as never) },
      heading: "secret manager",
      configKey: "secrets",
      name: undefined,
      path: ["secrets", "vaults", "my-vault", "key"],
    },
  ])(
    "reports an invalid $configKey config as CONFIG_INVALID",
    ({ serviceConfig, heading, configKey, name, path }) => {
      const error = defineInvalidApplication(serviceConfig) as Error;
      const expectedStart = `Invalid config for ${heading}:\n  - ${path.join(".")}: `;

      expect(error.message.slice(0, expectedStart.length)).toBe(expectedStart);
      expect(error).toMatchObject({
        code: "CONFIG_INVALID",
        context: { file: "tailor.config.ts", configKey, name, issues: [{ path }] },
      });
    },
  );
});

describe("loadApplication wait point key check", () => {
  let tmpDir: string | undefined;
  // The registry is process-wide, so the key this fixture declares would
  // otherwise reach the check another test file runs.
  const mark = getRegisteredWaitPoints().length;

  afterEach(() => {
    restoreWaitPointRegistry(mark);
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  test("rejects a key declared only by an executor, with no workflow files to load", async () => {
    // Place the fixture inside the SDK package so its dynamic import can
    // resolve `@tailor-platform/sdk` through the workspace node_modules tree.
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(import.meta.dirname, ".application-")));
    const executorFile = path.join(tmpDir, "executor.ts");
    fs.writeFileSync(
      executorFile,
      `
import { createExecutor, createWaitPoint, incomingWebhookTrigger } from "@tailor-platform/sdk";

export const review = createWaitPoint("needsReview");

export default createExecutor({
  name: "webhook-executor",
  trigger: incomingWebhookTrigger({ response: () => ({}) }),
  operation: { kind: "function", body: () => {} },
});
`,
    );

    const config = {
      ...defineConfig({
        name: "testApp",
        executor: { files: [executorFile] },
      }),
      path: path.join(tmpDir, "tailor.config.ts"),
    };

    await expect(loadApplication({ config })).rejects.toMatchObject({
      code: "WORKFLOW_WAIT_POINT_KEY_INVALID",
      message: expect.stringMatching(/Invalid wait point key "needsReview"/),
      context: { failures: [expect.stringMatching(/Invalid wait point key "needsReview"/)] },
    });
  });
});

describe("loadApplication static website env resolution", () => {
  let tmpDir: string | undefined;

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  function makeClient(url: string): OperatorClient {
    return {
      getStaticWebsite: vi.fn().mockResolvedValue({ staticwebsite: { url } }),
    } as unknown as OperatorClient;
  }

  test("resolves a name:url placeholder before bundling a workflow job", async () => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(import.meta.dirname, ".application-")));
    const workflowFile = path.join(tmpDir, "workflow.ts");
    fs.writeFileSync(
      workflowFile,
      `
import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";

export const mainJob = createWorkflowJob({
  name: "main-job",
  body: (_input: undefined, { env }) => ({ siteUrl: env.siteUrl }),
});

export default createWorkflow({ name: "main-workflow", mainJob });
`,
    );

    const website = defineStaticWebSite("my-site", { description: "my website" });
    const config = {
      ...defineConfig({
        name: "testApp",
        staticWebsites: [website],
        workflow: { files: [workflowFile] },
        env: { siteUrl: website.url },
      }),
      path: path.join(tmpDir, "tailor.config.ts"),
    };

    const { application, workflowBuildResult } = await loadApplication({
      config,
      client: makeClient("https://site.example.com"),
      workspaceId: "ws-1",
    });

    expect(application.env.siteUrl).toBe("https://site.example.com");
    const bundledCode = [...(workflowBuildResult?.bundledCode.values() ?? [])].join("\n");
    expect(bundledCode).toContain("https://site.example.com");
    expect(bundledCode).not.toContain("my-site:url");
  });

  test("keeps env unresolved without a client, e.g. --build-only", async () => {
    const website = defineStaticWebSite("my-site", { description: "my website" });
    const config = {
      ...defineConfig({
        name: "testApp",
        staticWebsites: [website],
        env: { siteUrl: website.url },
      }),
      path: "tailor.config.ts",
    };

    const { application } = await loadApplication({ config });

    expect(application.env.siteUrl).toBe("my-site:url");
  });

  test("keeps the placeholder with a warning when the site is created later in the same deploy run", async () => {
    const getStaticWebsite = vi
      .fn()
      .mockRejectedValue(new ConnectError("not found", Code.NotFound));
    const client = { getStaticWebsite } as unknown as OperatorClient;

    const config = {
      ...defineConfig({
        name: "testApp",
        env: { siteUrl: "sibling-site:url" },
      }),
      path: "tailor.config.ts",
    };

    const { application } = await loadApplication({
      config,
      client,
      workspaceId: "ws-1",
      expectedLocalStaticWebsiteNames: new Set(["sibling-site"]),
    });

    expect(application.env.siteUrl).toBe("sibling-site:url");
  });

  test("fails instead of shipping an unresolved placeholder when the lookup fails unexpectedly", async () => {
    const error = new ConnectError("service unavailable", Code.Unavailable);
    const client = {
      getStaticWebsite: vi.fn().mockRejectedValue(error),
    } as unknown as OperatorClient;

    const config = {
      ...defineConfig({
        name: "testApp",
        env: { siteUrl: "my-site:url" },
      }),
      path: "tailor.config.ts",
    };

    await expect(loadApplication({ config, client, workspaceId: "ws-1" })).rejects.toThrow(error);
  });
});

describe("loadApplication previous reuse", () => {
  let tmpDir: string | undefined;

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  test("rebundles only the workflow job that embeds env, reusing everything else", async () => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(import.meta.dirname, ".application-")));
    const workflowFile = path.join(tmpDir, "workflow.ts");
    fs.writeFileSync(
      workflowFile,
      `
import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";

export const mainJob = createWorkflowJob({
  name: "main-job",
  body: (_input: undefined, { env }) => ({ siteUrl: env.siteUrl }),
});

export default createWorkflow({ name: "main-workflow", mainJob });
`,
    );
    const executorFile = path.join(tmpDir, "executor.ts");
    fs.writeFileSync(
      executorFile,
      `
import { createExecutor, incomingWebhookTrigger } from "@tailor-platform/sdk";

export default createExecutor({
  name: "webhook-executor",
  trigger: incomingWebhookTrigger({ response: () => ({}) }),
  operation: { kind: "function", body: () => {} },
});
`,
    );

    const website = defineStaticWebSite("my-site", { description: "my website" });
    const config = {
      ...defineConfig({
        name: "testApp",
        staticWebsites: [website],
        workflow: { files: [workflowFile] },
        executor: { files: [executorFile] },
        env: { siteUrl: website.url },
      }),
      path: path.join(tmpDir, "tailor.config.ts"),
    };

    const notFoundClient = {
      getStaticWebsite: vi.fn().mockRejectedValue(new ConnectError("not found", Code.NotFound)),
    } as unknown as OperatorClient;

    const first = await loadApplication({
      config,
      client: notFoundClient,
      workspaceId: "ws-1",
      expectedLocalStaticWebsiteNames: new Set(["my-site"]),
    });
    expect(first.application.env.siteUrl).toBe("my-site:url");

    const resolvedClient = {
      getStaticWebsite: vi
        .fn()
        .mockResolvedValue({ staticwebsite: { url: "https://site.example.com" } }),
    } as unknown as OperatorClient;

    const second = await loadApplication({
      config,
      client: resolvedClient,
      workspaceId: "ws-1",
      previous: first,
    });

    // env re-resolved, and the workflow job that embeds it rebuilt with the real URL.
    expect(second.application.env.siteUrl).toBe("https://site.example.com");
    const bundledCode = [...(second.workflowBuildResult?.bundledCode.values() ?? [])].join("\n");
    expect(bundledCode).toContain("https://site.example.com");
    expect(bundledCode).not.toContain("my-site:url");

    // Executor bundling never depends on env, so it's reused, not rebundled.
    expect(second.bundledScripts.executors).toBe(first.bundledScripts.executors);
    // Config parsing, TailorDB loading, and service definitions are reused too.
    expect(second.application.executorService).toBe(first.application.executorService);
    expect(second.application.tailorDBServices).toBe(first.application.tailorDBServices);
    expect(second.reusableBuildState).toBe(first.reusableBuildState);
  });
});

describe("loadApplication kysely temporal", () => {
  const GATE = "__TAILOR_PLATFORM_BUNDLE_KYSELY_TEMPORAL";
  let tmpDir: string | undefined;

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  async function bundledExecutor(options: { temporal?: boolean }): Promise<string> {
    tmpDir ??= fs.realpathSync(fs.mkdtempSync(path.join(import.meta.dirname, ".application-")));
    const executorFile = path.join(tmpDir, "executor.ts");
    fs.writeFileSync(
      executorFile,
      `
import { createExecutor, incomingWebhookTrigger } from "@tailor-platform/sdk";

const temporal = globalThis.process?.env.${GATE} === "true";

export default createExecutor({
  name: "webhook-executor",
  trigger: incomingWebhookTrigger({ response: () => ({}) }),
  operation: { kind: "function", body: () => temporal },
});
`,
    );
    const config = {
      ...defineConfig({ name: "testApp", executor: { files: [executorFile] } }),
      path: path.join(tmpDir, "tailor.config.ts"),
    };
    const { bundledScripts } = await loadApplication({
      config,
      pluginManager: new PluginManager(
        definePlugins(kyselyTypePlugin({ distPath: "./db.ts", ...options })),
      ),
    });
    return [...bundledScripts.executors.values()].join("\n");
  }

  test("bundles getDB of @tailor-platform/sdk/plugin/kysely-type/db with the plugin's temporal option", async () => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(import.meta.dirname, ".application-")));
    const executorFile = path.join(tmpDir, "executor.ts");
    fs.writeFileSync(
      executorFile,
      `
import { createExecutor, incomingWebhookTrigger } from "@tailor-platform/sdk";
import { getDB } from "@tailor-platform/sdk/plugin/kysely-type/db";

export default createExecutor({
  name: "webhook-executor",
  trigger: incomingWebhookTrigger({ response: () => ({}) }),
  operation: { kind: "function", body: () => getDB },
});
`,
    );
    const config = {
      ...defineConfig({ name: "testApp", executor: { files: [executorFile] } }),
      path: path.join(tmpDir, "tailor.config.ts"),
    };
    const bundle = async (temporal: boolean) =>
      [
        ...(
          await loadApplication({
            config,
            pluginManager: new PluginManager(
              definePlugins(kyselyTypePlugin({ distPath: "./db.ts", temporal })),
            ),
          })
        ).bundledScripts.executors.values(),
      ].join("\n");

    const withTemporal = await bundle(true);
    const withoutTemporal = await bundle(false);

    expect(withTemporal).not.toContain(GATE);
    expect(withTemporal).toMatch(/temporal:\s*(?:true|!0)/);
    expect(withoutTemporal).not.toContain(GATE);
    expect(withoutTemporal).toMatch(/temporal:\s*(?:false|!1)/);
  });

  test("folds the gate to follow the plugin's temporal option in what it bundles", async () => {
    const withTemporal = await bundledExecutor({ temporal: true });
    const withoutTemporal = await bundledExecutor({});

    expect(withTemporal).not.toContain(GATE);
    expect(withTemporal).toMatch(/=>\s*(?:true|!0)/);
    expect(withoutTemporal).not.toContain(GATE);
    expect(withoutTemporal).toMatch(/=>\s*(?:false|!1)/);
  });
});

describe("loadApplication source text in inline sourcemaps", () => {
  const INSTALLED_MARKER = "APPLICATION_INSTALLED_LIB_SOURCE";
  let tmpDir: string | undefined;

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  function embeddedSourceText(code: string): string {
    const traceMap = extractInlineSourcemap(code);
    if (!traceMap) throw new Error("Expected the bundle to carry an inline sourcemap");
    return (traceMap.sourcesContent ?? []).filter((text) => text != null).join("\n");
  }

  async function loadBundles(inlineSourcemapDependencySources: boolean | undefined) {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(import.meta.dirname, ".application-")));
    const libDir = path.join(tmpDir, "node_modules", "application-sourcemap-lib");
    fs.mkdirSync(libDir, { recursive: true });
    fs.writeFileSync(
      path.join(libDir, "package.json"),
      JSON.stringify({ name: "application-sourcemap-lib", type: "module", main: "index.js" }),
    );
    fs.writeFileSync(
      path.join(libDir, "index.js"),
      `export const marker = () => "${INSTALLED_MARKER}";\n`,
    );
    const workflowFile = path.join(tmpDir, "workflow.ts");
    fs.writeFileSync(
      workflowFile,
      `
import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";
import { marker } from "application-sourcemap-lib";

export const mainJob = createWorkflowJob({
  name: "main-job",
  body: () => ({ value: marker() }),
});

export default createWorkflow({ name: "main-workflow", mainJob });
`,
    );
    const executorFile = path.join(tmpDir, "executor.ts");
    fs.writeFileSync(
      executorFile,
      `
import { createExecutor, incomingWebhookTrigger } from "@tailor-platform/sdk";
import { marker } from "application-sourcemap-lib";

export default createExecutor({
  name: "webhook-executor",
  trigger: incomingWebhookTrigger({ response: () => ({}) }),
  operation: { kind: "function", body: () => { marker(); } },
});
`,
    );
    const resolverFile = path.join(tmpDir, "resolver.ts");
    fs.writeFileSync(
      resolverFile,
      `
import { createResolver, t } from "@tailor-platform/sdk";
import { marker } from "application-sourcemap-lib";

export default createResolver({
  name: "marker",
  operation: "query",
  body: () => marker(),
  output: t.string(),
});
`,
    );
    const config = {
      ...defineConfig({
        name: "testApp",
        resolver: { main: { files: [resolverFile] } },
        workflow: { files: [workflowFile] },
        executor: { files: [executorFile] },
        buildOptions: { inlineSourcemapDependencySources },
      }),
      path: path.join(tmpDir, "tailor.config.ts"),
    };

    const first = await loadApplication({ config });
    const second = await loadApplication({ config, previous: first });
    return {
      resolver: [...first.bundledScripts.resolvers.values()].join("\n"),
      executor: [...first.bundledScripts.executors.values()].join("\n"),
      workflowJob: [...(first.workflowBuildResult?.bundledCode.values() ?? [])].join("\n"),
      rebundledWorkflowJob: [...(second.workflowBuildResult?.bundledCode.values() ?? [])].join(
        "\n",
      ),
    };
  }

  test("leaves out the source text of installed packages by default", async () => {
    const bundles = await loadBundles(undefined);

    expect(embeddedSourceText(bundles.resolver)).not.toContain(INSTALLED_MARKER);
    expect(embeddedSourceText(bundles.executor)).not.toContain(INSTALLED_MARKER);
    expect(embeddedSourceText(bundles.workflowJob)).not.toContain(INSTALLED_MARKER);
    expect(embeddedSourceText(bundles.rebundledWorkflowJob)).not.toContain(INSTALLED_MARKER);
  });

  test("embeds the source text of installed packages when buildOptions asks for it", async () => {
    const bundles = await loadBundles(true);

    expect(embeddedSourceText(bundles.resolver)).toContain(INSTALLED_MARKER);
    expect(embeddedSourceText(bundles.executor)).toContain(INSTALLED_MARKER);
    expect(embeddedSourceText(bundles.workflowJob)).toContain(INSTALLED_MARKER);
    expect(embeddedSourceText(bundles.rebundledWorkflowJob)).toContain(INSTALLED_MARKER);
  });
});

describe("loadApplication workflow start rewriting", () => {
  let tmpDir: string | undefined;

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  test("rewrites .start() on a default-exported workflow created through a helper function", async () => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(import.meta.dirname, ".application-")));
    const syncFile = path.join(tmpDir, "sync.ts");
    const callerFile = path.join(tmpDir, "caller.ts");
    fs.writeFileSync(
      syncFile,
      `
import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";

const defineSync = (mainJob: typeof syncStep) =>
  createWorkflow({ name: "sync-gl-balances", mainJob });
export const syncStep = createWorkflowJob({ name: "sync-step", body: async () => "synced" });
export default defineSync(syncStep);
`,
    );
    fs.writeFileSync(
      callerFile,
      `
import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";
import syncWorkflow from "./sync";

export const callerJob = createWorkflowJob({
  name: "caller-job",
  body: async () => await syncWorkflow.start({}),
});
export default createWorkflow({ name: "caller-workflow", mainJob: callerJob });
`,
    );
    const config = {
      ...defineConfig({ name: "testApp", workflow: { files: ["sync.ts", "caller.ts"] } }),
      path: path.join(tmpDir, "tailor.config.ts"),
    };

    const { workflowBuildResult } = await loadApplication({ config });

    expect(workflowBuildResult?.bundledCode.get("caller-job")).toMatch(
      /startWorkflow\([`'"]sync-gl-balances/,
    );
  });
});
