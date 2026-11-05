import { PipelineResolverView } from "@tailor-platform/tailor-proto/pipeline_pb";
import { fetchAllTolerant, type OperatorClient } from "#/cli/shared/client";
import { CLIError } from "#/cli/shared/errors";
import type { PlannedDeployment } from "./apply-phases";
import type { InvokerReference } from "./invoker";

type AssertInvokersSurviveDeployParams = {
  client: OperatorClient;
  workspaceId: string;
  deployments: ReadonlyArray<PlannedDeployment>;
};

type ReferencedInvoker = { namespace?: string; machineUserName?: string } | undefined;

function deletedAuthNamespaces(deployments: ReadonlyArray<PlannedDeployment>): Set<string> {
  return new Set(
    deployments.flatMap((deployment) =>
      deployment.auth.changeSet.service.deletes.map((entry) => entry.name),
    ),
  );
}

function plannedNames(
  entries: ReadonlyArray<ReadonlyArray<{ name: string }>>,
): ReadonlySet<string> {
  return new Set(entries.flat().map((entry) => entry.name));
}

function runPipelineNamespaces(deployments: ReadonlyArray<PlannedDeployment>) {
  return plannedNames(
    deployments.flatMap(({ pipeline }) => {
      const { service } = pipeline.changeSet;
      return [service.creates, service.updates, service.unchanged, service.deletes];
    }),
  );
}

function runExecutorNames(deployments: ReadonlyArray<PlannedDeployment>) {
  return plannedNames(
    deployments.flatMap(({ executor }) => {
      const { changeSet } = executor;
      return [changeSet.creates, changeSet.updates, changeSet.unchanged, changeSet.deletes];
    }),
  );
}

function referenceOf(invoker: ReferencedInvoker, context: string): InvokerReference | undefined {
  if (!invoker?.namespace || !invoker.machineUserName) return undefined;
  return { namespace: invoker.namespace, machineUserName: invoker.machineUserName, context };
}

async function listInvokersOutsideRun(
  params: AssertInvokersSurviveDeployParams,
): Promise<InvokerReference[]> {
  const { client, workspaceId, deployments } = params;
  const references: InvokerReference[] = [];

  const pipelineServices = await fetchAllTolerant(async (pageToken, pageSize) => {
    const { pipelineServices, nextPageToken } = await client.listPipelineServices({
      workspaceId,
      pageToken,
      pageSize,
    });
    return [pipelineServices, nextPageToken];
  });
  const namespacesOfRun = runPipelineNamespaces(deployments);
  for (const namespaceName of pipelineServices.flatMap(
    (service) => service.namespace?.name ?? [],
  )) {
    if (namespacesOfRun.has(namespaceName)) continue;
    const resolvers = await fetchAllTolerant(async (pageToken, pageSize) => {
      const { pipelineResolvers, nextPageToken } = await client.listPipelineResolvers({
        workspaceId,
        namespaceName,
        pageToken,
        pageSize,
        pipelineResolverView: PipelineResolverView.FULL,
      });
      return [pipelineResolvers, nextPageToken];
    });
    for (const resolver of resolvers) {
      for (const pipeline of resolver.pipelines) {
        const reference = referenceOf(
          pipeline.invoker,
          `Resolver "${resolver.name}" in pipeline "${namespaceName}"`,
        );
        if (reference) references.push(reference);
      }
    }
  }

  const executors = await fetchAllTolerant(async (pageToken, pageSize) => {
    const { executors, nextPageToken } = await client.listExecutorExecutors({
      workspaceId,
      pageToken,
      pageSize,
    });
    return [executors, nextPageToken];
  });
  const executorsOfRun = runExecutorNames(deployments);
  for (const executor of executors) {
    if (executorsOfRun.has(executor.name)) continue;
    const config = executor.targetConfig?.config;
    if (
      config?.case !== "tailorGraphql" &&
      config?.case !== "function" &&
      config?.case !== "workflow"
    ) {
      continue;
    }
    const reference = referenceOf(config.value.invoker, `Executor "${executor.name}"`);
    if (reference) references.push(reference);
  }
  return references;
}

/**
 * Reject an invoker whose Auth service this deploy run deletes, whether the invoker belongs to a
 * config of the run or to an app that is not part of it.
 * Call it after deletes that another config in the run still claims are dropped.
 * @param params - Client, workspace, and planned deployments of this run
 */
export async function assertInvokersSurviveDeploy(
  params: AssertInvokersSurviveDeployParams,
): Promise<void> {
  const deletedNamespaces = deletedAuthNamespaces(params.deployments);
  if (deletedNamespaces.size === 0) return;

  const referencesOfRun = params.deployments.flatMap((deployment) => [
    ...deployment.pipeline.invokerReferences,
    ...deployment.executor.invokerReferences,
  ]);
  const references = [...referencesOfRun, ...(await listInvokersOutsideRun(params))];
  for (const reference of references) {
    if (!deletedNamespaces.has(reference.namespace)) continue;
    throw CLIError({
      code: "INVOKER_MACHINE_USER_NOT_FOUND",
      message: `${reference.context} uses invoker "${reference.machineUserName}", but Auth service "${reference.namespace}" is deleted by this deploy.`,
      suggestion: `Keep Auth service "${reference.namespace}" in the config that defines it, or change the invoker to another Auth service and deploy the app that owns it in the same run.`,
      context: {
        invoker: reference.machineUserName,
        authNamespace: reference.namespace,
      },
    });
  }
}
