import { type MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { AuthConnection_Type } from "@tailor-proto/tailor/v1/auth_resource_pb";
import { type AuthService } from "@/cli/services/auth/service";
import { fetchAll, type OperatorClient } from "@/cli/shared/client";
import { createChangeSet } from "./change-set";
import {
  buildMetaRequest,
  isOwnedByApp,
  sdkNameLabelKey,
  trnPrefix,
  type WithLabel,
} from "./label";
import { hashValue, loadSecretsState, saveSecretsState } from "./secrets-state";
import type { OwnerConflict, UnmanagedResource } from "./confirm";
import type { ApplyPhase } from "@/cli/commands/deploy/deploy";
import type { AuthConnectionConfig } from "@/types/auth-connection.generated";
import type {
  CreateAuthConnectionRequestSchema,
  RevokeAuthConnectionRequestSchema,
} from "@tailor-proto/tailor/v1/auth_pb";
import type { AuthConnection } from "@tailor-proto/tailor/v1/auth_resource_pb";
import type { SetMetadataRequestSchema } from "@tailor-proto/tailor/v1/metadata_pb";

type CreateConnection = {
  name: string;
  request: MessageInitShape<typeof CreateAuthConnectionRequestSchema>;
  metaRequest?: MessageInitShape<typeof SetMetadataRequestSchema>;
};

type ReplaceConnection = {
  name: string;
  revokeRequest: MessageInitShape<typeof RevokeAuthConnectionRequestSchema>;
  createRequest: MessageInitShape<typeof CreateAuthConnectionRequestSchema>;
  metaRequest?: MessageInitShape<typeof SetMetadataRequestSchema>;
};

type DeleteConnection = {
  name: string;
  request: MessageInitShape<typeof RevokeAuthConnectionRequestSchema>;
};

function connectionTrn(workspaceId: string, name: string) {
  // Auth connections are workspace-level; the platform expects the `auth_connection`
  // TRN segment (underscore), consistent with other auth resource type names.
  return `${trnPrefix(workspaceId)}:auth_connection:${name}`;
}

function buildConnectionRequest(
  workspaceId: string,
  name: string,
  config: AuthConnectionConfig,
): MessageInitShape<typeof CreateAuthConnectionRequestSchema> {
  return {
    workspaceId,
    connection: {
      name,
      type: AuthConnection_Type.OAUTH2,
      config: {
        case: "oauth2",
        value: {
          providerUrl: config.providerUrl,
          issuerUrl: config.issuerUrl,
          clientId: config.clientId,
          clientSecret: config.clientSecret,
          authUrl: config.authUrl ?? "",
          tokenUrl: config.tokenUrl ?? "",
        },
      },
    },
  };
}

/**
 * Compute a hash of the full connection config for change detection.
 * @param config - Auth connection config
 * @returns SHA-256 hex digest
 */
function hashConnectionConfig(config: AuthConnectionConfig): string {
  const serialized = JSON.stringify({
    type: config.type,
    providerUrl: config.providerUrl,
    issuerUrl: config.issuerUrl,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    authUrl: config.authUrl ?? "",
    tokenUrl: config.tokenUrl ?? "",
  });
  return hashValue(serialized);
}

/**
 * Check whether the non-secret fields of an existing connection differ from the desired config.
 * @param existing - Existing connection from the server
 * @param desired - Desired connection config
 * @returns true if any non-secret field has changed
 */
function hasNonSecretFieldChanged(
  existing: AuthConnection,
  desired: AuthConnectionConfig,
): boolean {
  if (existing.config.case !== "oauth2") {
    return true;
  }
  const oauth2 = existing.config.value;
  return (
    oauth2.providerUrl !== desired.providerUrl ||
    oauth2.issuerUrl !== desired.issuerUrl ||
    oauth2.clientId !== desired.clientId ||
    oauth2.authUrl !== (desired.authUrl ?? "") ||
    oauth2.tokenUrl !== (desired.tokenUrl ?? "")
  );
}

/**
 * Plan auth connection changes based on current and desired state.
 * @param client - Operator client instance
 * @param workspaceId - Workspace ID
 * @param appName - Application name for ownership
 * @param appId - Stable application id (when managed by SDK)
 * @param auths - Auth services with connection configs
 * @returns Planned changes for auth connections
 */
export async function planAuthConnections(
  client: OperatorClient,
  workspaceId: string,
  appName: string,
  appId: string | undefined,
  auths: ReadonlyArray<Readonly<AuthService>>,
) {
  const changeSet = createChangeSet<CreateConnection, never, DeleteConnection, ReplaceConnection>(
    "Auth connections",
  );
  const conflicts: OwnerConflict[] = [];
  const unmanaged: UnmanagedResource[] = [];
  const resourceOwners = new Set<string>();

  // Collect all desired connections from auth services
  const desiredConnections: Record<string, AuthConnectionConfig> = {};
  for (const auth of auths) {
    if (auth.connections) {
      for (const [name, config] of Object.entries(auth.connections)) {
        desiredConnections[name] = config;
      }
    }
  }

  // Fetch existing connections
  const existingList = await fetchAll(async (pageToken, maxPageSize) => {
    try {
      const { connections, nextPageToken } = await client.listAuthConnections({
        workspaceId,
        pageToken,
        pageSize: maxPageSize,
      });
      return [connections, nextPageToken];
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.NotFound) {
        return [[], ""];
      }
      throw error;
    }
  });

  // Build existing map with labels
  // Note: metadata/labels for auth connections may not be supported yet by the platform.
  // When getMetadata fails with InvalidArgument, we skip label-based ownership tracking.
  const existingConnections: WithLabel<AuthConnection> = {};
  let metadataSupported = true;
  await Promise.all(
    existingList.map(async (resource) => {
      try {
        const { metadata } = await client.getMetadata({
          trn: connectionTrn(workspaceId, resource.name),
        });
        existingConnections[resource.name] = {
          resource,
          label: metadata?.labels[sdkNameLabelKey],
          allLabels: metadata?.labels,
        };
      } catch (error) {
        if (error instanceof ConnectError && error.code === Code.InvalidArgument) {
          metadataSupported = false;
          existingConnections[resource.name] = {
            resource,
            label: undefined,
          };
        } else {
          throw error;
        }
      }
    }),
  );

  const state = loadSecretsState();

  // Diff desired vs existing
  for (const [name, config] of Object.entries(desiredConnections)) {
    const existing = existingConnections[name];
    const metaRequest = metadataSupported
      ? await buildMetaRequest({
          trn: connectionTrn(workspaceId, name),
          appName,
          appId,
        })
      : undefined;

    if (existing) {
      const owned = isOwnedByApp(existing.allLabels, appName, appId);
      if (!owned) {
        if (metadataSupported && !existing.label) {
          unmanaged.push({
            resourceType: "Auth connection",
            resourceName: name,
          });
        } else if (existing.label) {
          conflicts.push({
            resourceType: "Auth connection",
            resourceName: name,
            currentOwner: existing.label,
          });
        }
      }

      // Check if config has changed
      const currentHash = hashConnectionConfig(config);
      const storedHash = state.connections?.[name];
      const nonSecretChanged = hasNonSecretFieldChanged(existing.resource, config);
      const secretChanged = currentHash !== storedHash;

      if (nonSecretChanged || secretChanged) {
        changeSet.replaces.push({
          name,
          revokeRequest: { workspaceId, connectionName: name },
          createRequest: buildConnectionRequest(workspaceId, name, config),
          metaRequest,
        });
      } else {
        changeSet.unchanged.push({ name });
      }
      delete existingConnections[name];
    } else {
      changeSet.creates.push({
        name,
        request: buildConnectionRequest(workspaceId, name, config),
        metaRequest,
      });
    }
  }

  // Remaining existing connections owned by this app should be deleted
  for (const [name, entry] of Object.entries(existingConnections)) {
    if (!entry) continue;
    const owned = isOwnedByApp(entry.allLabels, appName, appId);
    if (entry.label && !owned) {
      resourceOwners.add(entry.label);
      continue;
    }
    // Decide whether to delete:
    // - When metadata is supported, ownership is authoritative via labels: delete
    //   only connections owned by this app.
    // - When metadata is NOT supported (older platforms), labels are unavailable.
    //   Deleting everything not desired would destroy connections created outside the
    //   SDK (e.g. Terraform/console), so fall back to the local secrets-state and
    //   delete only connections this SDK previously created.
    const shouldDelete = metadataSupported ? owned : state.connections?.[name] !== undefined;
    if (shouldDelete) {
      changeSet.deletes.push({
        name,
        request: { workspaceId, connectionName: name },
      });
    }
  }

  return { changeSet, conflicts, unmanaged, resourceOwners };
}

