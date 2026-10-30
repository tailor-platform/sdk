import { Code, ConnectError } from "@connectrpc/connect";
import { beforeEach, expect, test, vi } from "vitest";
import { logger } from "#/cli/shared/logger";
import { prompt } from "#/cli/shared/prompt";
import { captureStderr, captureStdoutStream } from "#/cli/shared/test-helpers/capture-output";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
import { silenceLogger } from "#/cli/shared/test-helpers/silence-logger";
import { defineStaticWebSite } from "#/configure/services/staticwebsite/index";
import { emptyPlanResults } from "./test-helpers/plan-results";
import type { Plugin } from "#/plugin/types";
import type { PlanResults } from "./apply-phases";
import type { BuiltDeploymentTarget } from "./deployment-target";
const mocks = vi.hoisted(() => ({
  target: undefined as unknown as BuiltDeploymentTarget,
  results: undefined as unknown as PlanResults,
  apply: vi.fn(),
  prerequisite: vi.fn(),
  getApplication: vi.fn(),
  getStaticWebsite: vi.fn(),
  getAIGateway: vi.fn(),
  listAuthOAuth2Clients: vi.fn(),
  fetchMissingDependentApps: vi.fn(),
  planTailorDB: vi.fn(),
}));
vi.mock(import("./deployment-target"), async (original) => ({
  ...(await original()),
  loadDeployConfigs: async () => [
    { config: mocks.target.config, plugins: [...mocks.target.plugins] },
  ],
  buildDeploymentTargets: async () => [mocks.target],
}));
vi.mock("./workspace", () => ({
  resolveDeployWorkspace: async () => ({
    workspaceId: "ws",
    client: {
      getApplication: mocks.getApplication,
      getStaticWebsite: mocks.getStaticWebsite,
      getAIGateway: mocks.getAIGateway,
      listAuthOAuth2Clients: mocks.listAuthOAuth2Clients,
    },
  }),
}));
vi.mock("./metadata-lookup", () => ({
  createMetadataLookupClient: async () => ({
    getMetadata: async () => ({ metadata: { labels: [] } }),
  }),
}));
vi.mock(import("./dependency-records"), async (original) => ({
  ...(await original()),
  fetchMissingDependentApps: mocks.fetchMissingDependentApps,
}));
vi.mock(import("./apply-phases"), async (original) => ({
  ...(await original()),
  preflightAllTailorDB: async () => {},
  applyPrerequisiteResources: mocks.prerequisite,
  applyRemainingResources: mocks.apply,
}));
vi.mock(import("./function-registry"), async (original) => ({
  ...(await original()),
  planFunctionRegistry: async () => mocks.results.functionRegistry,
}));
vi.mock(import("./tailordb"), async (original) => ({
  ...(await original()),
  planTailorDB: mocks.planTailorDB,
}));
vi.mock(import("./staticwebsite"), async (original) => ({
  ...(await original()),
  planStaticWebsite: async () => mocks.results.staticWebsite,
}));
vi.mock(import("./aigateway"), async (original) => ({
  ...(await original()),
  planAIGateway: async () => mocks.results.aiGateway,
}));
vi.mock(import("./idp"), async (original) => ({
  ...(await original()),
  planIdP: async () => mocks.results.idp,
}));
vi.mock(import("./auth"), async (original) => ({
  ...(await original()),
  planAuth: async () => mocks.results.auth,
}));
vi.mock(import("./resolver"), async (original) => ({
  ...(await original()),
  planPipeline: async () => mocks.results.pipeline,
}));
vi.mock(import("./application"), async (original) => ({
  ...(await original()),
  planApplication: async () => mocks.results.app,
}));
vi.mock(import("./executor"), async (original) => ({
  ...(await original()),
  planExecutor: async () => mocks.results.executor,
}));
vi.mock(import("./workflow"), async (original) => ({
  ...(await original()),
  planWorkflow: async () => mocks.results.workflow,
}));
vi.mock(import("./workflow-execution-policy"), async (original) => ({
  ...(await original()),
  planWorkflowJobFunctionExecutionPolicy: async () => mocks.results.workflowExecutionPolicy,
}));
vi.mock(import("./secret-manager"), async (original) => ({
  ...(await original()),
  planSecretManager: async () => mocks.results.secretManager,
}));
import { deploy, deployMigrationTestBaseline, deployMigrationTestTarget } from "./deploy";
beforeEach(() => {
  const application = {
    name: "app",
    id: undefined,
    config: {},
    subgraphs: [],
    tailorDBServices: [],
    externalTailorDBNamespaces: [],
    resolverServices: [],
    idpServices: [],
    staticWebsiteServices: [{ name: "web" }],
    aiGatewayServices: [],
    secrets: [],
    env: {},
    applications: [],
  };
  mocks.target = {
    config: { path: "/repo/tailor.config.ts", name: "app" },
    application,
    plugins: [],
    bundledScripts: {
      resolvers: new Map(),
      executors: new Map(),
      workflowJobs: new Map(),
      authHooks: new Map(),
    },
  } as unknown as BuiltDeploymentTarget;
  mocks.results = emptyPlanResults();
  mocks.planTailorDB.mockImplementation(async () => mocks.results.tailorDB);
  mocks.apply.mockResolvedValue([]);
  mocks.fetchMissingDependentApps.mockResolvedValue([]);
  mocks.getApplication.mockResolvedValue({ application: { url: "https://app", domain: "app" } });
  mocks.getStaticWebsite.mockResolvedValue({ staticwebsite: { url: "https://web" } });
  mocks.getAIGateway.mockResolvedValue({ aigateway: { name: "ai", url: "https://ai" } });
  mocks.listAuthOAuth2Clients.mockResolvedValue({
    oauth2Clients: [{ name: "web", clientId: "public-id", clientSecret: "private-secret" }],
    nextPageToken: "",
  });
});
function register(hook: NonNullable<Plugin["onDeployed"]>) {
  mocks.target.plugins = [{ id: "hook", description: "deploy test", onDeployed: hook }];
}
test("runs a hook once after remaining resources are applied even when the plan is empty", async () => {
  using _logger = silenceLogger("info", "warn", "success", "out", "log");
  const hook = vi.fn(() => {
    expect(mocks.apply).toHaveBeenCalledOnce();
  });
  register(hook);
  await deploy({ yes: true, noValidate: true });
  expect(hook).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      application: expect.objectContaining({
        url: "https://app",
        staticWebsites: { web: expect.objectContaining({ name: "web", url: "https://web" }) },
      }),
    }),
  );
});
test("lists the pending hook during dry-run without executing it", async () => {
  using _logger = silenceLogger("info", "warn", "success", "out", "log");
  const hook = vi.fn();
  register(hook);
  await deploy({ dryRun: true, noValidate: true });
  expect(hook).not.toHaveBeenCalled();
  expect(mocks.getApplication).not.toHaveBeenCalled();
  expect(logger.info).toHaveBeenCalledWith(expect.stringMatching(/hook.*app/));
});
test("includes pending hooks in the JSON dry-run result", async () => {
  using _logger = silenceLogger("info", "warn", "success", "out", "log");
  using _json = jsonMode();
  register(vi.fn());
  await deploy({ dryRun: true, noValidate: true });
  expect(logger.out).toHaveBeenCalledWith(
    expect.objectContaining({ pendingDeployedHooks: [{ application: "app", pluginId: "hook" }] }),
  );
  expect(mocks.getApplication).not.toHaveBeenCalled();
});
test("omits pendingDeployedHooks from the JSON dry-run result without deploy hooks", async () => {
  using _logger = silenceLogger("info", "warn", "success", "out", "log");
  using _json = jsonMode();
  await deploy({ dryRun: true, noValidate: true });
  expect(logger.out).toHaveBeenCalledWith(
    expect.not.objectContaining({ pendingDeployedHooks: expect.anything() }),
  );
});
test("does not execute hooks in build-only mode", async () => {
  using _logger = silenceLogger("info", "warn", "success", "out", "log");
  using _json = jsonMode();
  const hook = vi.fn();
  register(hook);
  await deploy({ buildOnly: true });
  expect(hook).not.toHaveBeenCalled();
  expect(mocks.getApplication).not.toHaveBeenCalled();
});
test("does not execute hooks during a migration baseline deploy", async () => {
  using _logger = silenceLogger("info", "warn", "success", "out", "log");
  using _json = jsonMode();
  const hook = vi.fn();
  register(hook);
  await deployMigrationTestBaseline({ yes: true, noValidate: true }, new Map(), new Map());
  expect(hook).not.toHaveBeenCalled();
  expect(mocks.getApplication).not.toHaveBeenCalled();
});
test("does not execute hooks during a migration target deploy", async () => {
  using _logger = silenceLogger("info", "warn", "success", "out", "log");
  using _json = jsonMode();
  const hook = vi.fn();
  register(hook);
  await deployMigrationTestTarget({ yes: true, noValidate: true }, new Map());
  expect(hook).not.toHaveBeenCalled();
  expect(mocks.getApplication).not.toHaveBeenCalled();
});
test("plans a migration target deploy to run the scripts as the given machine user", async () => {
  using _logger = silenceLogger("info", "warn", "success", "out", "log");
  await deployMigrationTestTarget({ yes: true, noValidate: true }, new Map(), "admin");
  expect(mocks.planTailorDB).toHaveBeenCalledWith(
    expect.objectContaining({ migrationMachineUserOverride: "admin" }),
  );
});
test("adds hook outputs to the JSON deployment result", async () => {
  using _logger = silenceLogger("info", "warn", "success", "out", "log");
  using _json = jsonMode();
  register(() => ({ outputs: { value: 42 } }));
  await deploy({ yes: true, noValidate: true });
  expect(logger.out).toHaveBeenCalledWith(
    expect.objectContaining({
      status: "applied",
      applications: [expect.objectContaining({ url: "https://app" })],
      deployedHooks: [{ application: "app", pluginId: "hook", outputs: { value: 42 } }],
    }),
  );
});
test("loads application information only once for the JSON result and hooks", async () => {
  using _logger = silenceLogger("info", "warn", "success", "out", "log");
  using _json = jsonMode();
  register(() => {});
  await deploy({ yes: true, noValidate: true });
  expect(mocks.getApplication).toHaveBeenCalledExactlyOnceWith({
    workspaceId: "ws",
    applicationName: "app",
  });
  expect(mocks.getStaticWebsite).toHaveBeenCalledExactlyOnceWith({
    workspaceId: "ws",
    name: "web",
  });
});

