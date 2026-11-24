import { CLIError } from "#/cli/shared/errors";
import { appIdLockKey, findAppIdLock, TAILOR_LOCK_FILENAME } from "./app-id-lock";
import type { WorkspaceTakeover } from "./confirm";
import type { DeploymentSource } from "./deployment-target";

type TakenOverResource = { resourceType: WorkspaceTakeover["resourceType"]; name: string };
type TakenOverApplication =
  | { id: string; name?: string; resources: TakenOverResource[] }
  | { id?: never; name: string; resources: TakenOverResource[] };

/** What a deployment plans, as far as {@link assertResourcesFromOwnConfig} reads it. */
export type OwnConfigGuardPlan = {
  /** Applications the config deploys. */
  applications: ReadonlyArray<{ name: string }>;
  /** Resources it takes over or deletes from `defineConfig()` configs. */
  takeovers: readonly WorkspaceTakeover[];
  /** Applications it deletes. */
  applicationDeletes: ReadonlyArray<{ name: string }>;
};

function takenOverApplications(takeovers: readonly WorkspaceTakeover[]): TakenOverApplication[] {
  const byId = new Map<string, TakenOverApplication>();
  const byName = new Map<string, TakenOverApplication>();
  for (const { currentAppId, currentOwner, resourceType, resourceName } of takeovers) {
    const resource = { resourceType, name: resourceName };
    if (currentAppId !== undefined) {
      const application = byId.get(currentAppId) ?? {
        id: currentAppId,
        ...(currentOwner && { name: currentOwner }),
        resources: [],
      };
      application.resources.push(resource);
      byId.set(currentAppId, application);
    } else if (currentOwner !== undefined) {
      const application = byName.get(currentOwner) ?? { name: currentOwner, resources: [] };
      application.resources.push(resource);
      byName.set(currentOwner, application);
    }
  }
  return [...byId.values(), ...byName.values()];
}

function lockEntry(configPath: string): { key: string; id: string | undefined } | undefined {
  const lock = findAppIdLock(configPath);
  if (lock === null) return undefined;
  const key = appIdLockKey(lock.root, configPath);
  return { key, id: lock.appIds[key]?.toLowerCase() };
}

function deletedWorkspaceApplications(
  plan: OwnConfigGuardPlan,
  ownNames: ReadonlySet<string>,
): string[] {
  const takenOver = new Set(
    plan.takeovers
      .filter(({ resourceType }) => resourceType === "application")
      .map(({ resourceName }) => resourceName),
  );
  return plan.applicationDeletes
    .map(({ name }) => name)
    .filter((name) => !ownNames.has(name) && !takenOver.has(name));
}

/**
 * Stop a `defineApp()` config that would take over or delete resources another config deployed.
 * Taken over are the resources of `defineConfig()` configs. Those with an id are its own when the id
 * is the one `.github/tailor.lock` records for this config; without a recorded id, when theirs is
 * the only id among them and they carry this config's name. Those without an id are its own when
 * they carry this config's name. Deleted are the workspace-managed applications it does not deploy:
 * this config deploys one application, so another one is another `defineApp()` or
 * `defineWorkspace()` config's, or its own under an earlier name. A `defineWorkspace()` config
 * takes over and deletes every config's resources.
 * @param source - Config the deployment was built from
 * @param plan - Applications the deployment deploys, takes over, and deletes
 */
export function assertResourcesFromOwnConfig(
  source: DeploymentSource,
  plan: OwnConfigGuardPlan,
): void {
  if (source.kind !== "workspace" || source.workspace.definedBy !== "defineApp") return;
  const configPath = source.workspace.path;
  const ownNames = new Set(plan.applications.map(({ name }) => name));
  const lock = lockEntry(configPath);
  const ownId = lock?.id;
  const applications = takenOverApplications(plan.takeovers);
  const idCount = applications.filter(({ id }) => id !== undefined).length;
  const others = applications.filter(({ id, name }) =>
    id === undefined || (ownId === undefined && idCount === 1)
      ? name === undefined || !ownNames.has(name)
      : id.toLowerCase() !== ownId,
  );
  const deletedApplications = deletedWorkspaceApplications(plan, ownNames);
  if (others.length === 0 && deletedApplications.length === 0) return;

  const messages: string[] = [];
  const suggestions = [
    "Merge every config deployed to this workspace into one defineWorkspace() config and deploy that instead: it takes over their resources.",
  ];
  if (others.length > 0) {
    const listed = others
      .map(({ id, name }) =>
        id === undefined ? `"${name}"` : name === undefined ? id : `"${name}" (${id})`,
      )
      .join(", ");
    messages.push(
      others.length > 1
        ? `This defineApp() config would take over resources that several configs deployed: ${listed}.`
        : `This defineApp() config would take over resources that another config deployed: ${listed}.`,
    );
    suggestions.push(
      "If a config whose resources would be taken over is no longer needed, delete its resources first with `tailor remove -c <that config>`.",
    );
  }
  if (lock && others.some(({ id }) => id !== undefined)) {
    suggestions.push(
      `If a listed application is this config's, set "${lock.key}" under 'appIds' in ${TAILOR_LOCK_FILENAME} to its id.`,
    );
  }
  if (deletedApplications.length > 0) {
    const listed = deletedApplications.map((name) => `"${name}"`).join(", ");
    messages.push(
      `This defineApp() config would delete applications it does not deploy, which another defineApp() or defineWorkspace() config may own: ${listed}.`,
    );
  }
  if (deletedApplications.length > 0 || others.some(({ id }) => id === undefined || !lock)) {
    suggestions.push(
      "If a listed application is this config's under an earlier name, deploy this config once as a defineWorkspace() config whose apps list the new name: it deletes every application in the workspace that it does not list.",
    );
  }
  throw CLIError({
    code: "DEPLOY_OTHER_CONFIG_RESOURCES",
    message: messages.join("\n"),
    suggestion: suggestions.join(" "),
    context: { configPath, takenOverApplications: others, deletedApplications },
  });
}
