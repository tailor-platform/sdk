import { create, type DescFile, type DescMessage, type MessageInitShape } from "@bufbuild/protobuf";
import { nestedTypes } from "@bufbuild/protobuf/reflect";
import { Code, ConnectError } from "@connectrpc/connect";
import { AIGatewaySchema } from "@tailor-platform/tailor-proto/aigateway_resource_pb";
import { Subgraph_ServiceType } from "@tailor-platform/tailor-proto/application_resource_pb";
import {
  AuthIDPConfig_AuthType,
  AuthIDPConfigSchema,
  AuthSCIMConfig_AuthorizationType,
  AuthSCIMConfigSchema,
} from "@tailor-platform/tailor-proto/auth_resource_pb";
import { ExecutorExecutorSchema } from "@tailor-platform/tailor-proto/executor_resource_pb";
import { PipelineResolverView } from "@tailor-platform/tailor-proto/pipeline_pb";
import { PipelineResolverSchema } from "@tailor-platform/tailor-proto/pipeline_resource_pb";
import { file_tailor_v1_service } from "@tailor-platform/tailor-proto/service_pb";
import { describe, expect, test, vi } from "vitest";
import { dropCrossDeploymentManagedDeletes } from "./managed-resources";
import { assertResourcesNotInUse } from "./resources-in-use";
import { emptyPlanResults } from "./test-helpers/plan-results";
import type { OperatorClient } from "#/cli/shared/client";
import type { PlanResults, PlannedDeployment } from "./apply-phases";

type ApplicationShape = {
  name: string;
  subgraphs?: Array<{ Type: string; Name: string }>;
  authService?: { config: { name: string } };
  config?: { auth: { name: string; external: true } };
};

type WorkspaceApplication = {
  name: string;
  authNamespace?: string;
  subgraphs?: Array<{ serviceType: Subgraph_ServiceType; serviceNamespace: string }>;
};

function check(deployments: PlannedDeployment[], command: "deploy" | "remove", client = {}) {
  return assertResourcesNotInUse({
    deployments,
    command,
    client: client as OperatorClient,
    workspaceId: "ws",
  });
}

function deployment(application: ApplicationShape, results: PlanResults) {
  return {
    application: { subgraphs: [], ...application },
    ...results,
  } as unknown as PlannedDeployment;
}

function ownerDeleting(authNamespace: string, results = emptyPlanResults()) {
  results.auth.changeSet.service.deletes.push({ name: authNamespace, request: {} });
  return results;
}

function referencingExternally(authNamespace: string): ApplicationShape {
  return { name: "portal", config: { auth: { name: authNamespace, external: true } } };
}

function plannedApplication(name: string) {
  const results = emptyPlanResults();
  results.app.unchanged.push({ name } as never);
  return results;
}

function withWorkspaceApplications(results: PlanResults, applications: WorkspaceApplication[]) {
  results.app.existingApplications = applications.map((application) => ({
    authNamespace: "",
    subgraphs: [],
    ...application,
  })) as never;
  return results;
}

const SUBGRAPH_SERVICES = [
  {
    label: "TailorDB namespace",
    resourceType: "tailordb.service",
    configType: "tailordb",
    serviceType: Subgraph_ServiceType.TAILORDB,
    deletesOf: (results: PlanResults) => results.tailorDB.changeSet.service.deletes,
  },
  {
    label: "Resolver namespace",
    resourceType: "pipeline.service",
    configType: "pipeline",
    serviceType: Subgraph_ServiceType.PIPELINE,
    deletesOf: (results: PlanResults) => results.pipeline.changeSet.service.deletes,
  },
  {
    label: "IdP service",
    resourceType: "idp.service",
    configType: "idp",
    serviceType: Subgraph_ServiceType.IDP,
    deletesOf: (results: PlanResults) => results.idp.changeSet.service.deletes,
  },
];