test("omits deployedHooks when a hook returns no outputs", async () => {
  using _logger = silenceLogger("info", "warn", "success", "out", "log");
  using _json = jsonMode();
  register(() => {});
  await deploy({ yes: true, noValidate: true });
  expect(logger.out).toHaveBeenLastCalledWith({
    summary: expect.any(Object),
    status: "applied",
    workspaceId: "ws",
    applications: expect.any(Array),
  });
});
test("does not fetch hook context when no deploy hook is registered", async () => {
  using _logger = silenceLogger("info", "warn", "success", "out", "log");
  await deploy({ yes: true, noValidate: true });
  expect(mocks.getApplication).not.toHaveBeenCalled();
  expect(mocks.getStaticWebsite).not.toHaveBeenCalled();
});

test("runs the original plugin once after the URL rebuild has been applied", async () => {
  using _logger = silenceLogger("info", "warn", "success", "out", "log");
  mocks.target.config = {
    ...mocks.target.config,
    staticWebsites: [defineStaticWebSite("web", {})],
  };
  mocks.target.application = { ...mocks.target.application, env: { website: "web:url" } };
  const hook = vi.fn(() => {
    expect(mocks.apply).toHaveBeenCalledOnce();
  });
  register(hook);
  mocks.prerequisite.mockImplementationOnce(async () => {
    mocks.target = {
      ...mocks.target,
      application: { ...mocks.target.application, env: { website: "https://web" } },
    };
  });
  await deploy({ yes: true, noValidate: true });
  expect(hook).toHaveBeenCalledOnce();
});

