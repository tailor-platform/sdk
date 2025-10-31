import { execSync } from "node:child_process";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    url: string;
    token: string;
  }
}

function getUrl(): string {
  const result = execSync("pnpm tailor-sdk show -f json");
  return JSON.parse(result.toString("utf-8")).url;
}

function getToken(): string {
  const result = execSync(
    "pnpm tailor-sdk machineuser token manager-machine-user -f json",
  );
  return JSON.parse(result.toString("utf-8")).access_token;
}

export function setup(project: TestProject) {
  project.provide("url", getUrl());
  project.provide("token", getToken());
}
