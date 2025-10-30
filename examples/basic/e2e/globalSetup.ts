import { execSync } from "node:child_process";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    url: string;
    token: string;
  }
}

function getUrl(): string {
  const result = execSync(
    `tailorctl workspace app list -f json ${process.env.TAILOR_PLATFORM_WORKSPACE_ID ? `-w ${process.env.TAILOR_PLATFORM_WORKSPACE_ID}` : ""}`.trim(),
  );
  const resultJson = JSON.parse(result.toString("utf-8")) as { url: string }[];
  if (resultJson.length === 0) {
    throw new Error("failed to obtain machine user token");
  }
  return resultJson[0].url;
}

function getToken(): string {
  const result = execSync(
    `tailorctl workspace machineuser token -a my-app -m manager-machine-user -f json ${process.env.TAILOR_PLATFORM_WORKSPACE_ID ? `-w ${process.env.TAILOR_PLATFORM_WORKSPACE_ID}` : ""}`.trim(),
  );
  const resultJson = JSON.parse(result.toString("utf-8")) as {
    access_token: string;
  }[];
  if (resultJson.length === 0) {
    throw new Error("failed to obtain machine user token");
  }
  return resultJson[0].access_token;
}

export function setup(project: TestProject) {
  project.provide("url", getUrl());
  project.provide("token", getToken());
}
