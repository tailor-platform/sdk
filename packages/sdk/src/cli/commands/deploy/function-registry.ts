import * as crypto from "node:crypto";
import { Code, ConnectError } from "@connectrpc/connect";
import { fetchAll, type OperatorClient } from "@/cli/shared/client";
import { logger } from "@/cli/shared/logger";
import { createChangeSet, type ChangeSet, type HasName } from "./change-set";
import {
  buildMetaRequest,
  hasMatchingSdkVersion,
  isOwnedByApp,
  sdkNameLabelKey,
  type WithLabel,
} from "./label";
import type { OwnerConflict, UnmanagedResource } from "./confirm";
import type { ApplyPhase } from "@/cli/commands/deploy/deploy";
import type { Application } from "@/cli/services/application";
import type { CollectedJob } from "@/cli/services/workflow/service";
import type { MessageInitShape } from "@bufbuild/protobuf";
import type {
  CreateFunctionRegistryRequestSchema,
  UpdateFunctionRegistryRequestSchema,
} from "@tailor-proto/tailor/v1/function_registry_pb";
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

export type FunctionRegistryChangeSet = ChangeSet<CreateFunction, UpdateFunction, DeleteFunction>;

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

export const RESOLVER_PREFIX = "resolver--";
export const EXECUTOR_PREFIX = "executor--";
export const WORKFLOW_PREFIX = "workflow--";
export const AUTH_HOOK_PREFIX = "auth-hook--";

/**
 * Build a function registry name for a resolver.
 * @param namespace - Resolver namespace
 * @param resolverName - Resolver name
 * @returns Function registry name
 */
export function resolverFunctionName(namespace: string, resolverName: string): string {
  return `${RESOLVER_PREFIX}${namespace}--${resolverName}`;
}

/**
 * Build a function registry name for an executor.
 * @param executorName - Executor name
 * @returns Function registry name
 */
export function executorFunctionName(executorName: string): string {
  return `${EXECUTOR_PREFIX}${executorName}`;
}

/**
 * Build a function registry name for a workflow job.
 * @param jobName - Workflow job name
 * @returns Function registry name
 */
export function workflowJobFunctionName(jobName: string): string {
  return `${WORKFLOW_PREFIX}${jobName}`;
}

/**
 * Split function registry changes into grouped buckets by resource-name prefix.
 * @param changeSet - Function registry change set
 * @returns Grouped function registry changes by resource kind
 */
export function splitFunctionRegistryChanges<
  C extends HasName,
  U extends HasName,
  D extends HasName,
  R extends HasName,
>(changeSet: ChangeSet<C, U, D, R>) {
  type Buckets<T> = {
    workflowJob: T[];
    resolver: T[];
    executor: T[];
    authHook: T[];
    other: T[];
  };

  function partition<T extends HasName>(items: ReadonlyArray<T>): Buckets<T> {
    const buckets: Buckets<T> = {
      workflowJob: [],
      resolver: [],
      executor: [],
      authHook: [],
      other: [],
    };
    for (const item of items) {
      if (item.name.startsWith(WORKFLOW_PREFIX)) buckets.workflowJob.push(item);
      else if (item.name.startsWith(RESOLVER_PREFIX)) buckets.resolver.push(item);
      else if (item.name.startsWith(EXECUTOR_PREFIX)) buckets.executor.push(item);
      else if (item.name.startsWith(AUTH_HOOK_PREFIX)) buckets.authHook.push(item);
      else buckets.other.push(item);
    }
    return buckets;
  }

  const creates = partition(changeSet.creates);
  const updates = partition(changeSet.updates);
  const deletes = partition(changeSet.deletes);
  const replaces = partition(changeSet.replaces);
  const unchanged = partition(changeSet.unchanged);

  function collect<K extends keyof Buckets<unknown>>(key: K) {
    return {
      creates: creates[key],
      updates: updates[key],
      deletes: deletes[key],
      replaces: replaces[key],
      unchanged: unchanged[key],
    };
  }

  return {
    workflowJobChanges: collect("workflowJob"),
    resolverFunctionChanges: collect("resolver"),
    executorFunctionChanges: collect("executor"),
    authHookFunctionChanges: collect("authHook"),
    otherChanges: collect("other"),
  };
}

/**
 * Build a function registry name for an auth hook.
 * @param authName - Auth namespace name
 * @param hookPoint - Hook point identifier (e.g. "before-login")
 * @returns Function registry name
 */
export function authHookFunctionName(authName: string, hookPoint: string): string {
  return `auth-hook--${authName}--${hookPoint}`;
}

/**
 * In-memory bundled scripts organized by kind.
 */
export type BundledScripts = {
  resolvers: Map<string, string>;
  executors: Map<string, string>;
  workflowJobs: Map<string, string>;
  authHooks: Map<string, string>;
};

/**
 * Collect all function entries from in-memory bundled scripts for all services.
 * @param application - Application definition
 * @param workflowJobs - Collected workflow jobs from config
 * @param bundledScripts - In-memory bundled code organized by kind
 * @returns Array of function entries to register
 */