describe("assertResourcesNotInUse", () => {
  test("rejects a deleted Auth service that an application outside the run still uses", async () => {
    const owner = withWorkspaceApplications(ownerDeleting("shared-auth"), [
      { name: "portal", authNamespace: "shared-auth" },
    ]);

    await expect(check([deployment({ name: "core" }, owner)], "deploy")).rejects.toThrow(
      expect.objectContaining({
        code: "SERVICE_IN_USE",
        message:
          'Auth service "shared-auth" cannot be deleted: application "portal" still uses it.',
        suggestion: expect.stringContaining("first or in the same run"),
        context: {
          uses: [{ resourceType: "auth.service", name: "shared-auth", application: "portal" }],
        },
      }),
    );
  });

  test("reports each application that uses a deleted Auth service once", async () => {
    const workspaceApplications = [
      { name: "portal", authNamespace: "shared-auth" },
      { name: "admin", authNamespace: "shared-auth" },
    ];
    const owner = withWorkspaceApplications(ownerDeleting("shared-auth"), workspaceApplications);
    const peer = withWorkspaceApplications(emptyPlanResults(), workspaceApplications);

    await expect(
      check([deployment({ name: "core" }, owner), deployment({ name: "billing" }, peer)], "deploy"),
    ).rejects.toThrow(
      expect.objectContaining({
        message: [
          'Auth service "shared-auth" cannot be deleted: application "portal" still uses it.',
          'Auth service "shared-auth" cannot be deleted: application "admin" still uses it.',
        ].join("\n"),
      }),
    );
  });

  test("rejects a deleted Auth service that another config in the run still references", async () => {
    await expect(
      check(
        [
          deployment({ name: "core" }, ownerDeleting("shared-auth")),
          deployment(referencingExternally("shared-auth"), plannedApplication("portal")),
        ],
        "deploy",
      ),
    ).rejects.toThrow(
      expect.objectContaining({
        code: "SERVICE_IN_USE",
        message: expect.stringContaining('application "portal"'),
      }),
    );
  });

  test("accepts an application of the run that no longer references the deleted Auth service", async () => {
    const owner = withWorkspaceApplications(ownerDeleting("shared-auth"), [
      { name: "core", authNamespace: "shared-auth" },
      { name: "portal", authNamespace: "shared-auth" },
    ]);
    owner.app.updates.push({ name: "core" } as never);

    await expect(
      check(
        [
          deployment({ name: "core" }, owner),
          deployment({ name: "portal" }, plannedApplication("portal")),
        ],
        "deploy",
      ),
    ).resolves.toBeUndefined();
  });

  test("rejects an application of the run whose gateway the plan does not rewrite", async () => {
    const owner = withWorkspaceApplications(ownerDeleting("shared-auth"), [
      { name: "portal", authNamespace: "shared-auth" },
    ]);

    await expect(
      check(
        [deployment({ name: "core" }, owner), deployment({ name: "portal" }, emptyPlanResults())],
        "deploy",
      ),
    ).rejects.toThrow(expect.objectContaining({ code: "SERVICE_IN_USE" }));
  });

  test("accepts an application that the run deletes", async () => {
    const owner = withWorkspaceApplications(ownerDeleting("shared-auth"), [
      { name: "legacy", authNamespace: "shared-auth" },
    ]);
    owner.app.deletes.push({ name: "legacy", request: {} });

    await expect(check([deployment({ name: "core" }, owner)], "deploy")).resolves.toBeUndefined();
  });

  test("accepts a deleted Auth service that no application uses", async () => {
    const owner = withWorkspaceApplications(ownerDeleting("shared-auth"), [
      { name: "portal", authNamespace: "other-auth" },
    ]);

    await expect(check([deployment({ name: "core" }, owner)], "deploy")).resolves.toBeUndefined();
  });

  test("accepts an application that another config in the run defines the Auth service for again", async () => {
    const previousOwner = ownerDeleting("shared-auth");
    const nextOwner = emptyPlanResults();
    nextOwner.auth.changeSet.service.updates.push({ name: "shared-auth" } as never);
    const deployments = [
      deployment({ name: "previous" }, previousOwner),
      deployment({ name: "next" }, nextOwner),
      deployment(referencingExternally("shared-auth"), plannedApplication("portal")),
    ];

    dropCrossDeploymentManagedDeletes(deployments);

    await expect(check(deployments, "deploy")).resolves.toBeUndefined();
  });

  test("ignores applications when the run deletes no service", async () => {
    const owner = withWorkspaceApplications(emptyPlanResults(), [
      {
        name: "portal",
        authNamespace: "shared-auth",
        subgraphs: [{ serviceType: Subgraph_ServiceType.TAILORDB, serviceNamespace: "main" }],
      },
    ]);

    await expect(check([deployment({ name: "core" }, owner)], "deploy")).resolves.toBeUndefined();
  });

  test.each(SUBGRAPH_SERVICES)(
    "rejects a deleted $label that an application outside the run lists as a subgraph",
    async ({ label, resourceType, serviceType, deletesOf }) => {
      const owner = withWorkspaceApplications(emptyPlanResults(), [
        { name: "viewer", subgraphs: [{ serviceType, serviceNamespace: "shared" }] },
      ]);
      deletesOf(owner).push({ name: "shared" } as never);

      await expect(check([deployment({ name: "owner" }, owner)], "remove")).rejects.toThrow(
        expect.objectContaining({
          code: "SERVICE_IN_USE",
          message: `${label} "shared" cannot be deleted: application "viewer" still uses it.`,
          context: { uses: [{ resourceType, name: "shared", application: "viewer" }] },
        }),
      );
    },
  );

  test.each(SUBGRAPH_SERVICES)(
    "rejects a deleted $label that another config in the run references",
    async ({ label, configType, deletesOf }) => {
      const owner = emptyPlanResults();
      deletesOf(owner).push({ name: "shared" } as never);

      await expect(
        check(
          [
            deployment({ name: "owner" }, owner),
            deployment(
              {
                name: "viewer",
                subgraphs: [
                  { Type: "auth", Name: "shared" },
                  { Type: configType, Name: "shared" },
                ],
              },
              plannedApplication("viewer"),
            ),
          ],
          "deploy",
        ),
      ).rejects.toThrow(
        expect.objectContaining({
          message: `${label} "shared" cannot be deleted: application "viewer" still uses it.`,
        }),
      );
    },
  );

  test.each(SUBGRAPH_SERVICES)(
    "accepts an application of the run whose config no longer lists the deleted $label",
    async ({ serviceType, deletesOf }) => {
      const owner = withWorkspaceApplications(emptyPlanResults(), [
        { name: "viewer", subgraphs: [{ serviceType, serviceNamespace: "shared" }] },
      ]);
      deletesOf(owner).push({ name: "shared" } as never);

      await expect(
        check(
          [
            deployment({ name: "owner" }, owner),
            deployment({ name: "viewer" }, plannedApplication("viewer")),
          ],
          "deploy",
        ),
      ).resolves.toBeUndefined();
    },
  );

  test.each(SUBGRAPH_SERVICES)(
    "rejects an application of the run whose gateway keeps listing the deleted $label",
    async ({ serviceType, deletesOf }) => {
      const owner = withWorkspaceApplications(emptyPlanResults(), [
        { name: "viewer", subgraphs: [{ serviceType, serviceNamespace: "shared" }] },
      ]);
      deletesOf(owner).push({ name: "shared" } as never);

      await expect(
        check(
          [
            deployment({ name: "owner" }, owner),
            deployment({ name: "viewer" }, emptyPlanResults()),
          ],
          "deploy",
        ),
      ).rejects.toThrow(expect.objectContaining({ code: "SERVICE_IN_USE" }));
    },
  );

  test.each(SUBGRAPH_SERVICES)(
    "accepts a deleted $label that only an application the run deletes lists",
    async ({ serviceType, deletesOf }) => {
      const owner = withWorkspaceApplications(emptyPlanResults(), [
        { name: "owner", subgraphs: [{ serviceType, serviceNamespace: "shared" }] },
      ]);
      owner.app.deletes.push({ name: "owner", request: {} });
      deletesOf(owner).push({ name: "shared" } as never);

      await expect(
        check([deployment({ name: "owner" }, owner)], "remove"),
      ).resolves.toBeUndefined();
    },
  );

  test("reports every deleted service an application uses in one error", async () => {
    const owner = withWorkspaceApplications(ownerDeleting("shared-auth"), [
      {
        name: "viewer",
        authNamespace: "shared-auth",
        subgraphs: [{ serviceType: Subgraph_ServiceType.TAILORDB, serviceNamespace: "main" }],
      },
    ]);
    owner.tailorDB.changeSet.service.deletes.push({ name: "main" } as never);

    await expect(check([deployment({ name: "owner" }, owner)], "remove")).rejects.toThrow(
      expect.objectContaining({
        message: [
          'Auth service "shared-auth" cannot be deleted: application "viewer" still uses it.',
          'TailorDB namespace "main" cannot be deleted: application "viewer" still uses it.',
        ].join("\n"),
        suggestion:
          "Remove the applications that use each listed resource, or deploy them so that they stop using it, then run remove again.",
      }),
    );
  });

  test("matches a use only against deleted services of the same kind", async () => {
    const owner = withWorkspaceApplications(ownerDeleting("shared-auth"), [
      {
        name: "viewer",
        authNamespace: "shared-auth",
        subgraphs: [
          { serviceType: Subgraph_ServiceType.AUTH, serviceNamespace: "shared-auth" },
          { serviceType: Subgraph_ServiceType.IDP, serviceNamespace: "main" },
          { serviceType: Subgraph_ServiceType.PIPELINE, serviceNamespace: "main" },
        ],
      },
    ]);
    owner.tailorDB.changeSet.service.deletes.push({ name: "main" } as never);

    await expect(check([deployment({ name: "owner" }, owner)], "remove")).rejects.toThrow(
      expect.objectContaining({
        message:
          'Auth service "shared-auth" cannot be deleted: application "viewer" still uses it.',
      }),
    );
  });
});

