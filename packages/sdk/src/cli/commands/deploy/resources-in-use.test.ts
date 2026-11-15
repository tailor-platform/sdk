import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { AIGatewaySchema } from "@tailor-platform/tailor-proto/aigateway_resource_pb";
import { Subgraph_ServiceType } from "@tailor-platform/tailor-proto/application_resource_pb";
import { ExecutorExecutorSchema } from "@tailor-platform/tailor-proto/executor_resource_pb";
import { PipelineResolverView } from "@tailor-platform/tailor-proto/pipeline_pb";
import { PipelineResolverSchema } from "@tailor-platform/tailor-proto/pipeline_resource_pb";
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

function ownerDeleting(authNamespace: string) {
  const results = emptyPlanResults();
  results.auth.changeSet.service.deletes.push({ name: authNamespace } as never);
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

const INVOKER = { namespace: "core-auth", machineUserName: "admin" };

const INVOKER_TARGETS: Array<{ kind: string; targetConfig: ExecutorInit["targetConfig"] }> = [
  { kind: "function", targetConfig: { config: { case: "function", value: { invoker: INVOKER } } } },
  {
    kind: "tailorGraphql",
    targetConfig: { config: { case: "tailorGraphql", value: { invoker: INVOKER } } },
  },
  {
    kind: "workflow",
    targetConfig: {
      config: { case: "workflow", value: { workflowName: "sync", invoker: INVOKER } },
    },
  },
];

function withWorkspaceExecutor(results: PlanResults, executor: ExecutorInit, application?: string) {
  results.executor.existingExecutors[executor.name!] = {
    resource: create(ExecutorExecutorSchema, executor),
    allLabels: application ? { "sdk-name": application } : {},
  };
  return results;
}

function deletingMachineUser() {
  const results = emptyPlanResults();
  results.auth.changeSet.machineUser.deletes.push({
    name: "admin",
    request: { workspaceId: "ws", authNamespace: "core-auth", name: "admin" },
  });
  return results;
}

function resolverInvoking(name: string) {
  return create(PipelineResolverSchema, { name, pipelines: [{ name: "step", invoker: INVOKER }] });
}

describe("assertResourcesNotInUse for machine users used as invoker", () => {
  test.each(INVOKER_TARGETS)(
    "rejects a deleted machine user that a $kind executor outside the run uses as invoker",
    async ({ targetConfig }) => {
      const owner = withWorkspaceExecutor(
        deletingMachineUser(),
        { name: "notify", targetConfig },
        "portal",
      );

      await expect(check([deployment({ name: "core" }, owner)], "deploy")).rejects.toThrow(
        expect.objectContaining({
          code: "SERVICE_IN_USE",
          message:
            'Machine user "admin" of Auth service "core-auth" cannot be deleted: executor "notify" of application "portal" still uses it.',
          context: {
            uses: [
              {
                resourceType: "auth.machine_user",
                namespace: "core-auth",
                name: "admin",
                application: "portal",
                usedBy: { resourceType: "executor", name: "notify" },
              },
            ],
          },
        }),
      );
    },
  );

  test("rejects an executor of the run whose planned invoker is a deleted machine user", async () => {
    const owner = deletingMachineUser();
    const portal = emptyPlanResults();
    portal.executor.changeSet.creates.push({
      name: "notify",
      request: {
        workspaceId: "ws",
        executor: { name: "notify", targetConfig: INVOKER_TARGETS[0]!.targetConfig },
      },
      metaRequest: { trn: "trn" },
    });

    await expect(
      check(
        [deployment({ name: "core" }, owner), deployment({ name: "portal" }, portal)],
        "deploy",
      ),
    ).rejects.toThrow(
      expect.objectContaining({
        message:
          'Machine user "admin" of Auth service "core-auth" cannot be deleted: executor "notify" of application "portal" still uses it.',
      }),
    );
  });

  test("accepts executors that the run deletes or rewrites without the invoker", async () => {
    const owner = deletingMachineUser();
    for (const name of ["notify", "sync"]) {
      withWorkspaceExecutor(
        owner,
        { name, targetConfig: INVOKER_TARGETS[0]!.targetConfig },
        "portal",
      );
    }
    owner.executor.changeSet.deletes.push({ name: "notify", request: {} });
    owner.executor.changeSet.updates.push({
      name: "sync",
      request: { workspaceId: "ws", executor: { name: "sync" } },
      metaRequest: { trn: "trn" },
    });

    await expect(check([deployment({ name: "core" }, owner)], "deploy")).resolves.toBeUndefined();
  });

  test("rejects a deleted machine user that a resolver in another namespace uses, read in full", async () => {
    const owner = deletingMachineUser();
    owner.pipeline.existingServices = {
      billing: { resource: {} as never, allLabels: { "sdk-name": "billing-app" } },
    };
    const listPipelineResolvers = vi.fn(async () => ({
      pipelineResolvers: [resolverInvoking("charge")],
      nextPageToken: "",
    }));

    await expect(
      check([deployment({ name: "core" }, owner)], "deploy", { listPipelineResolvers }),
    ).rejects.toThrow(
      expect.objectContaining({
        message:
          'Machine user "admin" of Auth service "core-auth" cannot be deleted: resolver "charge" in namespace "billing" of application "billing-app" still uses it.',
        context: {
          uses: [
            {
              resourceType: "auth.machine_user",
              namespace: "core-auth",
              name: "admin",
              application: "billing-app",
              usedBy: { resourceType: "pipeline.resolver", namespace: "billing", name: "charge" },
            },
          ],
        },
      }),
    );
    expect(listPipelineResolvers).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws",
        namespaceName: "billing",
        pipelineResolverView: PipelineResolverView.FULL,
      }),
    );
  });

  test("rejects a deleted machine user that a resolver the run keeps uses", async () => {
    const owner = deletingMachineUser();
    owner.pipeline.existingResolvers = new Map([
      [
        "main",
        {
          existingResolvers: [],
          existingResolverDetails: new Map([["charge", resolverInvoking("charge")]]),
        },
      ],
    ]);

    await expect(check([deployment({ name: "core" }, owner)], "deploy")).rejects.toThrow(
      expect.objectContaining({
        message:
          'Machine user "admin" of Auth service "core-auth" cannot be deleted: resolver "charge" in namespace "main" of application "core" still uses it.',
      }),
    );
  });

  test("lists no resolver when the run deletes no machine user", async () => {
    const owner = ownerDeleting("core-auth");
    owner.pipeline.existingServices = {
      billing: { resource: {} as never, allLabels: { "sdk-name": "billing-app" } },
    };
    const listPipelineResolvers = vi.fn();

    await expect(
      check([deployment({ name: "core" }, owner)], "deploy", { listPipelineResolvers }),
    ).resolves.toBeUndefined();
    expect(listPipelineResolvers).not.toHaveBeenCalled();
  });

  test("names no application for an executor that no application manages", async () => {
    const owner = withWorkspaceExecutor(deletingMachineUser(), {
      name: "notify",
      targetConfig: INVOKER_TARGETS[0]!.targetConfig,
    });

    await expect(check([deployment({ name: "core" }, owner)], "deploy")).rejects.toThrow(
      expect.objectContaining({
        message:
          'Machine user "admin" of Auth service "core-auth" cannot be deleted: executor "notify" still uses it.',
        suggestion: expect.stringContaining("outside the SDK"),
        context: {
          uses: [
            {
              resourceType: "auth.machine_user",
              namespace: "core-auth",
              name: "admin",
              usedBy: { resourceType: "executor", name: "notify" },
            },
          ],
        },
      }),
    );
  });
});

