import { Code, ConnectError } from "@connectrpc/connect";
import { beforeEach, expect, test, vi } from "vitest";
import { logger } from "#/cli/shared/logger";
import { prompt } from "#/cli/shared/prompt";
import { captureStderr, captureStdoutStream } from "#/cli/shared/test-helpers/capture-output";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
import { mockOperatorClient } from "#/cli/shared/test-helpers/operator-client";
import { silenceLogger } from "#/cli/shared/test-helpers/silence-logger";
import { defineStaticWebSite } from "#/configure/services/staticwebsite/index";
import { applicationLabelRejection } from "./test-helpers/label-count-rejection";
import { emptyPlanResults } from "./test-helpers/plan-results";
import type { Plugin } from "#/plugin/types";
import type { applyRemainingResources, PlanResults } from "./apply-phases";
import type { BuiltDeploymentTarget } from "./deployment-target";
const mocks = vi.hoisted(() => ({
  target: undefined as unknown as BuiltDeploymentTarget,
  results: undefined as unknown as PlanResults,
  apply: vi.fn<typeof applyRemainingResources>(),
  prerequisite: vi.fn(),
  fetchMissingDependentApps: vi.fn(),
  planTailorDB: vi.fn(),
  dropCrossDeploymentManagedDeletes: vi.fn(),
  scheduleRenamedAppDeletes: vi.fn(),
  assertResourcesNotInUse: vi.fn(),
}));
vi.mock(import("./deployment-target"), async (original) => ({
  ...(await original()),
  loadDeployConfigs: async () => [
    mocks.target.source.kind === "workspace"
      ? {
          kind: "workspace",
          workspace: mocks.target.source.workspace,
          plugins: [...mocks.target.plugins],
        }
      : {
          kind: "config",
          config: mocks.target.config as never,
          plugins: [...mocks.target.plugins],
        },
  ],
  buildDeploymentTargets: async () => [mocks.target],
}));
const client = mockOperatorClient({
  getApplication: {},
  getStaticWebsite: {},
  getAIGateway: {},
  listAuthOAuth2Clients: {},
});
vi.mock("./workspace", () => ({
  resolveDeployWorkspace: async () => ({ workspaceId: "ws", client }),
}));
vi.mock("./metadata-lookup", () => ({
  createMetadataLookupClient: async () =>
    mockOperatorClient({ getMetadata: { metadata: { labels: {} } } }),
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
vi.mock(import("./managed-resources"), async (original) => {
  const actual = await original();
  mocks.dropCrossDeploymentManagedDeletes.mockImplementation(
    actual.dropCrossDeploymentManagedDeletes,
  );
  mocks.scheduleRenamedAppDeletes.mockImplementation(actual.scheduleRenamedAppDeletes);
  return {
    ...actual,
    dropCrossDeploymentManagedDeletes: mocks.dropCrossDeploymentManagedDeletes,
    scheduleRenamedAppDeletes: mocks.scheduleRenamedAppDeletes,
  };
});
vi.mock(import("./resources-in-use"), async (original) => ({
  ...(await original()),
  assertResourcesNotInUse: mocks.assertResourcesNotInUse,
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
    authServices: [],
    staticWebsiteServices: [{ name: "web" }],
    aiGatewayServices: [],
    secrets: [],
    env: {},
  };
  mocks.target = {
    source: {
      kind: "config",
      config: { path: "/repo/tailor.config.ts", name: "app" },
      application: { ...application, name: "app" },
    },
    config: { path: "/repo/tailor.config.ts", name: "app" },
    application,
    envOverrides: { resolver: {}, auth: {} },
    owner: { kind: "application", name: "app", id: undefined },
    applications: [{ name: "app", subgraphs: [], authNamespace: undefined, settings: {} }],
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
  mocks.apply.mockResolvedValue({ maintenance: [], labelRejections: [], droppedOnAppLabels: [] });
  mocks.prerequisite.mockResolvedValue({ droppedOnAppLabels: [] });
  mocks.fetchMissingDependentApps.mockResolvedValue([]);
  client.getApplication.mockResolvedValue({ application: { url: "https://app", domain: "app" } });
  client.getStaticWebsite.mockResolvedValue({ staticwebsite: { url: "https://web" } });
  client.getAIGateway.mockResolvedValue({ aigateway: { name: "ai", url: "https://ai" } });
  client.listAuthOAuth2Clients.mockResolvedValue({
    oauth2Clients: [{ name: "web", clientId: "public-id" }],
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
test("lets a hook see the profile the deploy ran with", async () => {
  using _logger = silenceLogger("info", "warn", "success", "out", "log");
  const hook = vi.fn();
  register(hook);
  await deploy({ yes: true, noValidate: true, profile: "ci" });
  expect(hook).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ profile: "ci" }));
});
test("checks resources in use after the plan drops claimed deletes and schedules renamed applications' deletes", async () => {
  using _logger = silenceLogger("info", "warn", "success", "out", "log");
  await deploy({ dryRun: true, noValidate: true });
  expect(mocks.assertResourcesNotInUse).toHaveBeenCalledExactlyOnceWith({
    deployments: expect.any(Array),
    command: "deploy",
    client: expect.objectContaining({ getApplication: client.getApplication }),
    workspaceId: "ws",
  });
  const [checked] = mocks.assertResourcesNotInUse.mock.invocationCallOrder;
  const [dropped] = mocks.dropCrossDeploymentManagedDeletes.mock.invocationCallOrder;
  const [scheduledBefore] = mocks.scheduleRenamedAppDeletes.mock.invocationCallOrder;
  expect(dropped).toBeLessThan(checked!);
  expect(scheduledBefore).toBeLessThan(checked!);
});
test("lists the pending hook during dry-run without executing it", async () => {
  using _logger = silenceLogger("info", "warn", "success", "out", "log");
  const hook = vi.fn();
  register(hook);
  await deploy({ dryRun: true, noValidate: true });
  expect(hook).not.toHaveBeenCalled();
  expect(client.getApplication).not.toHaveBeenCalled();
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
  expect(client.getApplication).not.toHaveBeenCalled();
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
  expect(client.getApplication).not.toHaveBeenCalled();
});
test("does not execute hooks during a migration baseline deploy", async () => {
  using _logger = silenceLogger("info", "warn", "success", "out", "log");
  using _json = jsonMode();
  const hook = vi.fn();
  register(hook);
  await deployMigrationTestBaseline({ yes: true, noValidate: true }, new Map(), new Map());
  expect(hook).not.toHaveBeenCalled();
  expect(client.getApplication).not.toHaveBeenCalled();
});
test("does not execute hooks during a migration target deploy", async () => {
  using _logger = silenceLogger("info", "warn", "success", "out", "log");
  using _json = jsonMode();
  const hook = vi.fn();
  register(hook);
  await deployMigrationTestTarget({ yes: true, noValidate: true }, new Map());
  expect(hook).not.toHaveBeenCalled();
  expect(client.getApplication).not.toHaveBeenCalled();
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
  expect(client.getApplication).toHaveBeenCalledExactlyOnceWith({
    workspaceId: "ws",
    applicationName: "app",
  });
  expect(client.getStaticWebsite).toHaveBeenCalledExactlyOnceWith({
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
  expect(client.getApplication).not.toHaveBeenCalled();
  expect(client.getStaticWebsite).not.toHaveBeenCalled();
});

function referenceWebsiteUrlFromEnv(onPrerequisite?: () => void) {
  mocks.target.config = {
    ...mocks.target.config,
    staticWebsites: [defineStaticWebSite("web", {})],
  };
  mocks.target.application = { ...mocks.target.application, env: { website: "web:url" } };
  mocks.prerequisite.mockImplementationOnce(async () => {
    mocks.target = {
      ...mocks.target,
      application: { ...mocks.target.application, env: { website: "https://web" } },
    };
    onPrerequisite?.();
    return { droppedOnAppLabels: [] };
  });
}

test("runs the original plugin once after the URL rebuild has been applied", async () => {
  using _logger = silenceLogger("info", "warn", "success", "out", "log");
  referenceWebsiteUrlFromEnv();
  const hook = vi.fn(() => {
    expect(mocks.apply).toHaveBeenCalledOnce();
  });
  register(hook);
  await deploy({ yes: true, noValidate: true });
  expect(hook).toHaveBeenCalledOnce();
});

test("applies a renamed application's cleanup delete from the plan the URL rebuild makes", async () => {
  using _logger = silenceLogger("info", "warn", "success", "out", "log", "newline");
  mocks.results.tailorDB.conflicts.push({
    resourceType: "tailordb.service",
    resourceLabel: "TailorDB namespace",
    resourceName: "db",
    currentOwner: "old-app",
  });
  referenceWebsiteUrlFromEnv(() => {
    mocks.results = { ...mocks.results, app: emptyPlanResults().app };
  });

  await deploy({ yes: true, noValidate: true });

  const [, applied] = mocks.apply.mock.calls[0]!;
  expect(applied[0]!.app.deletes.map((del) => del.name)).toEqual(["old-app"]);
});

function planPrintedAt(): number | undefined {
  const { calls, invocationCallOrder } = vi.mocked(logger.log).mock;
  const index = calls.findIndex(([message]) => String(message).includes("Plan: "));
  return index === -1 ? undefined : invocationCallOrder[index];
}

test("prints the plan before asking to confirm a table deletion that is then declined", async () => {
  using _logger = silenceLogger("info", "warn", "success", "out", "log", "newline");
  using confirm = vi.spyOn(prompt, "confirm").mockResolvedValue(false);
  mocks.results.tailorDB.changeSet.type.deletes.push({ name: "Order", request: {} });

  await expect(deploy({ noValidate: true })).rejects.toMatchObject({ code: "DEPLOY_CANCELLED" });

  expect(planPrintedAt()).toBeLessThan(confirm.mock.invocationCallOrder[0]!);
  expect(mocks.prerequisite).not.toHaveBeenCalled();
});

test("confirms a deletion against the printed plan before applying what the URL rebuild waits for", async () => {
  using _logger = silenceLogger("info", "warn", "success", "out", "log", "newline");
  using confirm = vi.spyOn(prompt, "confirm").mockResolvedValue(true);
  referenceWebsiteUrlFromEnv();
  mocks.results.tailorDB.changeSet.type.deletes.push({ name: "Order", request: {} });

  await deploy({ noValidate: true });

  expect(confirm).toHaveBeenCalledOnce();
  expect(planPrintedAt()).toBeLessThan(confirm.mock.invocationCallOrder[0]!);
  expect(confirm.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.prerequisite.mock.invocationCallOrder[0]!,
  );
});

test("asks again only about what the URL rebuild's plan adds", async () => {
  using _logger = silenceLogger("info", "warn", "success", "out", "log", "newline");
  using confirm = vi.spyOn(prompt, "confirm").mockResolvedValue(true);
  mocks.results.tailorDB.changeSet.type.deletes.push({ name: "Order", request: {} });
  referenceWebsiteUrlFromEnv(() => {
    mocks.results = {
      ...mocks.results,
      functionRegistry: {
        ...mocks.results.functionRegistry,
        unmanaged: [
          {
            resourceType: "function_registry",
            resourceLabel: "Function",
            resourceName: "legacy",
          },
        ],
      },
    };
  });

  await deploy({ noValidate: true });

  expect(confirm.mock.calls.map(([options]) => options.message)).toEqual([
    "Are you sure you want to delete these resources?",
    'Allow tailor to manage these resources for "app"?',
  ]);
  expect(confirm.mock.invocationCallOrder[1]).toBeGreaterThan(
    mocks.prerequisite.mock.invocationCallOrder[0]!,
  );
  expect(mocks.apply).toHaveBeenCalledOnce();
});

test("does not execute hooks after resource application fails", async () => {
  using _logger = silenceLogger("info", "warn", "success", "out", "log");
  const hook = vi.fn();
  register(hook);
  mocks.apply.mockRejectedValueOnce(new Error("apply failed"));
  await expect(deploy({ yes: true, noValidate: true })).rejects.toThrow("apply failed");
  expect(hook).not.toHaveBeenCalled();
});

function rejectApplicationLabels() {
  mocks.apply.mockResolvedValueOnce({
    maintenance: [],
    labelRejections: [applicationLabelRejection("app")],
    droppedOnAppLabels: [],
  });
}

test("runs hooks before failing on application labels the platform rejected", async () => {
  using _logger = silenceLogger("info", "warn", "success", "out", "log");
  const hook = vi.fn();
  register(hook);
  rejectApplicationLabels();
  await expect(deploy({ yes: true, noValidate: true })).rejects.toMatchObject({
    code: "DEPLOY_LABEL_LIMIT_EXCEEDED",
  });
  expect(hook).toHaveBeenCalledOnce();
  expect(logger.success).not.toHaveBeenCalled();
});

test("fails a JSON deploy on rejected application labels without loading the result", async () => {
  using _logger = silenceLogger("info", "warn", "success", "out", "log");
  using _json = jsonMode();
  rejectApplicationLabels();
  await expect(deploy({ yes: true, noValidate: true })).rejects.toMatchObject({
    code: "DEPLOY_LABEL_LIMIT_EXCEEDED",
  });
  expect(client.getApplication).not.toHaveBeenCalled();
  expect(logger.out).not.toHaveBeenCalledWith(expect.objectContaining({ status: "applied" }));
});

test("fails a migration target deploy on rejected application labels", async () => {
  using _logger = silenceLogger("info", "warn", "success", "out", "log");
  rejectApplicationLabels();
  await expect(
    deployMigrationTestTarget({ yes: true, noValidate: true }, new Map()),
  ).rejects.toMatchObject({ code: "DEPLOY_LABEL_LIMIT_EXCEEDED" });
});

test("reports a failing hook over application labels the platform rejected", async () => {
  using _logger = silenceLogger("info", "warn", "success", "out", "log");
  register(() => {
    throw new Error("publish failed");
  });
  rejectApplicationLabels();
  await expect(deploy({ yes: true, noValidate: true })).rejects.toMatchObject({
    code: "DEPLOYED_HOOK_FAILED",
  });
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
    phases: {
      restrict: 0,
      preMigration: 0,
      jobSetup: 0,
      waitingToStart: 902_000,
      running: 101_000,
      waitingOrRunning: 0,
      jobCleanup: 0,
      postMigration: 0,
      remainingDeploy: 7_000,
      restore: 0,
    },
    migrations: [],
  };
  mocks.apply.mockResolvedValueOnce({
    maintenance: [maintenance],
    labelRejections: [],
    droppedOnAppLabels: [],
  });

  await deploy({ yes: true, noValidate: true });

  expect(logger.out).toHaveBeenLastCalledWith(
    expect.objectContaining({ status: "applied", tailordbMaintenance: [maintenance] }),
  );
});

test("includes a static website in JSON when the config has no application", async () => {
  using _logger = silenceLogger("info", "warn", "success", "out", "log");
  using _json = jsonMode();
  client.getApplication.mockRejectedValueOnce(
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
  mocks.target.application = {
    ...mocks.target.application,
    aiGatewayServices: [{ name: "ai" }],
    authServices: [
      {
        config: { name: "auth" },
        connections: {},
      } as BuiltDeploymentTarget["application"]["authServices"][number],
    ],
  };
  mocks.target.applications = [{ name: "app", subgraphs: [], authNamespace: "auth", settings: {} }];
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
  client.getApplication.mockRejectedValueOnce(new Error("application lookup failed"));
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
  client.getApplication.mockRejectedValueOnce(new Error("application lookup failed"));
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

function useWorkspaceTarget() {
  const subgraphs = [{ Type: "tailordb", Name: "main" }];
  mocks.target = {
    ...mocks.target,
    source: { kind: "workspace", workspace: { path: "/repo/tailor.config.ts", apps: {} } },
    owner: { kind: "workspace" },
    applications: [
      { name: "shop", subgraphs, authNamespace: undefined, settings: {} },
      { name: "admin", subgraphs, authNamespace: undefined, settings: {} },
    ],
  } as unknown as BuiltDeploymentTarget;
}

test("runs the onDeployed hooks of a workspace config and reports their outputs without an application", async () => {
  using _logger = silenceLogger("info", "warn", "success", "out", "log");
  using _json = jsonMode();
  useWorkspaceTarget();
  register(() => ({ outputs: { published: true } }));
  await deploy({ yes: true, noValidate: true });
  expect(logger.out).toHaveBeenCalledWith(
    expect.objectContaining({
      deployedHooks: [{ pluginId: "hook", outputs: { published: true } }],
    }),
  );
});

test("lists the pending hooks of a workspace config without an application", async () => {
  using _logger = silenceLogger("info", "warn", "success", "out", "log");
  useWorkspaceTarget();
  register(vi.fn());
  await deploy({ dryRun: true, noValidate: true });
  expect(logger.info).toHaveBeenCalledWith('Hook to run after apply: "hook"');
  vi.mocked(logger.info).mockClear();
  {
    using _json = jsonMode();
    await deploy({ dryRun: true, noValidate: true });
  }
  expect(logger.out).toHaveBeenLastCalledWith(
    expect.objectContaining({ pendingDeployedHooks: [{ pluginId: "hook" }] }),
  );
});

test("deploys a workspace config without looking up applications it depends on", async () => {
  using _logger = silenceLogger("info", "warn", "success", "out", "log");
  useWorkspaceTarget();
  await deploy({ yes: true, noValidate: true });
  expect(mocks.apply).toHaveBeenCalledOnce();
  expect(mocks.fetchMissingDependentApps).not.toHaveBeenCalled();
});

test("reports every application of a workspace config in JSON", async () => {
  using _logger = silenceLogger("info", "warn", "success", "out", "log");
  using _json = jsonMode();
  useWorkspaceTarget();
  await deploy({ yes: true, noValidate: true });
  const result = vi.mocked(logger.out).mock.lastCall?.[0] as { applications: object[] };
  expect(result.applications).toEqual([
    expect.objectContaining({
      name: "shop",
      url: "https://app",
      configPath: "/repo/tailor.config.ts",
    }),
    expect.objectContaining({ name: "admin", url: "https://app" }),
  ]);
  expect(result.applications).toEqual([
    expect.not.objectContaining({ id: expect.anything() }),
    expect.not.objectContaining({ id: expect.anything() }),
  ]);
});

test("stops a defineApp() config before checking resources in use when it would take over two configs' resources", async () => {
  using _logger = silenceLogger("info", "warn", "success", "out", "log");
  useWorkspaceTarget();
  Object.assign(mocks.target.source, {
    workspace: { path: "/repo/tailor.config.ts", apps: {}, definedBy: "defineApp" },
  });
  const takeover = (resourceName: string, currentOwner: string, currentAppId: string) => ({
    resourceType: "tailordb.service" as const,
    resourceName,
    resourceLabel: "TailorDB namespace",
    action: "delete" as const,
    currentOwner,
    currentAppId,
  });
  mocks.results.tailorDB.takeovers.push(
    takeover("shop-db", "shop", "8d6f1e2a-4b3c-4d5e-9f60-7a8b9c0d1e2f"),
    takeover("admin-db", "admin", "0191b0f4-1c4e-7d3a-9f2b-8c5a4e6d7b81"),
  );
  await expect(deploy({ dryRun: true, noValidate: true })).rejects.toMatchObject({
    code: "DEPLOY_OTHER_CONFIG_RESOURCES",
  });
  expect(mocks.assertResourcesNotInUse).not.toHaveBeenCalled();
});

test("reports the sdk-on-app labels the Platform had no room for in the JSON result", async () => {
  using _logger = silenceLogger("info", "warn", "success", "out", "log");
  using _json = jsonMode();
  useWorkspaceTarget();
  mocks.prerequisite.mockResolvedValueOnce({
    droppedOnAppLabels: [{ trn: "trn:v1:workspace:ws:auth:shop-auth", applications: ["ops"] }],
  });
  mocks.apply.mockResolvedValueOnce({
    maintenance: [],
    labelRejections: [],
    droppedOnAppLabels: [
      { trn: "trn:v1:workspace:ws:tailordb:shared-db", applications: ["ops", "web"] },
    ],
  });
  await deploy({ yes: true, noValidate: true });
  expect(logger.out).toHaveBeenCalledWith(
    expect.objectContaining({
      warnings: [
        {
          type: "onAppLabelsDropped",
          resourceType: "auth.service",
          name: "shop-auth",
          applications: ["ops"],
        },
        {
          type: "onAppLabelsDropped",
          resourceType: "tailordb.service",
          name: "shared-db",
          applications: ["ops", "web"],
        },
      ],
    }),
  );
});