type ExecutorInit = MessageInitShape<typeof ExecutorExecutorSchema>;

type EventConfig = Extract<
  NonNullable<NonNullable<ExecutorInit["triggerConfig"]>["config"]>,
  { case: "event" }
>["value"]["typedConfig"];

const INVOKER = { namespace: "core-auth", machineUserName: "admin" };

const FUNCTION_TARGET: ExecutorInit["targetConfig"] = {
  config: { case: "function", value: { invoker: INVOKER } },
};

const ADMIN = 'Machine user "admin" of Auth service "core-auth"';

const ADMIN_USE = { resourceType: "auth.machine_user", namespace: "core-auth", name: "admin" };

function eventTrigger(typedConfig: EventConfig): ExecutorInit["triggerConfig"] {
  return { config: { case: "event", value: { typedConfig } } };
}

function withWorkspaceExecutor(results: PlanResults, executor: ExecutorInit, application?: string) {
  results.executor.existingExecutors[executor.name!] = {
    resource: create(ExecutorExecutorSchema, executor),
    allLabels: application ? { "sdk-name": application } : {},
  };
  return results;
}

function withWorkspaceGateway(results: PlanResults) {
  results.aiGateway.existingGateways = {
    chat: {
      resource: create(AIGatewaySchema, { name: "chat", authNamespace: "core-auth" }),
      allLabels: { "sdk-name": "viewer" },
    },
  };
  return results;
}