describe("assertResourcesNotInUse for Auth services used by AI gateways", () => {
  function withWorkspaceGateway(results: PlanResults) {
    results.aiGateway.existingGateways = {
      chat: {
        resource: create(AIGatewaySchema, { name: "chat", authNamespace: "core-auth" }),
        allLabels: { "sdk-name": "viewer" },
      },
    };
    return results;
  }

  test("rejects a deleted Auth service that an AI gateway outside the run uses", async () => {
    const owner = withWorkspaceGateway(ownerDeleting("core-auth"));

    await expect(check([deployment({ name: "core" }, owner)], "remove")).rejects.toThrow(
      expect.objectContaining({
        message:
          'Auth service "core-auth" cannot be deleted: AI gateway "chat" of application "viewer" still uses it.',
        context: {
          uses: [
            {
              resourceType: "auth.service",
              name: "core-auth",
              application: "viewer",
              usedBy: { resourceType: "aigateway", name: "chat" },
            },
          ],
        },
      }),
    );
  });

  test("accepts an AI gateway that the run deletes", async () => {
    const owner = withWorkspaceGateway(ownerDeleting("core-auth"));
    owner.aiGateway.changeSet.deletes.push({ name: "chat", request: {} });

    await expect(check([deployment({ name: "core" }, owner)], "deploy")).resolves.toBeUndefined();
  });

  test("rejects an AI gateway of the run whose planned Auth service is deleted", async () => {
    const viewer = emptyPlanResults();
    viewer.aiGateway.changeSet.creates.push({
      name: "chat",
      request: { workspaceId: "ws", aigatewayName: "chat", authNamespace: "core-auth", cors: [] },
      metaRequest: { trn: "trn" },
    });

    await expect(
      check(
        [
          deployment({ name: "core" }, ownerDeleting("core-auth")),
          deployment({ name: "viewer" }, viewer),
        ],
        "deploy",
      ),
    ).rejects.toThrow(
      expect.objectContaining({
        message:
          'Auth service "core-auth" cannot be deleted: AI gateway "chat" of application "viewer" still uses it.',
      }),
    );
  });
});

