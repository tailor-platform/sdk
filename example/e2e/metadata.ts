import { inject } from "vitest";
import type { Client } from "@connectrpc/connect";
import type { OperatorService } from "@tailor-platform/tailor-proto/service_pb";

export const SDK_NAME_LABEL_KEY = "sdk-name";

type OperatorClient = Client<typeof OperatorService>;

export function getAppName() {
  return inject("appName");
}

export function getWorkspaceId() {
  return inject("workspaceId");
}

// TRN generators
export function authTrn(workspaceId: string, name: string) {
  return `trn:v1:workspace:${workspaceId}:auth:${name}`;
}

export function pipelineTrn(workspaceId: string, name: string) {
  return `trn:v1:workspace:${workspaceId}:pipeline:${name}`;
}

export function tailordbTrn(workspaceId: string, name: string) {
  return `trn:v1:workspace:${workspaceId}:tailordb:${name}`;
}

export function workflowTrn(workspaceId: string, name: string) {
  return `trn:v1:workspace:${workspaceId}:workflow:${name}`;
}

export function jobFunctionTrn(workspaceId: string, name: string) {
  return `trn:v1:workspace:${workspaceId}:workflow_job_function:${name}`;
}

// Filter resources by metadata
export async function filterByMetadata<T extends { namespace?: { name?: string } }>(
  client: OperatorClient,
  resources: T[],
  trnGenerator: (workspaceId: string, name: string) => string,
): Promise<T[]> {
  const workspaceId = getWorkspaceId();
  const appName = getAppName();
  const ownedResources: T[] = [];

  for (const resource of resources) {
    const name = resource.namespace?.name ?? "";
    const { metadata } = await client.getMetadata({
      trn: trnGenerator(workspaceId, name),
    });
    if (metadata?.labels?.[SDK_NAME_LABEL_KEY] === appName) {
      ownedResources.push(resource);
    }
  }

  return ownedResources;
}

// Filter resources by metadata (for resources with direct name property)
export async function filterByMetadataWithName<T extends { name: string }>(
  client: OperatorClient,
  resources: T[],
  trnGenerator: (workspaceId: string, name: string) => string,
): Promise<T[]> {
  const workspaceId = getWorkspaceId();
  const appName = getAppName();
  const ownedResources: T[] = [];

  for (const resource of resources) {
    const { metadata } = await client.getMetadata({
      trn: trnGenerator(workspaceId, resource.name),
    });
    if (metadata?.labels?.[SDK_NAME_LABEL_KEY] === appName) {
      ownedResources.push(resource);
    }
  }

  return ownedResources;
}

// Filter unique names by metadata (for job functions that may have duplicates)
export async function filterUniqueNamesByMetadata(
  client: OperatorClient,
  names: string[],
  trnGenerator: (workspaceId: string, name: string) => string,
): Promise<string[]> {
  const workspaceId = getWorkspaceId();
  const appName = getAppName();
  const uniqueNames = [...new Set(names)];
  const ownedNames: string[] = [];

  for (const name of uniqueNames) {
    const { metadata } = await client.getMetadata({
      trn: trnGenerator(workspaceId, name),
    });
    if (metadata?.labels?.[SDK_NAME_LABEL_KEY] === appName) {
      ownedNames.push(name);
    }
  }

  return ownedNames;
}