function deletingAdmin(results = emptyPlanResults()) {
  results.auth.changeSet.machineUser.deletes.push({
    name: "admin",
    request: { workspaceId: "ws", authNamespace: "core-auth", name: "admin" },
  });
  return results;
}

function deletingOrderFlow(results: PlanResults) {
  results.workflow.changeSet.deletes.push({
    name: "order-flow",
    workspaceId: "ws",
    workflowId: "id",
    usedJobNames: [],
  });
}

function deletingOrderTable(results: PlanResults) {
  results.tailorDB.changeSet.type.deletes.push({
    name: "Order",
    request: { workspaceId: "ws", namespaceName: "main", tailordbTypeName: "Order" },
  });
}

function deletingCoreApplication(results: PlanResults) {
  results.app.deletes.push({ name: "core", request: {} });
}

const API_KEY = { vaultName: "shared", secretKey: "api-key" };

const API_KEY_LABEL = 'Secret "api-key" in vault "shared"';

const API_KEY_USE = { resourceType: "secret.secret", namespace: "shared", name: "api-key" };

function deletingApiKey(results = emptyPlanResults()) {
  results.secretManager.secretChangeSet.deletes.push({
    name: "shared/api-key",
    secretName: "api-key",
    workspaceId: "ws",
    vaultName: "shared",
  });
  return results;
}

function resolverInvoking(name: string) {
  return create(PipelineResolverSchema, { name, pipelines: [{ name: "step", invoker: INVOKER }] });
}

function inUse(message: unknown, uses?: unknown[]) {
  return expect.objectContaining({
    code: "SERVICE_IN_USE",
    message,
    ...(uses ? { context: { uses } } : {}),
  });
}

const EXECUTOR_USES: Array<{
  label: string;
  field?: string;
  deletes: (results: PlanResults) => void;
  executor: ExecutorInit;
  resource: string;
  use: { resourceType: string; namespace?: string; name: string };
}> = [
  {
    label: "machine user that a function target runs as",
    field: "tailor.v1.ExecutorTargetFunctionConfig.invoker",
    deletes: deletingAdmin,
    executor: { targetConfig: FUNCTION_TARGET },
    resource: ADMIN,
    use: ADMIN_USE,
  },
  {
    label: "machine user that a disabled graphql target runs as",
    field: "tailor.v1.ExecutorTargetTailorGraphqlConfig.invoker",
    deletes: deletingAdmin,
    executor: {
      disabled: true,
      targetConfig: { config: { case: "tailorGraphql", value: { invoker: INVOKER } } },
    },
    resource: ADMIN,
    use: ADMIN_USE,
  },
  {
    label: "machine user that a workflow target runs as",
    field: "tailor.v1.ExecutorTargetWorkflowConfig.invoker",
    deletes: deletingAdmin,
    executor: {
      targetConfig: {
        config: { case: "workflow", value: { workflowName: "sync", invoker: INVOKER } },
      },
    },
    resource: ADMIN,
    use: ADMIN_USE,
  },
  {
    label: "workflow that an execution trigger names",
    deletes: deletingOrderFlow,
    executor: {
      triggerConfig: eventTrigger({ case: "workflow", value: { workflowName: "order-flow" } }),
    },
    resource: 'Workflow "order-flow"',
    use: { resourceType: "workflow", name: "order-flow" },
  },
  {
    label: "workflow that a workflow target starts",
    deletes: deletingOrderFlow,
    executor: {
      targetConfig: { config: { case: "workflow", value: { workflowName: "order-flow" } } },
    },
    resource: 'Workflow "order-flow"',
    use: { resourceType: "workflow", name: "order-flow" },
  },
  {
    label: "TailorDB table that a record trigger names",
    deletes: deletingOrderTable,
    executor: {
      triggerConfig: eventTrigger({
        case: "tailordb",
        value: { namespaceName: "main", typeName: "Order" },
      }),
    },
    resource: 'TailorDB table "Order" in namespace "main"',
    use: { resourceType: "tailordb.type", namespace: "main", name: "Order" },
  },
  {
    label: "resolver that a resolver trigger names",
    deletes: (results) =>
      results.pipeline.changeSet.resolver.deletes.push({
        name: "createOrder",
        request: { workspaceId: "ws", namespaceName: "main", resolverName: "createOrder" },
      }),
    executor: {
      triggerConfig: eventTrigger({
        case: "pipeline",
        value: { namespaceName: "main", resolverName: "createOrder" },
      }),
    },
    resource: 'Resolver "createOrder" in namespace "main"',
    use: { resourceType: "pipeline.resolver", namespace: "main", name: "createOrder" },
  },
  {
    label: "IdP that an IdP user trigger names",
    deletes: (results) =>
      results.idp.changeSet.service.deletes.push({ name: "main-idp", request: {} }),
    executor: {
      triggerConfig: eventTrigger({ case: "idp", value: { namespaceName: "main-idp" } }),
    },
    resource: 'IdP service "main-idp"',
    use: { resourceType: "idp.service", name: "main-idp" },
  },
  {
    label: "Auth service that an access token trigger names",
    deletes: (results) => ownerDeleting("core-auth", results),
    executor: {
      triggerConfig: eventTrigger({ case: "auth", value: { namespaceName: "core-auth" } }),
    },
    resource: 'Auth service "core-auth"',
    use: { resourceType: "auth.service", name: "core-auth" },
  },
  {
    label: "application that a graphql target queries",
    field: "tailor.v1.ExecutorTargetTailorGraphqlConfig.app_name",
    deletes: deletingCoreApplication,
    executor: {
      targetConfig: { config: { case: "tailorGraphql", value: { appName: "core" } } },
    },
    resource: 'Application "core"',
    use: { resourceType: "application", name: "core" },
  },
  {
    label: "secret that a webhook header sends",
    field: "tailor.v1.ExecutorTargetWebhookHeader.secret_value",
    deletes: deletingApiKey,
    executor: {
      targetConfig: {
        config: {
          case: "webhook",
          value: {
            headers: [
              { key: "X-Source", value: { case: "rawValue", value: "portal" } },
              { key: "Authorization", value: { case: "secretValue", value: API_KEY } },
            ],
          },
        },
      },
    },
    resource: API_KEY_LABEL,
    use: API_KEY_USE,
  },
  {
    label: "secret that a webhook target signs with",
    field: "tailor.v1.ExecutorWebhookConfig.secret",
    deletes: deletingApiKey,
    executor: {
      targetConfig: { config: { case: "webhook", value: { secret: API_KEY } } },
    },
    resource: API_KEY_LABEL,
    use: API_KEY_USE,
  },
];

