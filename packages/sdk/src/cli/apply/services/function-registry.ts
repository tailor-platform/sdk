import * as crypto from "node:crypto";
import * as fs from "node:fs";
import { Code, ConnectError } from "@connectrpc/connect";
import * as path from "pathe";
import { getDistDir } from "@/cli/utils/dist-dir";
import { logger } from "@/cli/utils/logger";
import { fetchAll, type OperatorClient } from "../../client";
import { buildMetaRequest, sdkNameLabelKey, type WithLabel } from "./label";
import { createChangeSet } from ".";
import type { ApplyPhase } from "..";
import type { OwnerConflict, UnmanagedResource } from "./confirm";
import type { Application } from "@/cli/application";
import type { MessageInitShape } from "@bufbuild/protobuf";
import type { UpdateFunctionRegistryRequestSchema } from "@tailor-proto/tailor/v1/function_registry_pb";
import type { CreateFunctionRegistryRequestSchema } from "@tailor-proto/tailor/v1/function_registry_pb";
import type { SetMetadataRequestSchema } from "@tailor-proto/tailor/v1/metadata_pb";

const CHUNK_SIZE = 64 * 1024; // 64KB

export type FunctionEntry = {
  name: string;
  scriptContent: string;
  contentHash: string;
  description: string;
};

type CreateFunction = {
  name: string;
  entry: FunctionEntry;
  metaRequest: MessageInitShape<typeof SetMetadataRequestSchema>;
};

type UpdateFunction = {
  name: string;
  entry: FunctionEntry;
  metaRequest: MessageInitShape<typeof SetMetadataRequestSchema>;
};

type DeleteFunction = {
  name: string;
  workspaceId: string;
};

/**
 * Compute SHA-256 content hash for a script string.
 * @param content - Script content to hash
 * @returns Hex-encoded SHA-256 hash
 */
function computeContentHash(content: string): string {
  return crypto.createHash("sha256").update(content, "utf-8").digest("hex");
}

function functionRegistryTrn(workspaceId: string, name: string) {
  return `trn:v1:workspace:${workspaceId}:function_registry:${name}`;
}

/**
 * Build a function registry name for a resolver.
 * @param namespace - Resolver namespace
 * @param resolverName - Resolver name
 * @returns Function registry name
 */
export function resolverFunctionName(namespace: string, resolverName: string): string {
  return `resolver--${namespace}--${resolverName}`;
}

/**
 * Build a function registry name for an executor.
 * @param executorName - Executor name
 * @returns Function registry name
 */
export function executorFunctionName(executorName: string): string {
  return `executor--${executorName}`;
}

/**
 * Build a function registry name for a workflow job.
 * @param jobName - Workflow job name
 * @returns Function registry name
 */
export function workflowJobFunctionName(jobName: string): string {
  return `workflow--${jobName}`;
}

/**
 * Collect all function entries from bundled scripts for all services.
 * @param application - Application definition
 * @returns Array of function entries to register
 */
export function collectFunctionEntries(application: Readonly<Application>): FunctionEntry[] {
  const entries: FunctionEntry[] = [];
  const distDir = getDistDir();

  // Resolvers
  for (const app of application.applications) {
    for (const pipeline of app.resolverServices) {
      for (const resolver of Object.values(pipeline.getResolvers())) {
        const scriptPath = path.join(distDir, "resolvers", `${resolver.name}.js`);
        try {
          const content = fs.readFileSync(scriptPath, "utf-8");
          entries.push({
            name: resolverFunctionName(pipeline.namespace, resolver.name),
            scriptContent: content,
            contentHash: computeContentHash(content),
            description: `Resolver: ${pipeline.namespace}/${resolver.name}`,
          });
        } catch {
          logger.warn(`Function file not found: ${scriptPath}`);
        }
      }
    }
  }

  // Executors
  if (application.executorService) {
    const executors = application.executorService.getExecutors();
    for (const executor of Object.values(executors)) {
      if (executor.operation.kind === "function" || executor.operation.kind === "jobFunction") {
        const scriptPath = path.join(distDir, "executors", `${executor.name}.js`);
        try {
          const content = fs.readFileSync(scriptPath, "utf-8");
          entries.push({
            name: executorFunctionName(executor.name),
            scriptContent: content,
            contentHash: computeContentHash(content),
            description: `Executor: ${executor.name}`,
          });
        } catch {
          logger.warn(`Function file not found: ${scriptPath}`);
        }
      }
    }
  }

  // Workflow jobs
  const jobsDir = path.join(distDir, "workflow-jobs");
  if (fs.existsSync(jobsDir)) {
    const files = fs.readdirSync(jobsDir);
    for (const file of files) {
      // Only load final bundled .js files (e.g., "job-name.js", not "job-name.base.js")
      if (/^[^.]+\.js$/.test(file)) {
        const jobName = file.replace(/\.js$/, "");
        const scriptPath = path.join(jobsDir, file);
        const content = fs.readFileSync(scriptPath, "utf-8");
        entries.push({
          name: workflowJobFunctionName(jobName),
          scriptContent: content,
          contentHash: computeContentHash(content),
          description: `Workflow job: ${jobName}`,
        });
      }
    }
  }

  return entries;
}

type ExistingFunction = {
  name: string;
  contentHash: string;
};

/**
 * Plan function registry changes based on current and desired state.
 * @param client - Operator client instance
 * @param workspaceId - Workspace ID
 * @param appName - Application name
 * @param entries - Desired function entries
 * @returns Planned changes
 */
