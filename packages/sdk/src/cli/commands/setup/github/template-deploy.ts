import deployTemplate from "./deploy.workflow.yml";

type DeployParams = {
  workspaceName: string;
  workspaceRegion: string;
  organizationId: string;
  folderId: string;
  workingDirectory?: string;
};

/**
 * Render the deploy caller workflow YAML.
 *
 * Generates a thin workflow that calls the composite deploy action
 * from tailor-platform/actions. Targets single-application scaffolds
 * (those with `generate` and `deploy` scripts). Multi-application
 * projects (e.g. chained `deploy:*` scripts) need manual workflow
 * customization.
 * @param params - Workspace and deployment configuration
 * @returns Workflow YAML content
 */
export function renderDeploy(params: DeployParams): string {
  const { workspaceName, workspaceRegion, organizationId, folderId, workingDirectory } = params;

  const workingDirectoryLine = workingDirectory
    ? `          working-directory: ${workingDirectory}\n`
    : "";

  return deployTemplate
    .replaceAll("__WORKSPACE_NAME__", () => workspaceName)
    .replace("__WORKSPACE_REGION__", () => workspaceRegion)
    .replace("__ORGANIZATION_ID__", () => organizationId)
    .replace("__FOLDER_ID__", () => folderId)
    .replace(/ *# __WORKING_DIRECTORY__\n/, () => workingDirectoryLine);
}