test("does not execute hooks after resource application fails", async () => {
  using _logger = silenceLogger("info", "warn", "success", "out", "log");
  const hook = vi.fn();
  register(hook);
  mocks.apply.mockRejectedValueOnce(new Error("apply failed"));
  await expect(deploy({ yes: true, noValidate: true })).rejects.toThrow("apply failed");
  expect(hook).not.toHaveBeenCalled();
});

test("includes deployed application and website URLs in JSON without registering a hook", async () => {
  using _logger = silenceLogger("info", "warn", "success", "out", "log");
  using _json = jsonMode();
  await deploy({ yes: true, noValidate: true });
  expect(logger.out).toHaveBeenLastCalledWith({
    summary: expect.any(Object),
    status: "applied",
    workspaceId: "ws",
    applications: [
      {
        name: "app",
        configPath: "/repo/tailor.config.ts",
        url: "https://app",
        domain: "app",
        aiGateways: [],
        staticWebsites: { web: { name: "web", url: "https://web" } },
      },
    ],
  });
});

test("includes how long TailorDB migrations kept tables in maintenance mode in JSON", async () => {
  using _logger = silenceLogger("info", "warn", "success", "out", "log");
  using _json = jsonMode();
  const maintenance = {
    application: "app",
    namespaces: ["tailordb"],
    maintenanceMs: 1_010_000,
    phases: { waitingToStart: 902_000, running: 101_000 },
    migrations: [],
  };
  mocks.apply.mockResolvedValueOnce([maintenance]);

  await deploy({ yes: true, noValidate: true });

  expect(logger.out).toHaveBeenLastCalledWith(
    expect.objectContaining({ status: "applied", tailordbMaintenance: [maintenance] }),
  );
});

