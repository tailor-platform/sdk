import * as fs from "node:fs";
import * as path from "pathe";
import deployTemplate from "./deploy.workflow.yml";
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
 * Render the deploy workflow YAML.
 *
 * Generates a workflow that calls the composite deploy action
 * from tailor-platform/actions. The environment setup steps (Node.js,
 * package manager, dependency install) are generated based on the
 * detected package manager.
 *
 * If withPlan is true, also includes a plan job that runs on pull requests.
 * Otherwise, the plan job section delimited by __PLAN_JOB_START__ /
 * __PLAN_JOB_END__ markers is stripped from the template.
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
    withPlan,
  } = params;

  const workingDirectoryLine = workingDirectory
    ? `          working-directory: ${workingDirectory}\n`
    : "";

  const stripPlanSection = (content: string): string =>
    withPlan
      ? content.replace(/^ *# __PLAN_JOB_(?:START|END)__\n/gm, "")
      : content.replace(/^ *# __PLAN_JOB_START__\n[\s\S]*?^ *# __PLAN_JOB_END__\n/m, "");

  return stripPlanSection(deployTemplate)
    .replaceAll("__WORKSPACE_NAME__", () => workspaceName)
    .replaceAll("__WORKSPACE_REGION__", () => workspaceRegion)
    .replaceAll("__ORGANIZATION_ID__", () => organizationId)
    .replaceAll("__FOLDER_ID__", () => folderId)
    .replace(/ *# __WORKING_DIRECTORY__\n/g, () => workingDirectoryLine)
    .replace(/^ *# __SETUP_STEPS__$/gm, () => indentSnippet(setupSteps[packageManager], 6));
}