describe("assertResourcesNotInUse for executors, resolvers, and AI gateways", () => {
  test.each(EXECUTOR_USES)(
    "rejects a deleted $label in an executor outside the run",
    async ({ deletes, executor, resource, use }) => {
      const owner = withWorkspaceExecutor(
        emptyPlanResults(),
        { name: "notify", ...executor },
        "portal",
      );
      deletes(owner);

      await expect(check([deployment({ name: "core" }, owner)], "deploy")).rejects.toThrow(
        inUse(
          `${resource} cannot be deleted: executor "notify" of application "portal" still uses it.`,
          [{ ...use, application: "portal", usedBy: { resourceType: "executor", name: "notify" } }],
        ),
      );
    },
  );

  test("names no application for an executor that no application manages", async () => {
    const owner = withWorkspaceExecutor(deletingAdmin(), {
      name: "notify",
      targetConfig: FUNCTION_TARGET,
    });

    await expect(check([deployment({ name: "core" }, owner)], "deploy")).rejects.toThrow(
      expect.objectContaining({
        message: `${ADMIN} cannot be deleted: executor "notify" still uses it.`,
        suggestion: expect.stringContaining("outside the SDK"),
        context: { uses: [{ ...ADMIN_USE, usedBy: { resourceType: "executor", name: "notify" } }] },
      }),
    );
  });

  test("rejects an executor and an AI gateway of the run whose planned versions use deleted resources", async () => {
    const portal = emptyPlanResults();
    portal.executor.changeSet.creates.push({
      name: "notify",
      request: { workspaceId: "ws", executor: { name: "notify", targetConfig: FUNCTION_TARGET } },
      metaRequest: { trn: "trn" },
    });
    portal.aiGateway.changeSet.creates.push({
      name: "chat",
      request: { workspaceId: "ws", aigatewayName: "chat", authNamespace: "core-auth", cors: [] },
      metaRequest: { trn: "trn" },
    });

    await expect(
      check(
        [
          deployment({ name: "core" }, deletingAdmin(ownerDeleting("core-auth"))),
          deployment({ name: "portal" }, portal),
        ],
        "deploy",
      ),
    ).rejects.toThrow(
      inUse(
        [
          `${ADMIN} cannot be deleted: executor "notify" of application "portal" still uses it.`,
          'Auth service "core-auth" cannot be deleted: AI gateway "chat" of application "portal" still uses it.',
        ].join("\n"),
      ),
    );
  });

  test("rejects a deleted Auth service that an AI gateway outside the run uses", async () => {
    const owner = withWorkspaceGateway(ownerDeleting("core-auth"));

    await expect(check([deployment({ name: "core" }, owner)], "remove")).rejects.toThrow(
      inUse(
        'Auth service "core-auth" cannot be deleted: AI gateway "chat" of application "viewer" still uses it.',
        [
          {
            resourceType: "auth.service",
            name: "core-auth",
            application: "viewer",
            usedBy: { resourceType: "aigateway", name: "chat" },
          },
        ],
      ),
    );
  });

  test("accepts uses that the run deletes or rewrites, and a table of another namespace", async () => {
    const owner = withWorkspaceGateway(deletingAdmin(ownerDeleting("core-auth")));
    deletingOrderTable(owner);
    deletingCoreApplication(owner);
    deletingApiKey(owner);
    withWorkspaceExecutor(
      owner,
      {
        name: "notify",
        targetConfig: {
          config: { case: "tailorGraphql", value: { appName: "core", invoker: INVOKER } },
        },
      },
      "core",
    );
    withWorkspaceExecutor(owner, { name: "sync", targetConfig: FUNCTION_TARGET }, "portal");
    withWorkspaceExecutor(
      owner,
      {
        name: "forward",
        targetConfig: {
          config: {
            case: "webhook",
            value: {
              secret: API_KEY,
              headers: [{ key: "Authorization", value: { case: "secretValue", value: API_KEY } }],
            },
          },
        },
      },
      "portal",
    );
    withWorkspaceExecutor(
      owner,
      {
        name: "audit",
        triggerConfig: eventTrigger({
          case: "tailordb",
          value: { namespaceName: "other", typeName: "Order" },
        }),
      },
      "portal",
    );
    owner.executor.changeSet.deletes.push({ name: "notify", request: {} });
    for (const name of ["sync", "forward"]) {
      owner.executor.changeSet.updates.push({
        name,
        request: { workspaceId: "ws", executor: { name } },
        metaRequest: { trn: "trn" },
      });
    }
    owner.aiGateway.changeSet.deletes.push({ name: "chat", request: {} });

    await expect(check([deployment({ name: "core" }, owner)], "deploy")).resolves.toBeUndefined();
  });

  test("rejects a deleted machine user that resolvers of the run and of other namespaces use", async () => {
    const owner = deletingAdmin();
    owner.pipeline.existingResolvers = new Map([
      [
        "main",
        {
          existingResolvers: [],
          existingResolverDetails: new Map([["pay", resolverInvoking("pay")]]),
        },
      ],
    ]);
    owner.pipeline.existingServices = {
      main: { resource: {} as never, allLabels: { "sdk-name": "core" } },
      billing: { resource: {} as never, allLabels: { "sdk-name": "billing-app" } },
    };
    const listPipelineResolvers = vi.fn(async () => ({
      pipelineResolvers: [resolverInvoking("charge")],
      nextPageToken: "",
    }));

    await expect(
      check([deployment({ name: "core" }, owner)], "deploy", { listPipelineResolvers }),
    ).rejects.toThrow(
      inUse(
        [
          `${ADMIN} cannot be deleted: resolver "pay" in namespace "main" of application "core" still uses it.`,
          `${ADMIN} cannot be deleted: resolver "charge" in namespace "billing" of application "billing-app" still uses it.`,
        ].join("\n"),
        [
          {
            ...ADMIN_USE,
            application: "core",
            usedBy: { resourceType: "pipeline.resolver", namespace: "main", name: "pay" },
          },
          {
            ...ADMIN_USE,
            application: "billing-app",
            usedBy: { resourceType: "pipeline.resolver", namespace: "billing", name: "charge" },
          },
        ],
      ),
    );
    expect(listPipelineResolvers).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        workspaceId: "ws",
        namespaceName: "billing",
        pipelineResolverView: PipelineResolverView.FULL,
      }),
    );
  });

  test("lists no resolver or Auth config when the run deletes no machine user or secret", async () => {
    const owner = withWorkspaceAuth(ownerDeleting("core-auth"), "portal-auth", "portal");
    owner.pipeline.existingServices = {
      billing: { resource: {} as never, allLabels: { "sdk-name": "billing-app" } },
    };
    const client = {
      listPipelineResolvers: vi.fn(),
      listAuthIDPConfigs: vi.fn(),
      getAuthSCIMConfig: vi.fn(),
    };

    await expect(
      check([deployment({ name: "core" }, owner)], "deploy", client),
    ).resolves.toBeUndefined();
    for (const method of Object.values(client)) {
      expect(method).not.toHaveBeenCalled();
    }
  });
});