export function collectFunctionEntries(
  application: Readonly<Application>,
  workflowJobs: CollectedJob[],
  bundledScripts: BundledScripts,
): FunctionEntry[] {
  const entries: FunctionEntry[] = [];

  // Resolvers
  for (const app of application.applications) {
    for (const pipeline of app.resolverServices) {
      for (const resolver of Object.values(pipeline.resolvers)) {
        const content = bundledScripts.resolvers.get(resolver.name);
        if (!content) {
          logger.warn(`Bundled code not found for resolver: ${resolver.name}`);
          continue;
        }
        entries.push({
          name: resolverFunctionName(pipeline.namespace, resolver.name),
          scriptContent: content,
          contentHash: computeContentHash(content),
          description: `Resolver: ${pipeline.namespace}/${resolver.name}`,
        });
      }
    }
  }

  // Executors
  if (application.executorService) {
    const executors = application.executorService.executors;
    for (const executor of Object.values(executors)) {
      if (executor.operation.kind === "function" || executor.operation.kind === "jobFunction") {
        const content = bundledScripts.executors.get(executor.name);
        if (!content) {
          logger.warn(`Bundled code not found for executor: ${executor.name}`);
          continue;
        }
        entries.push({
          name: executorFunctionName(executor.name),
          scriptContent: content,
          contentHash: computeContentHash(content),
          description: `Executor: ${executor.name}`,
        });
      }
    }
  }

  // Workflow jobs
  for (const job of workflowJobs) {
    const content = bundledScripts.workflowJobs.get(job.name);
    if (!content) {
      logger.warn(`Bundled code not found for workflow job: ${job.name}`);
      continue;
    }
    entries.push({
      name: workflowJobFunctionName(job.name),
      scriptContent: content,
      contentHash: computeContentHash(content),
      description: `Workflow job: ${job.name}`,
    });
  }

  // Auth hooks
  for (const app of application.applications) {
    if (app.authService?.config.hooks?.beforeLogin) {
      const authName = app.authService.config.name;
      const funcName = authHookFunctionName(authName, "before-login");
      const content = bundledScripts.authHooks.get(funcName);
      if (!content) {
        logger.warn(`Bundled code not found for auth hook: ${funcName}`);
        continue;
      }
      entries.push({
        name: funcName,
        scriptContent: content,
        contentHash: computeContentHash(content),
        description: `Auth hook: ${authName}/before-login`,
      });
    }
  }

  return entries;
}

/**
 * Filter collected workflow jobs down to the ones actually bundled.
 * @param jobs - All collected workflow jobs
 * @param usedJobNames - Job names that were bundled
 * @returns Bundled workflow jobs only
 */
export function filterBundledWorkflowJobs(
  jobs: CollectedJob[],
  usedJobNames: readonly string[],
): CollectedJob[] {
  const used = new Set(usedJobNames);
  return jobs.filter((job) => used.has(job.name));
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
 * @param appId - Stable application id (when managed by SDK)
 * @param entries - Desired function entries
 * @returns Planned changes
 */
export async function planFunctionRegistry(
  client: OperatorClient,
  workspaceId: string,
  appName: string,
  appId: string | undefined,
  entries: FunctionEntry[],
) {
  const changeSet: FunctionRegistryChangeSet = createChangeSet<
    CreateFunction,
    UpdateFunction,
    DeleteFunction
  >("Function registry");
  const conflicts: OwnerConflict[] = [];
  const unmanaged: UnmanagedResource[] = [];
  const resourceOwners = new Set<string>();

  // Fetch existing function registry entries
  const existingFunctions = await fetchAll(async (pageToken, maxPageSize) => {
    try {
      const response = await client.listFunctionRegistries({
        workspaceId,
        pageToken,
        pageSize: maxPageSize,
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
        allLabels: metadata?.labels,
      };
    }),
  );

  // Process desired entries
  for (const entry of entries) {
    const existing = existingMap[entry.name];
    const metaRequest = await buildMetaRequest({
      trn: functionRegistryTrn(workspaceId, entry.name),
      appName,
      appId,
    });

    if (existing) {
      const owned = isOwnedByApp(existing.allLabels, appName, appId);
      if (!owned) {
        if (!existing.label) {
          unmanaged.push({
            resourceType: "Function registry",
            resourceName: entry.name,
          });
        } else {
          conflicts.push({
            resourceType: "Function registry",
            resourceName: entry.name,
            currentOwner: existing.label,
          });
        }
      }

      if (
        existing.resource.contentHash === entry.contentHash &&
        owned &&
        hasMatchingSdkVersion(existing.allLabels, metaRequest.labels)
      ) {
        changeSet.unchanged.push({
          name: entry.name,
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
    const owned = isOwnedByApp(existing.allLabels, appName, appId);
    if (label && !owned) {
      resourceOwners.add(label);
    }
    if (owned) {
      changeSet.deletes.push({
        name,
        workspaceId,
      });
    }
  }

  const {
    workflowJobChanges,
    resolverFunctionChanges,
    executorFunctionChanges,
    authHookFunctionChanges,
  } = splitFunctionRegistryChanges(changeSet);
  return {
    changeSet,
    workflowJobChanges,
    resolverFunctionChanges,
    executorFunctionChanges,
    authHookFunctionChanges,
    conflicts,
    unmanaged,
    resourceOwners,
  };
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
    /** @yields {MessageInitShape<typeof CreateFunctionRegistryRequestSchema>} Create request messages (info header followed by content chunks) */
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
    /** @yields {MessageInitShape<typeof UpdateFunctionRegistryRequestSchema>} Update request messages (info header followed by content chunks) */
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
 * @param workspaceId - Workspace ID
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

    // Update existing functions (server deduplicates content by hash)
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
