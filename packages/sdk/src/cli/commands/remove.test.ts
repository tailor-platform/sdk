import * as fs from "node:fs";
import * as os from "node:os";
import { create } from "@bufbuild/protobuf";
import { runCommand } from "@politty/zod";
import { Subgraph_ServiceType } from "@tailor-platform/tailor-proto/application_resource_pb";
import { ExecutorExecutorSchema } from "@tailor-platform/tailor-proto/executor_resource_pb";
import * as path from "pathe";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  applyWorkflowJobFunctionExecutionPolicy,
  planWorkflowJobFunctionExecutionPolicy,
} from "#/cli/commands/deploy/workflow-execution-policy";
import { defineApplication } from "#/cli/services/application";
import { initOperatorClient, type OperatorClient } from "#/cli/shared/client";
import { loadConfigFile } from "#/cli/shared/config-loader";
import { logger } from "#/cli/shared/logger";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
import {
  mockOperatorClient,
  type OperatorClientMocks,
  withOperatorClientMocks,
} from "#/cli/shared/test-helpers/operator-client";
import { brandedDefault } from "#/cli/shared/test-helpers/workspace-config";
import {
  emptyPlanResults,
  plannedDeleteLists,
  PLANNED_ITEM,
} from "./deploy/test-helpers/plan-results";
import { removeCommand } from "./remove";
import type * as ConfigLoader from "#/cli/shared/config-loader";
import type { PlanResults } from "./deploy/apply-phases";

const mocks = vi.hoisted(() => ({
  plans: undefined as unknown as PlanResults,
  applyAIGateway: vi.fn(),
  applyApplication: vi.fn(),
  applyAuth: vi.fn(),
  applyExecutor: vi.fn(),
  applyFunctionRegistry: vi.fn(),
  applyIdP: vi.fn(),
  applyPipeline: vi.fn(),
  applySecretManager: vi.fn(),
  applyStaticWebsite: vi.fn(),
  applyTailorDB: vi.fn(),
  applyWorkflow: vi.fn(),
}));

vi.mock("#/cli/commands/deploy/aigateway", () => ({
  planAIGateway: async () => mocks.plans.aiGateway,
  applyAIGateway: mocks.applyAIGateway,
}));
vi.mock("#/cli/commands/deploy/application", () => ({
  planApplication: async () => mocks.plans.app,
  applyApplication: mocks.applyApplication,
}));
vi.mock("#/cli/commands/deploy/auth", () => ({
  planAuth: async () => mocks.plans.auth,
  applyAuth: mocks.applyAuth,
}));
vi.mock("#/cli/commands/deploy/executor", () => ({
  planExecutor: async () => mocks.plans.executor,
  applyExecutor: mocks.applyExecutor,
}));
vi.mock("#/cli/commands/deploy/function-registry", () => ({
  planFunctionRegistry: async () => mocks.plans.functionRegistry,
  applyFunctionRegistry: mocks.applyFunctionRegistry,
}));
vi.mock("#/cli/commands/deploy/idp", () => ({
  planIdP: async () => mocks.plans.idp,
  applyIdP: mocks.applyIdP,
}));
vi.mock("#/cli/commands/deploy/resolver", () => ({
  planPipeline: async () => mocks.plans.pipeline,
  applyPipeline: mocks.applyPipeline,
}));
vi.mock("#/cli/commands/deploy/secret-manager", () => ({
  planSecretManager: async () => mocks.plans.secretManager,
  applySecretManager: mocks.applySecretManager,
}));
vi.mock("#/cli/commands/deploy/staticwebsite", async (importOriginal) => ({
  ...(await importOriginal()),
  planStaticWebsite: async () => mocks.plans.staticWebsite,
  applyStaticWebsite: mocks.applyStaticWebsite,
}));
vi.mock("#/cli/commands/deploy/tailordb/index", () => ({
  planTailorDB: async () => mocks.plans.tailorDB,
  applyTailorDB: mocks.applyTailorDB,
}));
vi.mock("#/cli/commands/deploy/workflow", () => ({
  planWorkflow: async () => mocks.plans.workflow,
  applyWorkflow: mocks.applyWorkflow,
}));
vi.mock(import("#/cli/commands/deploy/workflow-execution-policy"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    planWorkflowJobFunctionExecutionPolicy: vi.fn(actual.planWorkflowJobFunctionExecutionPolicy),
    applyWorkflowJobFunctionExecutionPolicy: vi.fn(actual.applyWorkflowJobFunctionExecutionPolicy),
  };
});
vi.mock("#/cli/services/application", () => ({
  defineApplication: vi.fn(() => ({
    name: "my-app",
    id: "app-id",
    config: {},
    subgraphs: [],
    authServices: [],
  })),
}));
vi.mock("#/cli/shared/client", async (importOriginal) => ({
  ...(await importOriginal()),
  initOperatorClient: vi.fn(),
}));
vi.mock("#/cli/shared/config-loader", async (importOriginal) => ({
  ...(await importOriginal()),
  loadConfigFile: vi.fn(async () => ({
    kind: "config",
    config: { path: "/tailor.config.ts" },
    plugins: [],
  })),
}));
vi.mock("#/cli/shared/context", async (importOriginal) => ({
  ...(await importOriginal()),
  loadAccessToken: vi.fn(async () => "token"),
  loadWorkspaceId: vi.fn(async () => "workspace-id"),
}));
vi.mock("#/cli/shared/logger", async (importOriginal) => ({
  ...(await importOriginal()),
  logger: {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    log: vi.fn(),
    newline: vi.fn(),
    out: vi.fn(),
    jsonMode: false,
  },
  styles: {
    bold: (value: string) => value,
  },
  symbols: {
    create: "+",
    delete: "-",
    update: "~",
    replace: "±",
  },
}));
vi.mock("#/cli/shared/readonly-guard", () => ({ assertWritable: vi.fn() }));

