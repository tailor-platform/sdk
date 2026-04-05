import * as crypto from "node:crypto";
import { Code, ConnectError } from "@connectrpc/connect";
import { fetchAll, type OperatorClient } from "@/cli/shared/client";
import { logger } from "@/cli/shared/logger";
import { createChangeSet, type ChangeSet, type HasName } from "./change-set";
import { formatChangeSetEntries, printGroupedDisplaySection } from "./grouped-display";
import { buildMetaRequest, hasMatchingSdkVersion, sdkNameLabelKey, type WithLabel } from "./label";
import type { OwnerConflict, UnmanagedResource } from "./confirm";
import type { ApplyPhase } from "@/cli/commands/apply/apply";
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
 * Check whether a function registry entry belongs to a workflow job.
 * @param name - Function registry entry name
 * @returns True when the entry is a workflow job function
 */
export function isWorkflowJobFunctionName(name: string): boolean {
  return name.startsWith("workflow--");
}

/**
 * Check whether a function registry entry belongs to a resolver.
 * @param name - Function registry entry name
 * @returns True when the entry is a resolver function
 */
export function isResolverFunctionName(name: string): boolean {
  return name.startsWith("resolver--");
}

/**
 * Check whether a function registry entry belongs to an executor.
 * @param name - Function registry entry name
 * @returns True when the entry is an executor function
 */
export function isExecutorFunctionName(name: string): boolean {
  return name.startsWith("executor--");
}

/**
 * Check whether a function registry entry belongs to an auth hook.
 * @param name - Function registry entry name
 * @returns True when the entry is an auth hook function
 */
export function isAuthHookFunctionName(name: string): boolean {
  return name.startsWith("auth-hook--");
}

/**
 * Partition function registry entries by known resource-name prefixes.
 * @param items - Function registry entries to partition
 * @returns Partitioned entries by resource kind
 */
function partitionByPrefix<T extends HasName>(items: ReadonlyArray<T>) {
  const workflowJob: T[] = [];
  const resolver: T[] = [];
  const executor: T[] = [];
  const authHook: T[] = [];
  const other: T[] = [];

  for (const item of items) {
    if (isWorkflowJobFunctionName(item.name)) {
      workflowJob.push(item);
    } else if (isResolverFunctionName(item.name)) {
      resolver.push(item);
    } else if (isExecutorFunctionName(item.name)) {
      executor.push(item);
    } else if (isAuthHookFunctionName(item.name)) {
      authHook.push(item);
    } else {
      other.push(item);
    }
  }

  return { workflowJob, resolver, executor, authHook, other };
}

/**
 * Split function registry changes into grouped buckets for dry-run display.
 * @param changeSet - Function registry change set
 * @returns Grouped function registry changes by resource kind
 */
export function splitFunctionRegistryChanges<
  C extends HasName,
  U extends HasName,
  D extends HasName,
  R extends HasName,
>(changeSet: ChangeSet<C, U, D, R>) {
  const creates = partitionByPrefix(changeSet.creates);
  const updates = partitionByPrefix(changeSet.updates);
  const deletes = partitionByPrefix(changeSet.deletes);
  const replaces = partitionByPrefix(changeSet.replaces);
  const unchanged = partitionByPrefix(changeSet.unchanged);

  const workflowJobChanges = {
    creates: creates.workflowJob,
    updates: updates.workflowJob,
    deletes: deletes.workflowJob,
    replaces: replaces.workflowJob,
    unchanged: unchanged.workflowJob,
  };
  const resolverFunctionChanges = {
    creates: creates.resolver,
    updates: updates.resolver,
    deletes: deletes.resolver,
    replaces: replaces.resolver,
    unchanged: unchanged.resolver,
  };
  const executorFunctionChanges = {
    creates: creates.executor,
    updates: updates.executor,
    deletes: deletes.executor,
    replaces: replaces.executor,
    unchanged: unchanged.executor,
  };
  const authHookFunctionChanges = {
    creates: creates.authHook,
    updates: updates.authHook,
    deletes: deletes.authHook,
    replaces: replaces.authHook,
    unchanged: unchanged.authHook,
  };

  const otherChanges = {
    creates: creates.other,
    updates: updates.other,
    deletes: deletes.other,
    replaces: replaces.other,
    unchanged: unchanged.other,
  };

  return {
    workflowJobChanges,
    resolverFunctionChanges,
    executorFunctionChanges,
    authHookFunctionChanges,
    otherChanges,
  };
}

function printOtherFunctionRegistryChanges(
  changeSet: Pick<
    FunctionRegistryChangeSet,
    "title" | "creates" | "updates" | "deletes" | "replaces"
  >,
) {
  printGroupedDisplaySection(changeSet.title, formatChangeSetEntries(changeSet));
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
 * @param entries - Desired function entries
 * @returns Planned changes
 */
export async function planFunctionRegistry(
  client: OperatorClient,
  workspaceId: string,
  appName: string,
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
    const metaRequest = await buildMetaRequest(
      functionRegistryTrn(workspaceId, entry.name),
      appName,
    );

    if (existing) {
      const isManagedByApp = existing.label === appName;
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

      if (
        existing.resource.contentHash === entry.contentHash &&
        isManagedByApp &&
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

  const {
    workflowJobChanges,
    resolverFunctionChanges,
    executorFunctionChanges,
    authHookFunctionChanges,
    otherChanges,
  } = splitFunctionRegistryChanges(changeSet);
  printOtherFunctionRegistryChanges({
    title: changeSet.title,
    creates: otherChanges.creates,
    updates: otherChanges.updates,
    deletes: otherChanges.deletes,
    replaces: otherChanges.replaces,
  });
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
