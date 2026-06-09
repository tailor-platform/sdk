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
import type { ApplyPhase } from "./phase";
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
  metaRequest: MessageInitShape<typeof SetMetadataRequestSchema>;
};

type UpdateConnection = {
  name: string;
  metaRequest: MessageInitShape<typeof SetMetadataRequestSchema>;
};

type ReplaceConnection = {
  name: string;
  revokeRequest: MessageInitShape<typeof RevokeAuthConnectionRequestSchema>;
  createRequest: MessageInitShape<typeof CreateAuthConnectionRequestSchema>;
  metaRequest: MessageInitShape<typeof SetMetadataRequestSchema>;
};

type DeleteConnection = {
  name: string;
  request: MessageInitShape<typeof RevokeAuthConnectionRequestSchema>;
};

function connectionTrn(workspaceId: string, name: string) {
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
  const changeSet = createChangeSet<
    CreateConnection,
    UpdateConnection,
    DeleteConnection,
    ReplaceConnection
  >("Auth connections");
  const conflicts: OwnerConflict[] = [];
  const unmanaged: UnmanagedResource[] = [];
  const resourceOwners = new Set<string>();

  const desiredConnections: Record<string, AuthConnectionConfig> = {};
  for (const auth of auths) {
    if (auth.connections) {
      for (const [name, config] of Object.entries(auth.connections)) {
        desiredConnections[name] = config;
      }
    }
  }

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

  const existingConnections: WithLabel<AuthConnection> = {};
  await Promise.all(
    existingList.map(async (resource) => {
      const { metadata } = await client.getMetadata({
        trn: connectionTrn(workspaceId, resource.name),
      });
      existingConnections[resource.name] = {
        resource,
        label: metadata?.labels[sdkNameLabelKey],
        allLabels: metadata?.labels,
      };
    }),
  );

  const state = loadSecretsState();

  for (const [name, config] of Object.entries(desiredConnections)) {
    const existing = existingConnections[name];
    const metaRequest = await buildMetaRequest({
      trn: connectionTrn(workspaceId, name),
      appName,
      appId,
    });

    if (existing) {
      const owned = isOwnedByApp(existing.allLabels, appName, appId);
      if (!owned) {
        if (existing.label) {
          conflicts.push({
            resourceType: "Auth connection",
            resourceName: name,
            currentOwner: existing.label,
          });
        } else {
          unmanaged.push({
            resourceType: "Auth connection",
            resourceName: name,
          });
        }
      }

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
      } else if (!existing.label) {
        // The connection itself is unchanged, but it carries no SDK label
        // (e.g. it was just adopted via the unmanaged-resource confirmation,
        // or created by an older SDK that predates ownership labels). Write
        // the label now so the next deploy recognizes it as owned.
        changeSet.updates.push({ name, metaRequest });
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

  for (const [name, entry] of Object.entries(existingConnections)) {
    if (!entry) continue;
    const owned = isOwnedByApp(entry.allLabels, appName, appId);
    if (entry.label && !owned) {
      resourceOwners.add(entry.label);
      continue;
    }
    // Only delete connections we own. Connections without our label are
    // treated as unowned and left untouched, even if the local secrets-state
    // happens to track them.
    if (owned) {
      changeSet.deletes.push({
        name,
        request: { workspaceId, connectionName: name },
      });
    }
  }

  return { changeSet, conflicts, unmanaged, resourceOwners };
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
    await Promise.all(
      changeSet.creates.map(async (create) => {
        await client.createAuthConnection(create.request);
        await client.setMetadata(create.metaRequest);
      }),
    );

    for (const replace of changeSet.replaces) {
      await client.revokeAuthConnection(replace.revokeRequest);
      await client.createAuthConnection(replace.createRequest);
      await client.setMetadata(replace.metaRequest);
    }

    // Metadata-only updates: backfill the SDK ownership label on connections
    // whose configuration is otherwise unchanged.
    await Promise.all(
      changeSet.updates.map(async (update) => {
        await client.setMetadata(update.metaRequest);
      }),
    );

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
    await Promise.all(
      changeSet.deletes.map(async (del) => {
        await client.revokeAuthConnection(del.request);
      }),
    );

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
