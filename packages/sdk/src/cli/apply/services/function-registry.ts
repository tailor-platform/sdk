import * as fs from "node:fs";
import { type MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import {
  type CreateFunctionRegistryRequestSchema,
  type DeleteFunctionRegistryRequestSchema,
  type UpdateFunctionRegistryRequestSchema,
} from "@tailor-proto/tailor/v1/function_registry_pb";
import { type OperatorClient, fetchAll } from "../../client";
import { buildMetaRequest, sdkNameLabelKey, type WithLabel } from "./label";
import { createChangeSet } from ".";
import type { ApplyPhase, PlanContext } from "..";
import type { OwnerConflict, UnmanagedResource } from "./confirm";
import type { BundledFunction } from "@/cli/bundler/function-registry/function-registry-bundler";
import type { SetMetadataRequestSchema } from "@tailor-proto/tailor/v1/metadata_pb";

const CHUNK_SIZE = 64 * 1024; // 64KB chunks

// Streaming upload requires building messages on-the-fly
// Store bundled and workspaceId to generate streaming messages
type CreateFunction = {
  name: string;
  workspaceId: string;
  bundled: BundledFunction;
  metaRequest: MessageInitShape<typeof SetMetadataRequestSchema>;
};

type UpdateFunction = {
  name: string;
  workspaceId: string;
  bundled: BundledFunction;
  metaRequest: MessageInitShape<typeof SetMetadataRequestSchema>;
};

type DeleteFunction = {
  name: string;
  request: MessageInitShape<typeof DeleteFunctionRegistryRequestSchema>;
};

function trn(workspaceId: string, name: string) {
  return `trn:v1:workspace:${workspaceId}:function_registry:${name}`;
}

/**
 * Apply function registry changes for the given phase.
 * @param client - Operator client instance
 * @param result - Planned function registry changes
 * @param phase - Apply phase (defaults to "create-update")
 * @returns Promise that resolves when function registries are applied
 */
export async function applyFunctionRegistry(
  client: OperatorClient,
  result: Awaited<ReturnType<typeof planFunctionRegistry>>,
  phase: Extract<ApplyPhase, "create-update" | "delete"> = "create-update",
) {
  const { changeSet } = result;

  if (phase === "create-update") {
    await Promise.all([
      ...changeSet.creates.map(async (create) => {
        await streamingCreateFunction(client, create);
        await client.setMetadata(create.metaRequest);
      }),
      ...changeSet.updates.map(async (update) => {
        await streamingUpdateFunction(client, update);
        await client.setMetadata(update.metaRequest);
      }),
    ]);
  } else if (phase === "delete") {
    await Promise.all(changeSet.deletes.map((del) => client.deleteFunctionRegistry(del.request)));
  }
}

/**
 * Stream upload a new function to the registry.
 * Uses fs.createReadStream to avoid loading entire file into memory.
 * @param client - The operator client for API communication
 * @param create - The function creation request details
 */
async function streamingCreateFunction(client: OperatorClient, create: CreateFunction) {
  const { workspaceId, bundled } = create;

  /** @yields {MessageInitShape} Request messages for function creation */
  async function* generateRequests(): AsyncIterable<
    MessageInitShape<typeof CreateFunctionRegistryRequestSchema>
  > {
    // First message: metadata (sizeBytes and contentHash are pre-computed)
    yield {
      payload: {
        case: "info",
        value: {
          workspaceId,
          name: bundled.name,
          description: "",
          sizeBytes: BigInt(bundled.sizeBytes),
          contentHash: bundled.contentHash,
        },
      },
    };

    // Subsequent messages: stream file chunks without loading entire file
    const stream = fs.createReadStream(bundled.scriptPath, { highWaterMark: CHUNK_SIZE });
    for await (const chunk of stream) {
      yield {
        payload: {
          case: "chunk",
          value: chunk as Uint8Array,
        },
      };
    }
  }

  await client.createFunctionRegistry(generateRequests());
}

/**
 * Stream upload an updated function to the registry.
 * Uses fs.createReadStream to avoid loading entire file into memory.
 * @param client - The operator client for API communication
 * @param update - The function update request details
 */
async function streamingUpdateFunction(client: OperatorClient, update: UpdateFunction) {
  const { workspaceId, bundled } = update;

  /** @yields {MessageInitShape} Request messages for function update */
  async function* generateRequests(): AsyncIterable<
    MessageInitShape<typeof UpdateFunctionRegistryRequestSchema>
  > {
    // First message: metadata
    yield {
      payload: {
        case: "info",
        value: {
          workspaceId,
          name: bundled.name,
          description: "",
          sizeBytes: BigInt(bundled.sizeBytes),
          contentHash: bundled.contentHash,
        },
      },
    };

    // Subsequent messages: stream file chunks
    const stream = fs.createReadStream(bundled.scriptPath, { highWaterMark: CHUNK_SIZE });
    for await (const chunk of stream) {
      yield {
        payload: {
          case: "chunk",
          value: chunk as Uint8Array,
        },
      };
    }
  }

  await client.updateFunctionRegistry(generateRequests());
}

/**
 * Plan function registry changes based on current and desired state.
 * @param context - Planning context
 * @param bundledFunctions - Array of bundled functions to plan
 * @returns Planned changes
 */
export async function planFunctionRegistry(
  context: PlanContext,
  bundledFunctions: BundledFunction[],
) {
  const { client, workspaceId, application, forRemoval } = context;
  const changeSet = createChangeSet<CreateFunction, UpdateFunction, DeleteFunction>("Functions");
  const conflicts: OwnerConflict[] = [];
  const unmanaged: UnmanagedResource[] = [];
  const resourceOwners = new Set<string>();

  // Fetch existing functions
  const withoutLabel = await fetchAll(async (pageToken) => {
    try {
      const { functions, nextPageToken } = await client.listFunctionRegistries({
        workspaceId,
        pageToken,
      });
      return [functions, nextPageToken];
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.NotFound) {
        return [[], ""];
      }
      throw error;
    }
  });

  const existingFunctions: WithLabel<(typeof withoutLabel)[number]> = {};
  await Promise.all(
    withoutLabel.map(async (resource) => {
      const { metadata } = await client.getMetadata({
        trn: trn(workspaceId, resource.name),
      });
      existingFunctions[resource.name] = {
        resource,
        label: metadata?.labels[sdkNameLabelKey],
      };
    }),
  );

  const desiredFunctions = forRemoval ? [] : bundledFunctions;

  for (const bundled of desiredFunctions) {
    const existing = existingFunctions[bundled.name];
    const metaRequest = await buildMetaRequest(trn(workspaceId, bundled.name), application.name);

    if (existing) {
      if (!existing.label) {
        unmanaged.push({
          resourceType: "FunctionRegistry",
          resourceName: bundled.name,
        });
      } else if (existing.label !== application.name) {
        conflicts.push({
          resourceType: "FunctionRegistry",
          resourceName: bundled.name,
          currentOwner: existing.label,
        });
      }

      if (existing.resource.contentHash !== bundled.contentHash) {
        changeSet.updates.push({ name: bundled.name, workspaceId, bundled, metaRequest });
      }
      delete existingFunctions[bundled.name];
    } else {
      changeSet.creates.push({ name: bundled.name, workspaceId, bundled, metaRequest });
    }
  }

  Object.entries(existingFunctions).forEach(([name, existing]) => {
    const label = existing?.label;
    if (label && label !== application.name) {
      resourceOwners.add(label);
    }
    if (label === application.name) {
      changeSet.deletes.push({
        name,
        request: { workspaceId, name },
      });
    }
  });

  changeSet.print();
  return { changeSet, conflicts, unmanaged, resourceOwners };
}