const OTHER_KEY = { vaultName: "shared", secretKey: "other-key" };

function oidcConfig(clientSecretKey: typeof API_KEY) {
  return create(AuthIDPConfigSchema, {
    name: "oidc",
    authType: AuthIDPConfig_AuthType.OIDC,
    config: {
      config: {
        case: "oidc",
        value: { clientIdKey: "client", clientSecretKey, providerUrl: "https://idp.example.com" },
      },
    },
  });
}

function bearerSCIMConfig(bearerSecret: typeof API_KEY) {
  return create(AuthSCIMConfigSchema, {
    machineUserName: "admin",
    authorizationType: AuthSCIMConfig_AuthorizationType.BEARER,
    authorizationConfig: { case: "bearerSecret", value: bearerSecret },
  });
}

function withWorkspaceAuth(results: PlanResults, namespace: string, application?: string) {
  results.auth.existingServices[namespace] = {
    resource: {} as never,
    allLabels: application ? { "sdk-name": application } : {},
  };
  return results;
}

type WorkspaceAuthConfigs = {
  idpConfigs?: Record<string, ReturnType<typeof oidcConfig>[]>;
  scimConfigs?: Record<string, ReturnType<typeof bearerSCIMConfig>>;
};

function authClient(configs: WorkspaceAuthConfigs) {
  return {
    listAuthIDPConfigs: vi.fn(async ({ namespaceName }: { namespaceName: string }) => ({
      idpConfigs: configs.idpConfigs?.[namespaceName] ?? [],
      nextPageToken: "",
    })),
    getAuthSCIMConfig: vi.fn(async ({ namespaceName }: { namespaceName: string }) => {
      const scimConfig = configs.scimConfigs?.[namespaceName];
      if (!scimConfig) throw new ConnectError("not found", Code.NotFound);
      return { scimConfig };
    }),
  };
}

