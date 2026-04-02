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
 * Render the deploy caller workflow YAML.
 *
 * Generates a thin workflow that calls the composite deploy action
 * from tailor-platform/actions. The environment setup steps (Node.js,
 * package manager, dependency install) are generated based on the
 * detected package manager.
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
  } = params;

  const workingDirectoryLine = workingDirectory
    ? `          working-directory: ${workingDirectory}\n`
    : "";

  return deployTemplate
    .replaceAll("__WORKSPACE_NAME__", () => workspaceName)
    .replace("__WORKSPACE_REGION__", () => workspaceRegion)
    .replace("__ORGANIZATION_ID__", () => organizationId)
    .replace("__FOLDER_ID__", () => folderId)
    .replace(/ *# __WORKING_DIRECTORY__\n/, () => workingDirectoryLine)
    .replace(/^ *# __SETUP_STEPS__$/m, () => indentSnippet(setupSteps[packageManager], 6));
}
