import { Subgraph_ServiceType } from "@tailor-platform/tailor-proto/application_resource_pb";
import { getApplicationAuthNamespace } from "#/cli/shared/auth-namespace";
import { CLIError } from "#/cli/shared/errors";
import { protoSubgraph } from "./application";
import type { PlannedDeployment } from "./apply-phases";
import type { ManagedResourceType } from "./managed-resource-type";

type ServiceDeletePlan = Pick<
  PlannedDeployment,
  "application" | "app" | "auth" | "tailorDB" | "pipeline"
>;

type CheckedService = {
  label: string;
  deletesOf: (plan: ServiceDeletePlan) => ReadonlyArray<{ name: string }>;
};

const CHECKED_SERVICES = {
  "auth.service": {
    label: "Auth service",
    deletesOf: (plan) => plan.auth.changeSet.service.deletes,
  },
  "tailordb.service": {
    label: "TailorDB namespace",
    deletesOf: (plan) => plan.tailorDB.changeSet.service.deletes,
  },
  "pipeline.service": {
    label: "Resolver namespace",
    deletesOf: (plan) => plan.pipeline.changeSet.service.deletes,
  },
} satisfies Partial<Record<ManagedResourceType, CheckedService>>;

type CheckedResourceType = keyof typeof CHECKED_SERVICES;

const SUBGRAPH_RESOURCE_TYPES = new Map<Subgraph_ServiceType, CheckedResourceType>([
  [Subgraph_ServiceType.TAILORDB, "tailordb.service"],
  [Subgraph_ServiceType.PIPELINE, "pipeline.service"],
]);

type ServiceRef = { resourceType: CheckedResourceType; name: string };

type ServiceUse = ServiceRef & { application: string };

type ServiceDeletingCommand = "deploy" | "remove";

const IN_USE_SUGGESTIONS: Record<ServiceDeletingCommand, string> = {
  deploy:
    "Keep each listed service in the config that defines it, or deploy the applications that use it without that service, first or in the same run.",
  remove:
    "Remove the applications that use each listed service, or deploy them without that service, then run remove again.",
};

function servicesOf(
  authNamespace: string | undefined,
  subgraphs: ReadonlyArray<ReturnType<typeof protoSubgraph>>,
): ServiceRef[] {
  const auth: ServiceRef[] = authNamespace
    ? [{ resourceType: "auth.service", name: authNamespace }]
    : [];
  const subgraphServices = subgraphs.flatMap(({ serviceType, serviceNamespace }) => {
    const resourceType = SUBGRAPH_RESOURCE_TYPES.get(serviceType);
    return resourceType ? [{ resourceType, name: serviceNamespace }] : [];
  });
  return [...auth, ...subgraphServices];
}

function serviceUses(deployments: ReadonlyArray<ServiceDeletePlan>): ServiceUse[] {
  const written = new Set(
    deployments.flatMap(({ app }) =>
      [...app.creates, ...app.updates, ...app.unchanged].map((entry) => entry.name),
    ),
  );
  const deletedNames = new Set(
    deployments.flatMap(({ app }) => app.deletes.map((entry) => entry.name)),
  );
  const writtenUses = deployments.flatMap(({ application }) =>
    written.has(application.name)
      ? servicesOf(
          getApplicationAuthNamespace(application),
          application.subgraphs.map(protoSubgraph),
        ).map((service) => ({ ...service, application: application.name }))
      : [],
  );
  const recorded = new Map(
    deployments
      .flatMap(({ app }) => app.existingApplications)
      .map((existing) => [existing.name, existing]),
  );
  const recordedUses = [...recorded.values()]
    .filter((existing) => !written.has(existing.name) && !deletedNames.has(existing.name))
    .flatMap((existing) =>
      servicesOf(existing.authNamespace, existing.subgraphs).map((service) => ({
        ...service,
        application: existing.name,
      })),
    );
  return [...writtenUses, ...recordedUses];
}

/**
 * Reject a run that deletes an Auth service, TailorDB namespace, or resolver namespace an
 * application still uses.
 * An application the plan writes counts by the services its config names, any other by the ones
 * the workspace records. When the run spans several configs, call it after deletes that another
 * config in the run still claims are dropped and deletes of renamed applications are scheduled.
 * @param deployments - Planned deployments of a deploy run, or the plan of a removal
 * @param command - Command whose run deletes the services
 */
export function assertServicesNotInUse(
  deployments: ReadonlyArray<ServiceDeletePlan>,
  command: ServiceDeletingCommand,
): void {
  const isDeleted = (service: ServiceRef) =>
    deployments.some((plan) =>
      CHECKED_SERVICES[service.resourceType]
        .deletesOf(plan)
        .some((entry) => entry.name === service.name),
    );
  const uses = serviceUses(deployments).filter(isDeleted);
  if (uses.length === 0) return;
  throw CLIError({
    code: "SERVICE_IN_USE",
    message: uses
      .map(
        (use) =>
          `${CHECKED_SERVICES[use.resourceType].label} "${use.name}" cannot be deleted: application "${use.application}" still uses it.`,
      )
      .join("\n"),
    suggestion: IN_USE_SUGGESTIONS[command],
    context: { uses },
  });
}
