import { CLIError } from "#/cli/shared/errors";
import { resolveAppId } from "./app-id-lock";
import type { WorkspaceTakeover } from "./confirm";
import type { DeploymentSource } from "./deployment-target";

type TakenOverApplication = {
  id: string;
  name?: string;
  resources: { resourceType: WorkspaceTakeover["resourceType"]; name: string }[];
};

function takenOverApplications(takeovers: readonly WorkspaceTakeover[]): TakenOverApplication[] {
  const byId = new Map<string, TakenOverApplication>();
  for (const { currentAppId, currentOwner, resourceType, resourceName } of takeovers) {
    if (currentAppId === undefined) continue;
    let application = byId.get(currentAppId);
    if (!application) {
      application = {
        id: currentAppId,
        ...(currentOwner && { name: currentOwner }),
        resources: [],
      };
      byId.set(currentAppId, application);
    }
    application.resources.push({ resourceType, name: resourceName });
  }
  return [...byId.values()];
}

/**
 * Stop a `defineApp()` config that would take over resources another config deployed. Its own
 * id is the one `.github/tailor.lock` records for it; without one, the only id among the
 * resources it takes over counts as its own, and two or more stop it. A `defineWorkspace()`
 * config takes over every config's resources.
 * @param source - Config the deployment was built from
 * @param takeovers - Resources the deployment takes over or deletes
 */
export function assertTakeoversFromOwnConfig(
  source: DeploymentSource,
  takeovers: readonly WorkspaceTakeover[],
): void {
  if (source.kind !== "workspace" || source.workspace.definedBy !== "defineApp") return;
  const configPath = source.workspace.path;
  const applications = takenOverApplications(takeovers);
  const ownId = resolveAppId({ configPath, configId: undefined })?.toLowerCase();
  const others =
    ownId === undefined
      ? applications.length > 1
        ? applications
        : []
      : applications.filter(({ id }) => id.toLowerCase() !== ownId);
  if (others.length === 0) return;
  const listed = others
    .map(({ id, name }) => (name === undefined ? id : `"${name}" (${id})`))
    .join(", ");
  throw CLIError({
    code: "DEPLOY_OTHER_CONFIG_RESOURCES",
    message:
      ownId === undefined
        ? `This defineApp() config would take over resources that several configs deployed: ${listed}.`
        : `This defineApp() config would take over resources that another config deployed: ${listed}.`,
    suggestion:
      "Merge every config deployed to this workspace into one defineWorkspace() config and deploy that instead: it takes over their resources. If a listed config's resources are no longer needed, delete them first with `tailor remove -c <that config>`.",
    context: { configPath, applications: others },
  });
}
