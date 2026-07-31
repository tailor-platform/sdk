import { getOrNull } from "#/cli/shared/client";
import { eventSourceLabel } from "#/cli/shared/publish-events";
import {
  type DependencyScope,
  eventSourceKey,
  recordedDependencies,
  resolverTrn,
  resourceTrn,
  tailorDBTypeTrn,
} from "./label";
import type { Application } from "#/cli/services/application";
import type { OperatorClient } from "#/cli/shared/client";
import type { MissingDependentApp } from "./confirm";

/** One value this run would recompute, and where its records live. */
type RecomputedResource = {
  /** TRN carrying the dependency records. */
  trn: string;
  /** Key the run's own subscriptions are recorded under. */
  key: string;
  /** Which of the resource's values this entry concerns. */
  scope: DependencyScope;
  /** How it is named in the confirmation, e.g. `Workflow "nightly"`. */
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
 * @param jobsByWorkflow - Job names each workflow runs, keyed by its main job
 * @param subscribedKeys - Resources this run subscribes to, by resource key
 * @returns One entry per value that leaves `publishEvents` unset
 */
function recomputedResources(
  workspaceId: string,
  application: Readonly<Application>,
  jobsByWorkflow: Record<string, string[]>,
  subscribedKeys: ReadonlySet<string>,
): RecomputedResource[] {
  const resources: RecomputedResource[] = [];

  for (const service of application.tailorDBServices) {
    for (const [typeName, type] of Object.entries(service.types)) {
      if (type.settings.publishEvents === undefined) {
        resources.push({
          trn: tailorDBTypeTrn(workspaceId, service.namespace, typeName),
          key: eventSourceKey.tailorDBType(service.namespace, typeName),
          scope: "resource",
          label: eventSourceLabel.tailorDBType(typeName),
        });
      }
    }
  }

  for (const service of application.resolverServices) {
    for (const resolver of Object.values(service.resolvers)) {
      if (resolver.publishEvents === undefined) {
        resources.push({
          trn: resolverTrn(workspaceId, service.namespace, resolver.name),
          key: eventSourceKey.resolver(service.namespace, resolver.name),
          scope: "resource",
          label: eventSourceLabel.resolver(resolver.name),
        });
      }
    }
  }

  for (const idp of application.idpServices) {
    if (idp.publishEvents === undefined) {
      resources.push({
        trn: resourceTrn(workspaceId, "idp", idp.name),
        key: eventSourceKey.idp(idp.name),
        scope: "resource",
        label: eventSourceLabel.idpService(idp.name),
      });
    }
  }

  // A workflow carries two values: its own execution events and the ones its jobs
  // publish. Different triggers drive them, so each is asked about on its own —
  // a subscriber of one must not answer for the other.
  const explicitByJob = new Map(
    (application.workflowService?.jobs ?? []).map((job) => [job.name, job.publishEvents]),
  );
  const subscribedJobNames = new Set(
    Object.values(application.workflowService?.workflows ?? {})
      .filter((workflow) => subscribedKeys.has(eventSourceKey.workflowJobs(workflow.name)))
      .flatMap((workflow) => jobsByWorkflow[workflow.mainJob.name] ?? []),
  );
  for (const workflow of Object.values(application.workflowService?.workflows ?? {})) {
    const trn = resourceTrn(workspaceId, "workflow", workflow.name);
    if (workflow.publishEvents === undefined) {
      resources.push({
        trn,
        key: eventSourceKey.workflow(workflow.name),
        scope: "resource",
        label: eventSourceLabel.workflow(workflow.name),
      });
    }
    // Only the jobs this workflow runs decide whether its job records matter, and
    // a job stays on while any subscribed workflow in the run also runs it — job
    // values are resolved per job name, not per workflow. Asking across every job
    // in the config, or ignoring a peer workflow's subscription, prompts about
    // publishing the run does not turn off.
    const jobNames = jobsByWorkflow[workflow.mainJob.name] ?? [];
    if (
      jobNames.some(
        (jobName) => explicitByJob.get(jobName) === undefined && !subscribedJobNames.has(jobName),
      )
    ) {
      resources.push({
        trn,
        key: eventSourceKey.workflowJobs(workflow.name),
        scope: "jobs",
        label: eventSourceLabel.workflowJobs(workflow.name),
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
 *
 * A resource this run still subscribes to is skipped: its value resolves to `true`
 * from the run's own executors, so the absent config changes nothing about it and
 * asking would be asking about something that cannot happen. What is left over is
 * a resource that really does turn off.
 * @param params - Client, workspace, application, and the run's inputs
 * @param params.client - Operator client instance
 * @param params.workspaceId - Workspace being deployed to
 * @param params.application - Application being planned
 * @param params.runAppIds - Stable ids of every application in the run
 * @param params.subscribedKeys - Resources this run subscribes to, by resource key
 * @param params.jobsByWorkflow - Job names each workflow runs, keyed by its main job
 * @returns Recorded dependencies missing from the run
 */
export async function fetchMissingDependentApps(params: {
  client: OperatorClient;
  workspaceId: string;
  application: Readonly<Application>;
  runAppIds: ReadonlySet<string>;
  subscribedKeys: ReadonlySet<string>;
  jobsByWorkflow: Record<string, string[]>;
}): Promise<MissingDependentApp[]> {
  const { client, workspaceId, application, runAppIds, subscribedKeys, jobsByWorkflow } = params;
  const found = await Promise.all(
    recomputedResources(workspaceId, application, jobsByWorkflow, subscribedKeys)
      .filter(({ key }) => !subscribedKeys.has(key))
      .map(async ({ trn, scope, label }) => {
        const metadata = await getOrNull(() => client.getMetadata({ trn }));
        return recordedDependencies(metadata?.metadata?.labels, scope)
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