/**
 * Attempt to set metadata, silently ignoring InvalidArgument errors
 * when the platform does not yet support auth-connection TRNs.
 * @param client - Operator client instance
 * @param metaRequest - Metadata request to send
 */
async function trySetMetadata(
  client: OperatorClient,
  metaRequest: MessageInitShape<typeof SetMetadataRequestSchema>,
): Promise<void> {
  try {
    await client.setMetadata(metaRequest);
  } catch (error) {
    if (error instanceof ConnectError && error.code === Code.InvalidArgument) {
      return;
    }
    throw error;
  }
}

function extractOAuth2Config(
  connection: MessageInitShape<typeof CreateAuthConnectionRequestSchema>["connection"],
): AuthConnectionConfig | undefined {
  if (!connection) return undefined;
  const config = connection.config;
  if (!config || config.case !== "oauth2" || !config.value) return undefined;
  const v = config.value;
  return {
    type: "oauth2",
    providerUrl: (v.providerUrl as string) ?? "",
    issuerUrl: (v.issuerUrl as string) ?? "",
    clientId: (v.clientId as string) ?? "",
    clientSecret: (v.clientSecret as string) ?? "",
    authUrl: (v.authUrl as string) || undefined,
    tokenUrl: (v.tokenUrl as string) || undefined,
  };
}