const AUTH_CONFIG_USERS = [
  {
    label: "OIDC IdP config",
    field: "tailor.v1.AuthIDPConfig.OIDCConfig.client_secret_key",
    configs: { idpConfigs: { "portal-auth": [oidcConfig(API_KEY)] } },
    user: 'IdP config "oidc" of Auth service "portal-auth"',
    usedBy: { resourceType: "auth.idp_config", namespace: "portal-auth", name: "oidc" },
  },
  {
    label: "SCIM config",
    field: "tailor.v1.AuthSCIMConfig.bearer_secret",
    configs: { scimConfigs: { "portal-auth": bearerSCIMConfig(API_KEY) } },
    user: 'SCIM config of Auth service "portal-auth"',
    usedBy: {
      resourceType: "auth.scim",
      namespace: "portal-auth",
      name: "portal-auth-scim-config",
    },
  },
];

describe("assertResourcesNotInUse for Auth IdP and SCIM configs", () => {
  test.each(AUTH_CONFIG_USERS)(
    "rejects a deleted secret that the $label of an Auth service outside the run names",
    async ({ configs, user, usedBy }) => {
      const owner = withWorkspaceAuth(deletingApiKey(), "portal-auth", "portal");

      await expect(
        check([deployment({ name: "core" }, owner)], "remove", authClient(configs)),
      ).rejects.toThrow(
        inUse(
          `${API_KEY_LABEL} cannot be deleted: ${user} of application "portal" still uses it.`,
          [{ ...API_KEY_USE, application: "portal", usedBy }],
        ),
      );
    },
  );

  test("names no application for an Auth service that no application manages", async () => {
    const owner = withWorkspaceAuth(deletingApiKey(), "portal-auth");
    const client = authClient({ idpConfigs: { "portal-auth": [oidcConfig(API_KEY)] } });

    await expect(check([deployment({ name: "core" }, owner)], "deploy", client)).rejects.toThrow(
      expect.objectContaining({
        message: `${API_KEY_LABEL} cannot be deleted: IdP config "oidc" of Auth service "portal-auth" still uses it.`,
        suggestion: expect.stringContaining("Auth service listed without an application"),
      }),
    );
  });

  test("rejects a deleted secret that Auth configs the run writes name", async () => {
    const portal = emptyPlanResults();
    portal.auth.changeSet.idpConfig.creates.push({
      name: "oidc",
      idpConfig: {} as never,
      request: { workspaceId: "ws", namespaceName: "portal-auth", idpConfig: oidcConfig(API_KEY) },
    });
    portal.auth.changeSet.scim.updates.push({
      name: "portal-auth-scim-config",
      request: {
        workspaceId: "ws",
        namespaceName: "portal-auth",
        scimConfig: bearerSCIMConfig(API_KEY),
      },
    });

    await expect(
      check(
        [deployment({ name: "core" }, deletingApiKey()), deployment({ name: "portal" }, portal)],
        "deploy",
      ),
    ).rejects.toThrow(
      inUse(
        [
          `${API_KEY_LABEL} cannot be deleted: IdP config "oidc" of Auth service "portal-auth" of application "portal" still uses it.`,
          `${API_KEY_LABEL} cannot be deleted: SCIM config of Auth service "portal-auth" of application "portal" still uses it.`,
        ].join("\n"),
      ),
    );
  });

  test("accepts Auth configs that the run rewrites or deletes, or that name no deleted secret", async () => {
    const owner = withWorkspaceAuth(
      withWorkspaceAuth(
        withWorkspaceAuth(ownerDeleting("legacy-auth", deletingApiKey()), "portal-auth", "portal"),
        "admin-auth",
        "admin",
      ),
      "legacy-auth",
      "core",
    );
    owner.auth.changeSet.idpConfig.updates.push({
      name: "oidc",
      idpConfig: {} as never,
      request: {
        workspaceId: "ws",
        namespaceName: "portal-auth",
        idpConfig: oidcConfig(OTHER_KEY),
      },
    });
    owner.auth.changeSet.idpConfig.creates.push({
      name: "builtin",
      idpConfig: {} as never,
      request: {
        workspaceId: "ws",
        namespaceName: "admin-auth",
        idpConfig: { name: "builtin", authType: AuthIDPConfig_AuthType.OIDC, config: {} },
      },
    });
    owner.auth.changeSet.scim.deletes.push({
      name: "portal-auth-scim-config",
      request: { workspaceId: "ws", namespaceName: "portal-auth" },
    });
    owner.auth.changeSet.scim.updates.push({
      name: "admin-auth-scim-config",
      request: {
        workspaceId: "ws",
        namespaceName: "admin-auth",
        scimConfig: {
          machineUserName: "admin",
          authorizationType: AuthSCIMConfig_AuthorizationType.OAUTH2,
          authorizationConfig: { case: "bearerSecret", value: {} },
        },
      },
    });
    const client = authClient({
      idpConfigs: {
        "portal-auth": [oidcConfig(API_KEY)],
        "admin-auth": [oidcConfig(OTHER_KEY)],
        "legacy-auth": [oidcConfig(API_KEY)],
      },
      scimConfigs: {
        "portal-auth": bearerSCIMConfig(API_KEY),
        "admin-auth": bearerSCIMConfig(API_KEY),
        "legacy-auth": bearerSCIMConfig(API_KEY),
      },
    });

    await expect(
      check([deployment({ name: "core" }, owner)], "deploy", client),
    ).resolves.toBeUndefined();
    expect(
      client.listAuthIDPConfigs.mock.calls.map(([{ namespaceName }]) => namespaceName),
    ).toEqual(["portal-auth", "admin-auth"]);
  });
});

