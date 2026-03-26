import * as fs from "node:fs";
import * as path from "pathe";
import deployTemplate from "./deploy.workflow.yml";

type PackageManager = "pnpm" | "yarn" | "npm";

type DeployParams = {
  workspaceName: string;
  workspaceRegion: string;
  organizationId: string;
  folderId: string;
  workingDirectory?: string;
  packageManager: PackageManager;
};

const setupSteps: Record<PackageManager, string> = {
  pnpm: [
    "      - uses: pnpm/action-setup@v4",
    "      - uses: actions/setup-node@v4",
    "        with:",
    "          node-version-file: package.json",
    "          cache: pnpm",
    "      - run: pnpm install --frozen-lockfile",
  ].join("\n"),
  yarn: [
    "      - uses: actions/setup-node@v4",
    "        with:",
    "          node-version-file: package.json",
    "          cache: yarn",
    "      - run: yarn install --frozen-lockfile",
  ].join("\n"),
  npm: [
    "      - uses: actions/setup-node@v4",
    "        with:",
    "          node-version-file: package.json",
    "          cache: npm",
    "      - run: npm ci",
  ].join("\n"),
};

/**
 * Detect the package manager used in a project directory by checking for lockfiles.
 * @param dir - Project directory to inspect
 * @returns Detected package manager, defaults to npm
 */
export function detectPackageManager(dir: string): PackageManager {
  if (fs.existsSync(path.join(dir, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(dir, "yarn.lock"))) return "yarn";
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
    .replace(/^ *# __SETUP_STEPS__$/m, () => setupSteps[packageManager]);
}