test("includes a static website in JSON when the config has no application", async () => {
  using _logger = silenceLogger("info", "warn", "success", "out", "log");
  using _json = jsonMode();
  mocks.getApplication.mockRejectedValueOnce(
    new ConnectError("application not found", Code.NotFound),
  );

  await deploy({ yes: true, noValidate: true });

  expect(logger.out).toHaveBeenLastCalledWith({
    summary: expect.any(Object),
    status: "applied",
    workspaceId: "ws",
    applications: [
      {
        name: "app",
        configPath: "/repo/tailor.config.ts",
        aiGateways: [],
        staticWebsites: { web: { name: "web", url: "https://web" } },
      },
    ],
  });
});

test("includes AI Gateway URLs and public OAuth clients without client secrets in JSON", async () => {
  using _logger = silenceLogger("info", "warn", "success", "out", "log");
  using _json = jsonMode();
  mocks.target.config.aiGateways = [
    { name: "ai" },
  ] as BuiltDeploymentTarget["config"]["aiGateways"];
  mocks.target.application = {
    ...mocks.target.application,
    authService: {
      config: { name: "auth" },
    } as BuiltDeploymentTarget["application"]["authService"],
  };
  await deploy({ yes: true, noValidate: true });
  expect(logger.out).toHaveBeenLastCalledWith(
    expect.objectContaining({
      applications: [
        expect.objectContaining({
          aiGateways: [{ name: "ai", url: "https://ai" }],
          auth: { namespace: "auth", oauth2Clients: [{ name: "web", clientId: "public-id" }] },
        }),
      ],
    }),
  );
  expect(JSON.stringify(vi.mocked(logger.out).mock.calls)).not.toContain("private-secret");
});

test("reports that resources were applied when loading the JSON result fails", async () => {
  using _logger = silenceLogger("info", "warn", "success", "out", "log");
  using _json = jsonMode();
  mocks.getApplication.mockRejectedValueOnce(new Error("application lookup failed"));
  await expect(deploy({ yes: true, noValidate: true })).rejects.toMatchObject({
    code: "DEPLOY_RESULT_LOAD_FAILED",
    details: "application lookup failed",
    message: expect.stringContaining("resources were applied successfully"),
  });
  expect(mocks.apply).toHaveBeenCalledOnce();
  expect(logger.out).not.toHaveBeenCalledWith(expect.objectContaining({ status: "applied" }));
});