/**
 * Every field of a stored Platform resource that names an application, a Secret Manager secret,
 * or a machine user, as `<message>.<field>`.
 * @returns Reference fields of the messages the operator service's files define
 */
function referenceFields(): string[] {
  const files = new Map<string, DescFile>();
  const collect = (file: DescFile) => {
    if (files.has(file.name)) return;
    files.set(file.name, file);
    file.dependencies.forEach(collect);
  };
  collect(file_tailor_v1_service);
  const topLevel = (message: DescMessage): DescMessage =>
    message.parent ? topLevel(message.parent) : message;
  const referenceTypes = new Set(["tailor.v1.AuthInvoker", "tailor.v1.SecretValue"]);
  const referenceNames = new Set(["app_name", "application_name", "machine_user_name"]);
  return [...files.values()].flatMap((file) =>
    [...nestedTypes(file)]
      .filter((desc): desc is DescMessage => desc.kind === "message")
      .filter(
        (message) =>
          !/(Request|Response)$/.test(topLevel(message).name) &&
          !referenceTypes.has(message.typeName),
      )
      .flatMap((message) =>
        message.fields
          .filter(
            (field) =>
              referenceTypes.has(field.message?.typeName ?? "") || referenceNames.has(field.name),
          )
          .map((field) => `${message.typeName}.${field.name}`),
      ),
  );
}

describe("assertResourcesNotInUse coverage of Platform resource references", () => {
  test("every field that names an application, secret, or machine user is checked or explicitly not checked", () => {
    const CHECKED = new Set([
      ...EXECUTOR_USES.flatMap(({ field }) => (field ? [field] : [])),
      ...AUTH_CONFIG_USERS.map(({ field }) => field),
      // "rejects a deleted machine user that resolvers of the run and of other namespaces use"
      "tailor.v1.PipelineResolver.Pipeline.invoker",
    ]);
    const NOT_CHECKED = new Set([
      // a machine user of the hook's own Auth service, which its defineAuth must declare
      "tailor.v1.AuthHook.invoker",
      // not checked yet: the guard reads a SCIM config for its bearer secret only
      "tailor.v1.AuthSCIMConfig.machine_user_name",
      // telemetry routers are set up outside the SDK, which never lists them
      "tailor.v1.OTLPExporterApiKeyAuth.secret_value",
      "tailor.v1.OTLPExporterBearerTokenAuth.secret_value",
    ]);

    const fields = referenceFields();

    expect(fields).toContain("tailor.v1.ExecutorTargetTailorGraphqlConfig.app_name");
    expect(fields.filter((field) => !CHECKED.has(field) && !NOT_CHECKED.has(field))).toEqual([]);
    expect([...CHECKED, ...NOT_CHECKED].filter((field) => !fields.includes(field))).toEqual([]);
  });
});
