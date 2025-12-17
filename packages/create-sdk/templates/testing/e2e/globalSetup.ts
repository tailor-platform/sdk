import {
  apply,
  getMachineUserToken,
  show,
  createWorkspace,
  deleteWorkspace,
  type WorkspaceInfo,
} from "@tailor-platform/sdk/cli";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    url: string;
    token: string;
  }
}

let createdWorkspace: WorkspaceInfo | null = null;

async function setupWorkspace(name: string, region: string) {
  console.log(`Creating workspace "${name}" in region "${region}"...`);
  const workspace = await createWorkspace({ name, region });
  console.log(`Workspace "${workspace.name}" created successfully.`);
  return workspace;
}

async function deployApplication() {
  console.log("Deploying application...");
  await apply();
  console.log("Application deployed successfully.");
}

async function cleanupWorkspace(workspaceId: string) {
  console.log("Deleting workspace...");
  await deleteWorkspace({ workspaceId });
  console.log("Workspace deleted successfully.");
}

export async function setup(project: TestProject) {
  const isCI = process.env.CI === "true";
  if (isCI) {
    const workspaceName = process.env.TAILOR_PLATFORM_WORKSPACE_NAME;
    const workspaceRegion = process.env.TAILOR_PLATFORM_WORKSPACE_REGION;
    if (!workspaceName || !workspaceRegion) {
      throw new Error(
        "TAILOR_PLATFORM_WORKSPACE_NAME and TAILOR_PLATFORM_WORKSPACE_REGION must be set when CI=true",
      );
    }
    createdWorkspace = await setupWorkspace(workspaceName, workspaceRegion);
    process.env.TAILOR_PLATFORM_WORKSPACE_ID = createdWorkspace.id;
    await deployApplication();
  }

  const app = await show();
  const tokens = await getMachineUserToken({ name: "admin" });
  project.provide("url", app.url);
  project.provide("token", tokens.accessToken);
}

export async function teardown() {
  if (createdWorkspace) {
    await cleanupWorkspace(createdWorkspace.id);
    createdWorkspace = null;
  }
}
