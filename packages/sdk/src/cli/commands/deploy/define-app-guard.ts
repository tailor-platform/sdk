import { CLIError } from "#/cli/shared/errors";
import { resolveAppId } from "./app-id-lock";
import type { WorkspaceTakeover } from "./confirm";
import type { DeploymentSource } from "./deployment-target";

type TakenOverApplication = {
  id: string;
  name?: string;
  resources: { resourceType: WorkspaceTakeover["resourceType"]; name: string }[];
};

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

function deletedWorkspaceApplications(plan: OwnConfigGuardPlan): string[] {
  const own = new Set(plan.applications.map(({ name }) => name));
  const takenOver = new Set(
    plan.takeovers
      .filter(({ resourceType }) => resourceType === "application")
      .map(({ resourceName }) => resourceName),
  );
  return plan.applicationDeletes
    .map(({ name }) => name)
    .filter((name) => !own.has(name) && !takenOver.has(name));
}

/**
 * Stop a `defineApp()` config that would take over or delete resources another config deployed.
 * Taken over are the resources of a `defineConfig()` config whose id is not the one
 * `.github/tailor.lock` records for this config; without one, the only id among them counts as its
 * own, and two or more stop it. Deleted are the workspace-managed applications it does not deploy:
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
  const applications = takenOverApplications(plan.takeovers);
  const ownId = resolveAppId({ configPath, configId: undefined })?.toLowerCase();
  const others =
    ownId === undefined
      ? applications.length > 1
        ? applications
        : []
      : applications.filter(({ id }) => id.toLowerCase() !== ownId);
  const deletedApplications = deletedWorkspaceApplications(plan);
  if (others.length === 0 && deletedApplications.length === 0) return;

  const messages: string[] = [];
  const suggestions = [
    "Merge every config deployed to this workspace into one defineWorkspace() config and deploy that instead: it takes over their resources.",
  ];
  if (others.length > 0) {
    const listed = others
      .map(({ id, name }) => (name === undefined ? id : `"${name}" (${id})`))
      .join(", ");
    messages.push(
      ownId === undefined
        ? `This defineApp() config would take over resources that several configs deployed: ${listed}.`
        : `This defineApp() config would take over resources that another config deployed: ${listed}.`,
    );
    suggestions.push(
      "If a config whose resources would be taken over is no longer needed, delete its resources first with `tailor remove -c <that config>`.",
    );
  }
  if (deletedApplications.length > 0) {
    const listed = deletedApplications.map((name) => `"${name}"`).join(", ");
    messages.push(
      `This defineApp() config would delete applications it does not deploy, which another defineApp() or defineWorkspace() config may own: ${listed}.`,
    );
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
