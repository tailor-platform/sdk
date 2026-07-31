import { getOrNull } from "#/cli/shared/client";
import { recordedDependencies, resolverTrn, resourceTrn, tailorDBTypeTrn } from "./label";
import type { Application } from "#/cli/services/application";
import type { OperatorClient } from "#/cli/shared/client";
import type { MissingDependentApp } from "./confirm";

/** One resource whose `publishEvents` this run would recompute. */
type RecomputedResource = {
  /** TRN carrying the resource's dependency records. */
  trn: string;
  /** How the resource is named in the confirmation, e.g. `Workflow "nightly"`. */
  label: string;
};

/**
 * List the resources whose `publishEvents` this run recomputes.
 *
 * A resource that declares the value keeps it whatever the run covers, so no
 * absent config can change it and its records cannot matter. Skipping those is
 * what keeps a declared value from prompting forever.
 * @param workspaceId - Workspace being deployed to
 * @param application - Application whose resources are listed
 * @returns One entry per resource that leaves `publishEvents` unset
 */
function recomputedResources(
  workspaceId: string,
  application: Readonly<Application>,
): RecomputedResource[] {
  const resources: RecomputedResource[] = [];

  for (const service of application.tailorDBServices) {
    for (const [typeName, type] of Object.entries(service.types)) {
      if (type.settings.publishEvents === undefined) {
        resources.push({
          trn: tailorDBTypeTrn(workspaceId, service.namespace, typeName),
          label: `TailorDB type "${typeName}"`,
        });
      }
    }
  }

  for (const service of application.resolverServices) {
    for (const resolver of Object.values(service.resolvers)) {
      if (resolver.publishEvents === undefined) {
        resources.push({
          trn: resolverTrn(workspaceId, service.namespace, resolver.name),
          label: `Resolver "${resolver.name}"`,
        });
      }
    }
  }

  for (const idp of application.idpServices) {
    if (idp.publishEvents === undefined) {
      resources.push({
        trn: resourceTrn(workspaceId, "idp", idp.name),
        label: `IdP service "${idp.name}"`,
      });
    }
  }

  // A workflowJobExecution trigger records on the workflow, so a workflow that
  // pins its own value still carries records for jobs that leave theirs unset.
  const jobs = application.workflowService?.jobs ?? [];
  const anyJobRecomputed = jobs.some((job) => job.publishEvents === undefined);
  for (const workflow of Object.values(application.workflowService?.workflows ?? {})) {
    if (workflow.publishEvents === undefined || anyJobRecomputed) {
      resources.push({
        trn: resourceTrn(workspaceId, "workflow", workflow.name),
        label: `Workflow "${workflow.name}"`,
      });
    }
  }

  return resources;
}

/**
 * Read the applications recorded as depending on this config's resources but
 * absent from the current deploy.
 *
 * Records live on the resources rather than on the application, so this survives
 * the application being renamed and stops reporting a resource that is gone.
 * @param params - Client, workspace, application, and the run's app ids
 * @param params.client - Operator client instance
 * @param params.workspaceId - Workspace being deployed to
 * @param params.application - Application being planned
 * @param params.runAppIds - Stable ids of every application in the run
 * @returns Recorded dependencies missing from the run
 */
export async function fetchMissingDependentApps(params: {
  client: OperatorClient;
  workspaceId: string;
  application: Readonly<Application>;
  runAppIds: ReadonlySet<string>;
}): Promise<MissingDependentApp[]> {
  const { client, workspaceId, application, runAppIds } = params;
  const found = await Promise.all(
    recomputedResources(workspaceId, application).map(async ({ trn, label }) => {
      const metadata = await getOrNull(() => client.getMetadata({ trn }));
      return recordedDependencies(metadata?.metadata?.labels)
        .filter((dependency) => !runAppIds.has(dependency.appId))
        .map((dependency) => ({
          resource: label,
          appId: dependency.appId,
          reason: dependency.reason,
        }));
    }),
  );
  return found.flat();
}