test("reports skipped hooks when loading their context in JSON mode fails", async () => {
  using _logger = silenceLogger("info", "warn", "success", "out", "log");
  using _json = jsonMode();
  register(vi.fn());
  mocks.getApplication.mockRejectedValueOnce(new Error("application lookup failed"));
  await expect(deploy({ yes: true, noValidate: true })).rejects.toMatchObject({
    code: "DEPLOYED_HOOK_FAILED",
    message: expect.stringMatching(
      /loading the deployed information.*application lookup failed.*Hooks not run: hook \(app: app\)/s,
    ),
  });
});

function stdoutLines(output: string) {
  return (output.endsWith("\n") ? output.slice(0, -1) : output).split("\n");
}
function expectOneJsonObject(output: string) {
  const lines = stdoutLines(output);
  expect(lines).toHaveLength(1);
  const value: unknown = JSON.parse(lines[0] ?? "");
  expect(value).toEqual(expect.any(Object));
  expect(Array.isArray(value)).toBe(false);
  return value;
}
test("--json apply prints one JSON object on stdout", async () => {
  using _stderr = captureStderr();
  using _json = jsonMode();
  using stdout = captureStdoutStream();
  await deploy({ yes: true, noValidate: true });
  expect(expectOneJsonObject(stdout.output)).toMatchObject({ status: "applied" });
});
test("--json apply with a hook that logs through the provided logger keeps stdout to one JSON object", async () => {
  using _stderr = captureStderr();
  using _json = jsonMode();
  using stdout = captureStdoutStream();
  register(({ logger: hookLogger }) => {
    hookLogger.info("publishing");
    return { outputs: { published: true } };
  });
  await deploy({ yes: true, noValidate: true });
  expect(expectOneJsonObject(stdout.output)).toMatchObject({
    deployedHooks: [{ pluginId: "hook", outputs: { published: true } }],
  });
});
test("--json dry-run prints one JSON object on stdout", async () => {
  using _stderr = captureStderr();
  using _json = jsonMode();
  using stdout = captureStdoutStream();
  register(vi.fn());
  await deploy({ dryRun: true, noValidate: true });
  expect(expectOneJsonObject(stdout.output)).toMatchObject({ summary: expect.any(Object) });
});
test("--json dry-run prints a plan that deletes a table without asking to confirm the deletion", async () => {
  using _logger = silenceLogger("info", "warn", "success", "out", "log", "newline");
  using _json = jsonMode();
  using confirm = vi.spyOn(prompt, "confirm").mockResolvedValue(false);
  mocks.results.tailorDB.changeSet.type.deletes.push({ name: "Order", request: {} });
  await deploy({ dryRun: true, noValidate: true });
  expect(confirm).not.toHaveBeenCalled();
  expect(logger.out).toHaveBeenCalledWith(
    expect.objectContaining({ summary: expect.objectContaining({ delete: 1 }) }),
  );
});
test("--json dry-run lists a missing dependent application in warnings without asking", async () => {
  using _logger = silenceLogger("info", "warn", "success", "out", "log", "newline");
  using _json = jsonMode();
  using confirm = vi.spyOn(prompt, "confirm").mockResolvedValue(false);
  mocks.fetchMissingDependentApps.mockResolvedValue([
    {
      resource: 'TailorDB table "Order"',
      resourceType: "tailordb.type",
      namespace: "db",
      name: "Order",
      scope: "resource",
      appId: "0191b0f4-1c4e-7d3a-9f2b-8c5a4e6d7b81",
      reason: "publish-events",
    },
  ]);
  await deploy({ dryRun: true, noValidate: true });
  expect(confirm).not.toHaveBeenCalled();
  expect(logger.out).toHaveBeenCalledWith(
    expect.objectContaining({
      warnings: [
        {
          type: "missingDependentApp",
          resourceType: "tailordb.type",
          namespace: "db",
          name: "Order",
          appId: "0191b0f4-1c4e-7d3a-9f2b-8c5a4e6d7b81",
          reason: "publish-events",
        },
      ],
    }),
  );
});