// Removal desires no static website, so it plans no custom domain change.
const DELETE_LISTS_REMOVAL_NEVER_PLANS = new Set([
  "staticWebsite.customDomainChangeSet",
  "staticWebsite.customDomainTransferChangeSet",
]);

const APPLY_BY_PLAN: Record<keyof PlanResults, { mock: { calls: unknown[][] } }> = {
  functionRegistry: mocks.applyFunctionRegistry,
  tailorDB: mocks.applyTailorDB,
  staticWebsite: mocks.applyStaticWebsite,
  aiGateway: mocks.applyAIGateway,
  idp: mocks.applyIdP,
  auth: mocks.applyAuth,
  pipeline: mocks.applyPipeline,
  app: mocks.applyApplication,
  executor: mocks.applyExecutor,
  workflow: mocks.applyWorkflow,
  workflowExecutionPolicy: vi.mocked(applyWorkflowJobFunctionExecutionPolicy),
  secretManager: mocks.applySecretManager,
};

function mockClient<K extends keyof OperatorClient = never>(methods?: OperatorClientMocks<K>) {
  const client = withOperatorClientMocks(
    mockOperatorClient({
      listWorkflowJobFunctionExecutionPolicies: { policies: [], nextPageToken: "" },
    }),
    methods,
  );
  vi.mocked(initOperatorClient).mockResolvedValue(client);
  return client;
}

