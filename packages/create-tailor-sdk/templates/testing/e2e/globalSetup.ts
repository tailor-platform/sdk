import { execSync } from "node:child_process";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    url: string;
    token: string;
  }
}

interface WorkspaceInfo {
  id: string;
  name: string;
}
let createdWorkspace: WorkspaceInfo | null = null;

function getUrl(): string {
  const result = execSync("pnpm tailor-sdk show -f json");
  return (JSON.parse(result.toString()) as { url: string }).url;
}

function getToken(): string {
  const result = execSync("pnpm tailor-sdk machineuser token admin -f json");
  return (JSON.parse(result.toString()) as { access_token: string })
    .access_token;
}

function createWorkspace(name: string, region: string): WorkspaceInfo {
  console.log(`Creating workspace "${name}" in region "${region}"...`);
  const result = execSync(
    `pnpm tailor-sdk workspace create --name ${name} --region ${region} -f json`,
  );
  const workspace = JSON.parse(result.toString()) as WorkspaceInfo;
  console.log(`Workspace "${workspace.name}" created successfully.`);
  return workspace;
}

function deployApplication(): void {
  console.log("Deploying application...");
  execSync("pnpm tailor-sdk apply", { stdio: "inherit" });
  console.log("Application deployed successfully.");
}

function deleteWorkspace(workspaceId: string): void {
  console.log("Deleting workspace...");
  execSync(
    `pnpm tailor-sdk workspace delete --workspace-id ${workspaceId} --yes`,
    {
      stdio: "inherit",
    },
  );
  console.log("Workspace deleted successfully.");
}

export function setup(project: TestProject) {
  const isCI = process.env.CI === "true";
  if (isCI) {
    const workspaceName = process.env.TAILOR_PLATFORM_WORKSPACE_NAME;
    const workspaceRegion = process.env.TAILOR_PLATFORM_WORKSPACE_REGION;
    if (!workspaceName || !workspaceRegion) {
      throw new Error(
        "TAILOR_PLATFORM_WORKSPACE_NAME and TAILOR_PLATFORM_WORKSPACE_REGION must be set when CI=true",
      );
    }
    createdWorkspace = createWorkspace(workspaceName, workspaceRegion);
    process.env.TAILOR_PLATFORM_WORKSPACE_ID = createdWorkspace.id;
    deployApplication();
  }

  project.provide("url", getUrl());
  project.provide("token", getToken());
}

export function teardown() {
  if (createdWorkspace) {
    deleteWorkspace(createdWorkspace.id);
    createdWorkspace = null;
  }
}
