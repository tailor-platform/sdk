import * as fs from "node:fs";
import * as path from "pathe";
import deployTemplate from "./deploy.workflow.yml";
import planJobTemplate from "./plan-job.yml";
import setupBun from "./setup-bun.yml";
import setupNpm from "./setup-npm.yml";
import setupPnpm from "./setup-pnpm.yml";
import setupYarn from "./setup-yarn.yml";

type PackageManager = "pnpm" | "yarn" | "npm" | "bun";

type DeployParams = {
  workspaceName: string;
  workspaceRegion: string;
  organizationId: string;
  folderId: string;
  workingDirectory?: string;
  packageManager: PackageManager;
  actionsRef: string;
  withPlan?: boolean;
};

const setupSteps: Record<PackageManager, string> = {
  pnpm: setupPnpm,
  yarn: setupYarn,
  npm: setupNpm,
  bun: setupBun,
};

function indentSnippet(snippet: string, spaces: number): string {
  const indent = " ".repeat(spaces);
  return snippet
    .trimEnd()
    .split("\n")
    .map((line) => (line ? indent + line : line))
    .join("\n");
}

/**
 * Detect the package manager used in a project directory by checking for lockfiles.
 * @param dir - Project directory to inspect
 * @returns Detected package manager, defaults to npm
 */
export function detectPackageManager(dir: string): PackageManager {
  if (fs.existsSync(path.join(dir, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(dir, "yarn.lock"))) return "yarn";
  if (fs.existsSync(path.join(dir, "bun.lockb")) || fs.existsSync(path.join(dir, "bun.lock")))
    return "bun";
  if (fs.existsSync(path.join(dir, "package-lock.json"))) return "npm";
  return "npm";
}

/**
 * Render the plan job YAML snippet.
 * @param params - Configuration for plan job
 * @param params.workingDirectory - Working directory for monorepo setups
 * @param params.packageManager - Package manager to use
 * @param params.actionsRef - Git ref for tailor-platform/actions
 * @returns Plan job YAML content
 */
function renderPlanJob(params: {
  workingDirectory?: string;
  packageManager: PackageManager;
  actionsRef: string;
}): string {
  const { workingDirectory, packageManager, actionsRef } = params;

  const workingDirectoryLine = workingDirectory
    ? `          working-directory: ${workingDirectory}\n`
    : "";

  return planJobTemplate
    .replaceAll("__ACTIONS_REF__", () => actionsRef)
    .replace(/ *# __WORKING_DIRECTORY__\n/, () => workingDirectoryLine)
    .replace(/^ *# __SETUP_STEPS__$/m, () => indentSnippet(setupSteps[packageManager], 6));
}

/**
 * Render the deploy workflow YAML.
 *
 * Generates a workflow that calls the composite deploy action
 * from tailor-platform/actions. The environment setup steps (Node.js,
 * package manager, dependency install) are generated based on the
 * detected package manager.
 *
 * If withPlan is true, also includes a plan job that runs on pull requests.
 * @param params - Workspace and deployment configuration
 * @returns Workflow YAML content
 */
export function renderDeploy(params: DeployParams): string {
  const {
    workspaceName,
    workspaceRegion,
    organizationId,
    folderId,
    workingDirectory,
    packageManager,
    actionsRef,
    withPlan,
  } = params;

  const workingDirectoryLine = workingDirectory
    ? `          working-directory: ${workingDirectory}\n`
    : "";

  const planJobContent = withPlan
    ? renderPlanJob({ workingDirectory, packageManager, actionsRef }) + "\n"
    : "";

  return deployTemplate
    .replaceAll("__WORKSPACE_NAME__", () => workspaceName)
    .replaceAll("__WORKSPACE_REGION__", () => workspaceRegion)
    .replaceAll("__ORGANIZATION_ID__", () => organizationId)
    .replaceAll("__FOLDER_ID__", () => folderId)
    .replaceAll("__ACTIONS_REF__", () => actionsRef)
    .replace(/ *# __WORKING_DIRECTORY__\n/, () => workingDirectoryLine)
    .replace(/^ *# __SETUP_STEPS__$/m, () => indentSnippet(setupSteps[packageManager], 6))
    .replace(/^ *# __PLAN_JOB__\n/m, () =>
      planJobContent ? indentSnippet(planJobContent, 2) : "",
    );
}
