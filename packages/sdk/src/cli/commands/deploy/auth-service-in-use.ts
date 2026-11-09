import { getApplicationAuthNamespace } from "#/cli/shared/auth-namespace";
import { CLIError } from "#/cli/shared/errors";
import type { PlannedDeployment } from "./apply-phases";

type ApplicationUse = { name: string; authNamespace: string };

type AuthServiceDeletePlan = Pick<PlannedDeployment, "application" | "app" | "auth">;

type AuthServiceDeletingCommand = "deploy" | "remove";

const IN_USE_SUGGESTIONS: Record<AuthServiceDeletingCommand, string> = {
  deploy:
    "Keep the Auth service in the config that defines it, or move the applications that use it to another Auth service in the same run.",
  remove:
    "Remove the applications that use the Auth service, or deploy them without it, then run remove again.",
};

function applicationsUsing(
  deployments: ReadonlyArray<AuthServiceDeletePlan>,
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
      ? [{ name: application.name, authNamespace }]
      : [];
  });
  const recordedNamespaces = new Map(
    deployments
      .flatMap(({ app }) => app.existingApplications)
      .map((existing) => [existing.name, existing.authNamespace]),
  );
  const recordedUses = [...recordedNamespaces]
    .filter(([name]) => !written.has(name) && !deletedNames.has(name))
    .map(([name, authNamespace]) => ({ name, authNamespace }));
  return [...writtenUses, ...recordedUses].filter((use) =>
    deletedNamespaces.has(use.authNamespace),
  );
}

/**
 * Reject a run that deletes an Auth service an application still uses.
 * An application the plan writes counts by the Auth service its config names, any other by the one
 * the workspace records. When the run spans several configs, call it after deletes that another
 * config in the run still claims are dropped and deletes of renamed applications are scheduled.
 * @param deployments - Planned deployments of a deploy run, or the plan of a removal
 * @param command - Command whose run deletes the Auth services
 */
export function assertAuthServicesNotInUse(
  deployments: ReadonlyArray<AuthServiceDeletePlan>,
  command: AuthServiceDeletingCommand,
): void {
  const deletedNamespaces = new Set(
    deployments.flatMap(({ auth }) => auth.changeSet.service.deletes.map((entry) => entry.name)),
  );
  if (deletedNamespaces.size === 0) return;
  const uses = applicationsUsing(deployments, deletedNamespaces);
  if (uses.length === 0) return;
  throw CLIError({
    code: "SERVICE_IN_USE",
    message: uses
      .map(
        (use) =>
          `Auth service "${use.authNamespace}" cannot be deleted: application "${use.name}" still uses it.`,
      )
      .join("\n"),
    suggestion: IN_USE_SUGGESTIONS[command],
    context: { applications: uses },
  });
}