/**
 * Apply auth connection changes for the given phase.
 * @param client - Operator client instance
 * @param result - Planned auth connection changes
 * @param phase - Apply phase
 */
export async function applyAuthConnections(
  client: OperatorClient,
  result: Awaited<ReturnType<typeof planAuthConnections>>,
  phase: Exclude<ApplyPhase, "delete-services">,
) {
  const { changeSet } = result;

  if (phase === "create-update") {
    // Creates
    await Promise.all(
      changeSet.creates.map(async (create) => {
        await client.createAuthConnection(create.request);
        if (create.metaRequest) {
          await trySetMetadata(client, create.metaRequest);
        }
      }),
    );

    // Replaces (revoke then create, sequentially per connection)
    for (const replace of changeSet.replaces) {
      await client.revokeAuthConnection(replace.revokeRequest);
      await client.createAuthConnection(replace.createRequest);
      if (replace.metaRequest) {
        await trySetMetadata(client, replace.metaRequest);
      }
    }

    // Save hashes for all created/replaced connections
    const state = loadSecretsState();
    if (!state.connections) {
      state.connections = {};
    }
    for (const create of changeSet.creates) {
      const oauth2 = extractOAuth2Config(create.request.connection);
      if (oauth2) {
        state.connections[create.name] = hashConnectionConfig(oauth2);
      }
    }
    for (const replace of changeSet.replaces) {
      const oauth2 = extractOAuth2Config(replace.createRequest.connection);
      if (oauth2) {
        state.connections[replace.name] = hashConnectionConfig(oauth2);
      }
    }
    saveSecretsState(state);
  } else if (phase === "delete-resources" || phase === "delete") {
    // Revoke deleted connections
    await Promise.all(
      changeSet.deletes.map(async (del) => {
        await client.revokeAuthConnection(del.request);
      }),
    );

    // Remove hashes for deleted connections
    if (changeSet.deletes.length > 0) {
      const state = loadSecretsState();
      if (state.connections) {
        for (const del of changeSet.deletes) {
          delete state.connections[del.name];
        }
        saveSecretsState(state);
      }
    }
  }
}
