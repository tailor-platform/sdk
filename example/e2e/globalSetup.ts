import { machineUserToken, show } from "@tailor-platform/tailor-sdk/cli";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    url: string;
    token: string;
  }
}

export async function setup(project: TestProject) {
  const app = await show();
  const tokens = await machineUserToken({
    name: "manager-machine-user",
  });
  project.provide("url", app.url);
  project.provide("token", tokens.accessToken);
}
