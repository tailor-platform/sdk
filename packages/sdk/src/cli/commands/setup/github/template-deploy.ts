import deployTemplate from "./deploy.workflow.yml";

type DeployParams = {
  workspaceName: string;
  workspaceRegion: string;
  organizationId: string;
  folderId: string;
  workingDirectory?: string;
};

/**
 * Render the deploy workflow YAML.
 *
 * Targets single-application scaffolds (those with `generate` and `deploy` scripts).
 * Multi-application projects (e.g. chained `deploy:*` scripts) need manual workflow customization.
 * @param params - Workspace and deployment configuration
 * @returns Workflow YAML content
 */
export function renderDeploy(params: DeployParams): string {
  const { workspaceName, workspaceRegion, organizationId, folderId, workingDirectory } = params;

  // --dir sets working-directory for all run steps. Assumes the target directory
  // is a pnpm workspace member with its own package.json (standard monorepo layout).
  const defaultsBlock = workingDirectory
    ? `\ndefaults:\n  run:\n    working-directory: ${workingDirectory}\n`
    : "";

  return deployTemplate
    .replaceAll("__WORKSPACE_NAME__", () => workspaceName)
    .replace("__WORKSPACE_REGION__", () => workspaceRegion)
    .replace("__ORGANIZATION_ID__", () => organizationId)
    .replace("__FOLDER_ID__", () => folderId)
    .replace("# __DEFAULTS_BLOCK__\n", () => defaultsBlock);
}
