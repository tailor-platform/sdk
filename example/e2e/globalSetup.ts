import {
  loadAccessToken,
  loadWorkspaceId,
  machineUserToken,
  show,
} from "@tailor-platform/sdk/cli";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    url: string;
    token: string;
    workspaceId: string;
    platformToken: string;
  }
}

export async function setup(project: TestProject) {
  const app = await show();
  const tokens = await machineUserToken({
    name: "manager-machine-user",
  });
  const workspaceId = loadWorkspaceId();
  const platformToken = await loadAccessToken();

  project.provide("url", app.url);
  project.provide("token", tokens.accessToken);
  project.provide("workspaceId", workspaceId);
  project.provide("platformToken", platformToken);
}
