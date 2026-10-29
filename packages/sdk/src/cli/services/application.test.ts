import * as fs from "node:fs";
import { Code, ConnectError } from "@connectrpc/connect";
import * as path from "pathe";
import { afterEach, describe, expect, test, vi } from "vitest";
import { getErrorDiagnostics } from "#/cli/shared/error-diagnostics";
import { extractInlineSourcemap } from "#/cli/shared/stack-trace";
import { defineConfig } from "#/configure/config/index";
import { defineAIGateway } from "#/configure/services/aigateway/index";
import { defineAuth } from "#/configure/services/auth/index";
import { defineIdp } from "#/configure/services/idp/index";
import { defineSecretManager } from "#/configure/services/secrets/index";
import { defineStaticWebSite } from "#/configure/services/staticwebsite/index";
import { db } from "#/configure/services/tailordb/schema";
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
      /AI Gateway "my-aigateway" has no "authNamespace"/,
    );
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
        'Invalid config for Auth service "my-auth" in tailor.config.ts:\n' +
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

  test("names an OAuth2 client whose name the platform rejects", () => {
    const error = defineInvalidApplication({
      auth: defineAuth("my-auth", {
        machineUserAttributes: {},
        oauth2Clients: { c1: { redirectURIs: ["https://example.com/callback"] } },
      }),
    });

    expect(error).toMatchObject({
      code: "CONFIG_INVALID",
      context: {
        issues: [
          {
            path: ["auth", "oauth2Clients", "c1"],
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
      const expectedStart = `Invalid config for ${heading} in tailor.config.ts:\n  - ${path.join(".")}: `;

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

    await expect(loadApplication({ config })).rejects.toThrow(
      /Invalid wait point key "needsReview"/,
    );
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