describe("remove command", () => {
  beforeEach(() => {
    mocks.plans = emptyPlanResults();
    vi.mocked(planWorkflowJobFunctionExecutionPolicy).mockReset();
    vi.mocked(applyWorkflowJobFunctionExecutionPolicy).mockReset();
  });

  test("deletes a managed workflow execution policy when it is the only remaining resource", async () => {
    const client = mockClient({
      listWorkflowJobFunctionExecutionPolicies: {
        policies: [{ name: "premium" }],
        nextPageToken: "",
      },
      getMetadata: { metadata: { labels: { "sdk-name": "my-app" } } },
      deleteWorkflowJobFunctionExecutionPolicy: {},
    });

    await runCommand(removeCommand, ["--yes"]);

    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining("Workflow execution policies:\n  - premium"),
    );
    expect(client.deleteWorkflowJobFunctionExecutionPolicy).toHaveBeenCalledWith({
      workspaceId: "workspace-id",
      executionPolicyName: "premium",
    });
    expect(mocks.applyWorkflow.mock.invocationCallOrder[0]!).toBeLessThan(
      client.deleteWorkflowJobFunctionExecutionPolicy.mock.invocationCallOrder[0]!,
    );
    expect(
      client.deleteWorkflowJobFunctionExecutionPolicy.mock.invocationCallOrder[0]!,
    ).toBeLessThan(mocks.applyExecutor.mock.invocationCallOrder[0]!);
    expect(logger.success).toHaveBeenNthCalledWith(
      1,
      "Removing all resources (--yes flag specified)...",
    );
    expect(logger.success).toHaveBeenNthCalledWith(
      2,
      'Successfully removed all resources managed by "my-app".',
    );
  });
  test("prints the removal under JSON output", async () => {
    mockClient({
      listWorkflowJobFunctionExecutionPolicies: {
        policies: [{ name: "premium" }],
        nextPageToken: "",
      },
      getMetadata: { metadata: { labels: { "sdk-name": "my-app" } } },
      deleteWorkflowJobFunctionExecutionPolicy: {},
    });
    using _json = jsonMode();

    await runCommand(removeCommand, ["--yes"]);

    expect(logger.out).toHaveBeenCalledWith({
      changed: true,
      workspaceId: "workspace-id",
      application: "my-app",
      complete: true,
    });
  });

  test("reports no change under JSON output when nothing is left to remove", async () => {
    mockClient();
    using _json = jsonMode();

    await runCommand(removeCommand, ["--yes"]);

    expect(logger.out).toHaveBeenCalledWith({
      changed: false,
      workspaceId: "workspace-id",
      application: "my-app",
      complete: true,
    });
  });

  test("names only delete lists that plan results contain as never planned by removal", () => {
    const paths = new Set(plannedDeleteLists(emptyPlanResults()).keys());

    expect([...DELETE_LISTS_REMOVAL_NEVER_PLANS].filter((path) => !paths.has(path))).toEqual([]);
  });

  test.each(
    [...plannedDeleteLists(emptyPlanResults()).keys()].filter(
      (path) => !DELETE_LISTS_REMOVAL_NEVER_PLANS.has(path),
    ),
  )("lists and applies a planned delete from %s when it is the only one", async (path) => {
    vi.mocked(initOperatorClient).mockResolvedValue(
      mockOperatorClient({
        deleteWorkflowJobFunctionExecutionPolicy: {},
        listOTLPExporters: { otlpExporters: [], nextPageToken: "" },
      }),
    );
    vi.mocked(planWorkflowJobFunctionExecutionPolicy).mockImplementation(
      async () => mocks.plans.workflowExecutionPolicy,
    );
    plannedDeleteLists(mocks.plans).get(path)!.push(PLANNED_ITEM);
    const kind = path.split(".")[0] as keyof PlanResults;
    using _json = jsonMode();

    await runCommand(removeCommand, ["--yes"]);

    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining(`- ${PLANNED_ITEM.name}`));
    expect(APPLY_BY_PLAN[kind].mock.calls.flat()).toContain(mocks.plans[kind]);
    expect(logger.out).toHaveBeenCalledWith(expect.objectContaining({ changed: true }));
  });

  test("stops before listing or deleting anything when another application uses a service it deletes", async () => {
    mockClient();
    mocks.plans.app.deletes.push({ ...PLANNED_ITEM, name: "my-app" });
    mocks.plans.app.existingApplications = [
      {
        name: "my-app",
        authNamespace: "shared-auth",
        subgraphs: [{ serviceType: Subgraph_ServiceType.TAILORDB, serviceNamespace: "main" }],
      },
      {
        name: "portal",
        authNamespace: "shared-auth",
        subgraphs: [
          { serviceType: Subgraph_ServiceType.PIPELINE, serviceNamespace: "my-resolvers" },
          { serviceType: Subgraph_ServiceType.IDP, serviceNamespace: "my-idp" },
        ],
      },
    ] as never;
    mocks.plans.auth.changeSet.service.deletes.push({ ...PLANNED_ITEM, name: "shared-auth" });
    mocks.plans.auth.changeSet.machineUser.deletes.push({ ...PLANNED_ITEM, name: "admin" });
    mocks.plans.tailorDB.changeSet.service.deletes.push({ ...PLANNED_ITEM, name: "main" });
    mocks.plans.pipeline.changeSet.service.deletes.push({
      ...PLANNED_ITEM,
      name: "my-resolvers",
    });
    mocks.plans.idp.changeSet.service.deletes.push({ ...PLANNED_ITEM, name: "my-idp" });

    const result = await runCommand(removeCommand, ["--yes"]);

    expect(result.error).toMatchObject({
      code: "SERVICE_IN_USE",
      message: [
        'Auth service "shared-auth" cannot be deleted: application "portal" still uses it.',
        'Resolver namespace "my-resolvers" cannot be deleted: application "portal" still uses it.',
        'IdP service "my-idp" cannot be deleted: application "portal" still uses it.',
      ].join("\n"),
      suggestion: expect.stringContaining("then run remove again"),
    });
    expect(logger.log).not.toHaveBeenCalledWith(expect.stringContaining("Auth services:"));
    expect(Object.values(APPLY_BY_PLAN).flatMap((apply) => apply.mock.calls)).toEqual([]);
  });

  test("stops before listing or deleting anything when another application's executor subscribes to a workflow it deletes", async () => {
    mockClient();
    mocks.plans.workflow.changeSet.deletes.push({
      name: "order-flow",
      workspaceId: "ws",
      workflowId: "id",
      usedJobNames: [],
    });
    mocks.plans.executor.existingExecutors = {
      notify: {
        resource: create(ExecutorExecutorSchema, {
          name: "notify",
          triggerConfig: {
            config: {
              case: "event",
              value: { typedConfig: { case: "workflow", value: { workflowName: "order-flow" } } },
            },
          },
        }),
        allLabels: { "sdk-name": "portal" },
      },
    };

    const result = await runCommand(removeCommand, ["--yes"]);

    expect(result.error).toMatchObject({
      code: "SERVICE_IN_USE",
      message:
        'Workflow "order-flow" cannot be deleted: executor "notify" of application "portal" still uses it.',
    });
    expect(logger.log).not.toHaveBeenCalledWith(expect.stringContaining("Workflows:"));
    expect(Object.values(APPLY_BY_PLAN).flatMap((apply) => apply.mock.calls)).toEqual([]);
  });

  test("lists workflow job functions under their own heading", async () => {
    mockClient();
    mocks.plans.workflow.jobFunctionDeletes.push({
      workspaceId: "workspace-id",
      jobFunctionName: "process-order",
    });

    await runCommand(removeCommand, ["--yes"]);

    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining("Workflow job functions:\n  - process-order"),
    );
  });

  test("removes by the app id recorded in the governing lock", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "remove-lock-"));
    try {
      const lockedId = "22222222-2222-4222-8222-222222222222";
      fs.mkdirSync(path.join(root, ".github"));
      fs.writeFileSync(
        path.join(root, ".github/tailor.lock"),
        JSON.stringify({ version: 2, targets: [], appIds: { "tailor.config.ts": lockedId } }),
      );
      const configPath = path.join(root, "tailor.config.ts");
      fs.writeFileSync(configPath, "");
      vi.mocked(loadConfigFile).mockResolvedValueOnce({
        kind: "config",
        config: { name: "my-app", path: configPath },
        plugins: [],
      });
      mockClient();

      await runCommand(removeCommand, ["--yes"]);

      expect(defineApplication).toHaveBeenCalledWith({
        config: expect.objectContaining({ id: lockedId }),
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("does not claim success when same-name resources were left behind", async () => {
    // A resource tagged with this application's name that it does not own by id
    // is skipped. Reporting success would say the workspace is clean when it is not.
    mockClient({ getMetadata: { metadata: { labels: {} } } });
    mocks.plans.executor.resourceOwners.add("my-app");

    await runCommand(removeCommand, ["--yes"]);

    expect(logger.success).not.toHaveBeenCalledWith(
      'Successfully removed all resources managed by "my-app".',
    );
    // The mismatch happens both when the config has no id and when it carries a
    // different one, so the message must not presuppose a missing id.
    const warned = vi
      .mocked(logger.warn)
      .mock.calls.map((call) => String(call[0]))
      .join("\n");
    expect(warned).toContain("my-app");
    expect(warned).toContain("does not match");
    expect(warned).toContain("deploy");
  });

  test("reports an incomplete removal under JSON output when resources were left behind", async () => {
    mockClient({ getMetadata: { metadata: { labels: {} } } });
    mocks.plans.executor.resourceOwners.add("my-app");
    using _json = jsonMode();

    await runCommand(removeCommand, ["--yes"]);

    expect(logger.out).toHaveBeenCalledWith({
      changed: false,
      workspaceId: "workspace-id",
      application: "my-app",
      complete: false,
    });
  });

  test("rejects a workspace config before reaching the Platform, pointing to deploy and workspace delete", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "remove-workspace-"));
    try {
      const configPath = path.join(root, "tailor.config.ts");
      fs.writeFileSync(
        configPath,
        brandedDefault(
          "workspace-config",
          `{ db: { "main-db": { files: [] } }, apps: { shop: { db: ["main-db"] } } }`,
        ),
      );
      const actual = await vi.importActual<typeof ConfigLoader>("#/cli/shared/config-loader");
      vi.mocked(loadConfigFile).mockImplementationOnce(actual.loadConfigFile);
      vi.mocked(initOperatorClient).mockClear();

      const workspaceId = "33333333-3333-4333-8333-333333333333";

      const result = await runCommand(removeCommand, [
        "--config",
        configPath,
        "--workspace-id",
        workspaceId,
        "--yes",
      ]);

      expect(result.error).toMatchObject({
        code: "CONFIG_KIND_UNSUPPORTED",
        suggestion: expect.stringMatching(
          new RegExp(`tailor deploy.*tailor workspace delete --workspace-id ${workspaceId}`, "s"),
        ),
      });
      expect(initOperatorClient).not.toHaveBeenCalled();
      expect(defineApplication).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