const EVENT_SOURCES: Array<{
  label: string;
  deletes: (results: PlanResults) => void;
  executor: ExecutorInit;
  message: string;
  use: { resourceType: string; namespace?: string; name: string };
}> = [
  {
    label: "workflow used by the execution trigger",
    deletes: (results) =>
      results.workflow.changeSet.deletes.push({
        name: "order-flow",
        workspaceId: "ws",
        workflowId: "id",
        usedJobNames: [],
      }),
    executor: {
      triggerConfig: {
        config: {
          case: "event",
          value: { typedConfig: { case: "workflow", value: { workflowName: "order-flow" } } },
        },
      },
    },
    message: 'Workflow "order-flow"',
    use: { resourceType: "workflow", name: "order-flow" },
  },
  {
    label: "workflow used by the workflow target",
    deletes: (results) =>
      results.workflow.changeSet.deletes.push({
        name: "order-flow",
        workspaceId: "ws",
        workflowId: "id",
        usedJobNames: [],
      }),
    executor: {
      targetConfig: { config: { case: "workflow", value: { workflowName: "order-flow" } } },
    },
    message: 'Workflow "order-flow"',
    use: { resourceType: "workflow", name: "order-flow" },
  },
  {
    label: "TailorDB table used by the record trigger",
    deletes: (results) =>
      results.tailorDB.changeSet.type.deletes.push({
        name: "Order",
        request: { workspaceId: "ws", namespaceName: "main", tailordbTypeName: "Order" },
      }),
    executor: {
      triggerConfig: {
        config: {
          case: "event",
          value: {
            typedConfig: { case: "tailordb", value: { namespaceName: "main", typeName: "Order" } },
          },
        },
      },
    },
    message: 'TailorDB table "Order" in namespace "main"',
    use: { resourceType: "tailordb.type", namespace: "main", name: "Order" },
  },
  {
    label: "resolver used by the resolver trigger",
    deletes: (results) =>
      results.pipeline.changeSet.resolver.deletes.push({
        name: "createOrder",
        request: { workspaceId: "ws", namespaceName: "main", resolverName: "createOrder" },
      }),
    executor: {
      triggerConfig: {
        config: {
          case: "event",
          value: {
            typedConfig: {
              case: "pipeline",
              value: { namespaceName: "main", resolverName: "createOrder" },
            },
          },
        },
      },
    },
    message: 'Resolver "createOrder" in namespace "main"',
    use: { resourceType: "pipeline.resolver", namespace: "main", name: "createOrder" },
  },
  {
    label: "IdP used by the IdP user trigger",
    deletes: (results) =>
      results.idp.changeSet.service.deletes.push({ name: "main-idp", request: {} }),
    executor: {
      triggerConfig: {
        config: {
          case: "event",
          value: { typedConfig: { case: "idp", value: { namespaceName: "main-idp" } } },
        },
      },
    },
    message: 'IdP service "main-idp"',
    use: { resourceType: "idp.service", name: "main-idp" },
  },
];

describe("assertResourcesNotInUse for event sources and workflows that executors use", () => {
  test.each(EVENT_SOURCES)(
    "rejects a deleted $label of an executor outside the run",
    async ({ deletes, executor, message, use }) => {
      const owner = withWorkspaceExecutor(
        emptyPlanResults(),
        { name: "notify", ...executor },
        "portal",
      );
      deletes(owner);

      await expect(check([deployment({ name: "core" }, owner)], "deploy")).rejects.toThrow(
        expect.objectContaining({
          code: "SERVICE_IN_USE",
          message: `${message} cannot be deleted: executor "notify" of application "portal" still uses it.`,
          context: {
            uses: [
              {
                ...use,
                application: "portal",
                usedBy: { resourceType: "executor", name: "notify" },
              },
            ],
          },
        }),
      );
    },
  );

  test("counts a disabled executor", async () => {
    const [workflowTrigger] = EVENT_SOURCES;
    const owner = withWorkspaceExecutor(
      emptyPlanResults(),
      { name: "notify", disabled: true, ...workflowTrigger!.executor },
      "portal",
    );
    workflowTrigger!.deletes(owner);

    await expect(check([deployment({ name: "core" }, owner)], "deploy")).rejects.toThrow(
      expect.objectContaining({ code: "SERVICE_IN_USE" }),
    );
  });

  test("matches a TailorDB table only in its own namespace", async () => {
    const tableTrigger = EVENT_SOURCES[2]!;
    const owner = withWorkspaceExecutor(
      emptyPlanResults(),
      {
        name: "notify",
        triggerConfig: {
          config: {
            case: "event",
            value: {
              typedConfig: {
                case: "tailordb",
                value: { namespaceName: "other", typeName: "Order" },
              },
            },
          },
        },
      },
      "portal",
    );
    tableTrigger.deletes(owner);

    await expect(check([deployment({ name: "core" }, owner)], "deploy")).resolves.toBeUndefined();
  });
});
