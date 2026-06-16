import { setTimeout as delay } from "node:timers/promises";
import {
  loadAccessToken,
  loadWorkspaceId,
  getMachineUserToken,
  show,
} from "@tailor-platform/sdk/cli";
import type { TestProject } from "vitest/node";

const machineUserTokenRetryDelays = [5_000, 10_000, 15_000, 20_000, 25_000];

declare module "vitest" {
  export interface ProvidedContext {
    url: string;
    token: string;
    workspaceId: string;
    platformToken: string;
    appName: string;
  }
}

export async function setup(project: TestProject) {
  const app = await show();
  const tokens = await getManagerMachineUserToken();
  const workspaceId = await loadWorkspaceId();
  const platformToken = await loadAccessToken();

  project.provide("url", app.url);
  project.provide("token", tokens.accessToken);
  project.provide("workspaceId", workspaceId);
  project.provide("platformToken", platformToken);
  project.provide("appName", app.name);
}

async function getManagerMachineUserToken() {
  for (let attempt = 0; ; attempt++) {
    try {
      return await getMachineUserToken({
        name: "manager-machine-user",
      });
    } catch (error) {
      const retryDelay = machineUserTokenRetryDelays[attempt];
      if (retryDelay === undefined) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `Failed to fetch manager-machine-user token: ${message}. Retrying in ${
          retryDelay / 1000
        }s.`,
      );
      await delay(retryDelay);
    }
  }
}
