import { getApplicationAuthNamespace } from "#/cli/shared/auth-namespace";
import { CLIError } from "#/cli/shared/errors";
import type { PlannedDeployment } from "./apply-phases";

type ApplicationUse = { applicationName: string; authNamespace: string };

function applicationsUsing(
  deployments: ReadonlyArray<PlannedDeployment>,
  deletedNamespaces: ReadonlySet<string>,
): ApplicationUse[] {
  const written = new Set(
    deployments.flatMap(({ app }) =>
      [...app.creates, ...app.updates, ...app.unchanged].map((entry) => entry.name),
    ),
  );
  const deletedNames = new Set(
    deployments.flatMap(({ app }) => app.deletes.map((entry) => entry.name)),
  );
  const writtenUses = deployments.flatMap(({ application }) => {
    const authNamespace = getApplicationAuthNamespace(application);
    return written.has(application.name) && authNamespace
      ? [{ applicationName: application.name, authNamespace }]
      : [];
  });
  const recordedUses = deployments
    .flatMap(({ app }) => app.existingApplications)
    .filter((existing) => !written.has(existing.name) && !deletedNames.has(existing.name))
    .map((existing) => ({
      applicationName: existing.name,
      authNamespace: existing.authNamespace,
    }));
  return [...writtenUses, ...recordedUses].filter((use) =>
    deletedNamespaces.has(use.authNamespace),
  );
}

/**
 * Reject a deploy run that deletes an Auth service an application still uses.
 * An application the plan writes counts by the Auth service its config names, any other by the one
 * the workspace records. Call it after deletes that another config in the run still claims are
 * dropped and deletes of renamed applications are scheduled.
 * @param deployments - Planned deployments of this run
 */
export function assertAuthServicesNotInUse(deployments: ReadonlyArray<PlannedDeployment>): void {
  const deletedNamespaces = new Set(
    deployments.flatMap(({ auth }) => auth.changeSet.service.deletes.map((entry) => entry.name)),
  );
  if (deletedNamespaces.size === 0) return;
  const [use] = applicationsUsing(deployments, deletedNamespaces);
  if (!use) return;
  throw CLIError({
    code: "AUTH_SERVICE_IN_USE",
    message: `Auth service "${use.authNamespace}" is deleted by this deploy, but application "${use.applicationName}" still uses it.`,
    suggestion: `Keep Auth service "${use.authNamespace}" in the config that defines it, or move application "${use.applicationName}" to another Auth service in the same run.`,
    context: { authNamespace: use.authNamespace, application: use.applicationName },
  });
}