export async function planFunctionRegistry(
  client: OperatorClient,
  workspaceId: string,
  appName: string,
  entries: FunctionEntry[],
) {
  const changeSet = createChangeSet<CreateFunction, UpdateFunction, DeleteFunction>(
    "Function registry",
  );
  const conflicts: OwnerConflict[] = [];
  const unmanaged: UnmanagedResource[] = [];
  const resourceOwners = new Set<string>();

  // Fetch existing function registry entries
  const existingFunctions = await fetchAll(async (pageToken) => {
    try {
      const response = await client.listFunctionRegistries({
        workspaceId,
        pageToken,
      });
      return [
        response.functions.map(
          (f): ExistingFunction => ({
            name: f.name,
            contentHash: f.contentHash,
          }),
        ),
        response.nextPageToken,
      ];
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.NotFound) {
        return [[], ""];
      }
      throw error;
    }
  });

  // Build map of existing functions with their labels
  const existingMap: WithLabel<ExistingFunction> = {};
  await Promise.all(
    existingFunctions.map(async (func) => {
      const { metadata } = await client.getMetadata({
        trn: functionRegistryTrn(workspaceId, func.name),
      });
      existingMap[func.name] = {
        resource: func,
        label: metadata?.labels[sdkNameLabelKey],
      };
    }),
  );

  // Process desired entries
  for (const entry of entries) {
    const existing = existingMap[entry.name];
    const metaRequest = await buildMetaRequest(
      functionRegistryTrn(workspaceId, entry.name),
      appName,
    );

    if (existing) {
      if (!existing.label) {
        unmanaged.push({
          resourceType: "Function registry",
          resourceName: entry.name,
        });
      } else if (existing.label !== appName) {
        conflicts.push({
          resourceType: "Function registry",
          resourceName: entry.name,
          currentOwner: existing.label,
        });
      }

      // Skip update if content hash matches
      if (existing.resource.contentHash === entry.contentHash) {
        // Still set metadata to ensure ownership is correct
        changeSet.updates.push({
          name: entry.name,
          entry,
          metaRequest,
        });
      } else {
        changeSet.updates.push({
          name: entry.name,
          entry,
          metaRequest,
        });
      }
      delete existingMap[entry.name];
    } else {
      changeSet.creates.push({
        name: entry.name,
        entry,
        metaRequest,
      });
    }
  }

  // Remaining entries in existingMap are candidates for deletion
  for (const [name, existing] of Object.entries(existingMap)) {
    if (!existing) continue;
    const label = existing.label;
    if (label && label !== appName) {
      resourceOwners.add(label);
    }
    // Only delete functions managed by this application
    if (label === appName) {
      changeSet.deletes.push({
        name,
        workspaceId,
      });
    }
  }

  changeSet.print();
  return { changeSet, conflicts, unmanaged, resourceOwners };
}

/**
 * Upload a function script to the function registry using client streaming.
 * @param client - Operator client instance
 * @param workspaceId - Workspace ID
 * @param entry - Function entry to upload
 * @param isCreate - Whether this is a create (true) or update (false)
 */
async function uploadFunctionScript(
  client: OperatorClient,
  workspaceId: string,
  entry: FunctionEntry,
  isCreate: boolean,
) {
  const buffer = Buffer.from(entry.scriptContent, "utf-8");

  const info = {
    workspaceId,
    name: entry.name,
    description: entry.description,
    sizeBytes: BigInt(buffer.length),
    contentHash: entry.contentHash,
  };

  if (isCreate) {
    async function* createStream(): AsyncIterable<
      MessageInitShape<typeof CreateFunctionRegistryRequestSchema>
    > {
      yield { payload: { case: "info" as const, value: info } };
      for (let i = 0; i < buffer.length; i += CHUNK_SIZE) {
        yield {
          payload: {
            case: "chunk" as const,
            value: buffer.subarray(i, Math.min(i + CHUNK_SIZE, buffer.length)),
          },
        };
      }
    }
    await client.createFunctionRegistry(createStream());
  } else {
    async function* updateStream(): AsyncIterable<
      MessageInitShape<typeof UpdateFunctionRegistryRequestSchema>
    > {
      yield { payload: { case: "info" as const, value: info } };
      for (let i = 0; i < buffer.length; i += CHUNK_SIZE) {
        yield {
          payload: {
            case: "chunk" as const,
            value: buffer.subarray(i, Math.min(i + CHUNK_SIZE, buffer.length)),
          },
        };
      }
    }
    await client.updateFunctionRegistry(updateStream());
  }
}

/**
 * Apply function registry changes for the given phase.
 * @param client - Operator client instance
 * @param workspaceId
 * @param result - Planned function registry changes
 * @param phase - Apply phase
 */
export async function applyFunctionRegistry(
  client: OperatorClient,
  workspaceId: string,
  result: Awaited<ReturnType<typeof planFunctionRegistry>>,
  phase: Extract<ApplyPhase, "create-update" | "delete"> = "create-update",
) {
  const { changeSet } = result;
  if (phase === "create-update") {
    // Upload new functions
    for (const create of changeSet.creates) {
      await uploadFunctionScript(client, workspaceId, create.entry, true);
      await client.setMetadata(create.metaRequest);
    }

    // Update existing functions
    for (const update of changeSet.updates) {
      await uploadFunctionScript(client, workspaceId, update.entry, false);
      await client.setMetadata(update.metaRequest);
    }
  } else if (phase === "delete") {
    await Promise.all(
      changeSet.deletes.map((del) =>
        client.deleteFunctionRegistry({
          workspaceId: del.workspaceId,
          name: del.name,
        }),
      ),
    );
  }
}
