import { CLIError } from "#/cli/shared/errors";
import type { PlannedDeployment } from "./apply-phases";

/**
 * Reject an invoker whose Auth service this deploy run deletes.
 * Call it after deletes that another config in the run still claims are dropped.
 * @param deployments - Planned deployments of this run
 */
export function assertInvokersSurviveDeploy(deployments: ReadonlyArray<PlannedDeployment>): void {
  const deletedNamespaces = new Set(
    deployments.flatMap((deployment) =>
      deployment.auth.changeSet.service.deletes.map((entry) => entry.name),
    ),
  );
  if (deletedNamespaces.size === 0) return;
  for (const deployment of deployments) {
    for (const reference of [
      ...deployment.pipeline.invokerReferences,
      ...deployment.executor.invokerReferences,
    ]) {
      if (!deletedNamespaces.has(reference.namespace)) continue;
      throw CLIError({
        code: "INVOKER_MACHINE_USER_NOT_FOUND",
        message: `${reference.context} uses invoker "${reference.machineUserName}", but Auth service "${reference.namespace}" is deleted by this deploy.`,
        suggestion: `Keep Auth service "${reference.namespace}" in the config that defines it, or point the invoker at another Auth service.`,
        context: {
          invoker: reference.machineUserName,
          authNamespace: reference.namespace,
        },
      });
    }
  }
}
