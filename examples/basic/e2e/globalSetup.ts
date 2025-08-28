import { execSync } from "node:child_process";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    token: string;
  }
}

export function setup(project: TestProject) {
  const result = execSync(
    "tailorctl workspace machineuser token -a my-app -m admin-machine-user -f json",
  );
  const resultJson = JSON.parse(result.toString("utf-8")) as {
    access_token: string;
  }[];
  if (resultJson.length === 0) {
    throw new Error("failed to obtain machine user token");
  }
  // Use provide to pass down the token to tests.
  project.provide("token", resultJson[0].access_token);
}
