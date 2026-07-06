import { type MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import {
  AuthConnection_Status,
  AuthConnection_Type,
} from "@tailor-platform/tailor-proto/auth_resource_pb";
import { type AuthService } from "#/cli/services/auth/service";
import { fetchAll, type OperatorClient } from "#/cli/shared/client";
import { logger } from "#/cli/shared/logger";
import { createChangeSet } from "./change-set";
import { buildMetaRequest, resourceTrn, sdkNameLabelKey, type WithLabel } from "./label";
import { trackDesiredResourceOwnership, trackRemainingResourceOwner } from "./owned-resource";
import { hashValue, loadSecretsState, saveSecretsState } from "./secrets-state";
import type { AuthConnectionConfig } from "#/types/auth-connection.generated";
import type { OwnerConflict, UnmanagedResource } from "./confirm";
import type { ApplyPhase } from "./phase";
import type {
  CreateAuthConnectionRequestSchema,
  DeleteAuthConnectionRequestSchema,
  UpdateAuthConnectionRequestSchema,
} from "@tailor-platform/tailor-proto/auth_pb";
import type { AuthConnection } from "@tailor-platform/tailor-proto/auth_resource_pb";
import type { SetMetadataRequestSchema } from "@tailor-platform/tailor-proto/metadata_pb";

type CreateConnection = {
  name: string;
  request: MessageInitShape<typeof CreateAuthConnectionRequestSchema>;
  metaRequest: MessageInitShape<typeof SetMetadataRequestSchema>;
};

type UpdateConnection = {
  name: string;
  metaRequest: MessageInitShape<typeof SetMetadataRequestSchema>;
};

type MaskedUpdateConnection = {
  name: string;
  updateRequest: MessageInitShape<typeof UpdateAuthConnectionRequestSchema>;
  metaRequest: MessageInitShape<typeof SetMetadataRequestSchema>;
};

type DeleteConnection = {
  name: string;
  request: MessageInitShape<typeof DeleteAuthConnectionRequestSchema>;
};

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

function buildUpdateMask(
  existing: AuthConnection,
  desired: AuthConnectionConfig,
  secretChanged: boolean,
): { paths: string[] } {
  if (existing.config.case !== "oauth2") {
    const paths = [
      "type",
      "oauth2.provider_url",
      "oauth2.issuer_url",
      "oauth2.client_id",
      "oauth2.auth_url",
      "oauth2.token_url",
    ];
    if (desired.clientSecret) paths.push("oauth2.client_secret");
    return { paths };
  }
  // The SDK only creates OAUTH2 connections, so no type change is possible here.
  const paths: string[] = [];
  const v = existing.config.value;
  if (v.providerUrl !== desired.providerUrl) paths.push("oauth2.provider_url");
  if (v.issuerUrl !== desired.issuerUrl) paths.push("oauth2.issuer_url");
  if (v.clientId !== desired.clientId) paths.push("oauth2.client_id");
  if (v.authUrl !== (desired.authUrl ?? "")) paths.push("oauth2.auth_url");
  if (v.tokenUrl !== (desired.tokenUrl ?? "")) paths.push("oauth2.token_url");
  if (secretChanged && desired.clientSecret) paths.push("oauth2.client_secret");
  return { paths };
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
    MaskedUpdateConnection
  >("Auth connections");
  const conflicts: OwnerConflict[] = [];
  const unmanaged: UnmanagedResource[] = [];
  const resourceOwners = new Set<string>();

  const desiredConnections: Record<string, AuthConnectionConfig> = {};
  for (const auth of auths) {
    for (const [name, config] of Object.entries(auth.connections)) {
      desiredConnections[name] = config;
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
        trn: resourceTrn(workspaceId, "auth_connection", resource.name),
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
      trn: resourceTrn(workspaceId, "auth_connection", name),
      appName,
      appId,
    });

    if (existing) {
      trackDesiredResourceOwnership({
        labels: existing.allLabels,
        ownerLabel: existing.label,
        appName,
        appId,
        resourceType: "Auth connection",
        resourceName: name,
        conflicts,
        unmanaged,
      });

      const currentHash = hashValue(config.clientSecret);
      const storedHash = state.connections?.[name];
      const secretChanged = currentHash !== storedHash;
      const updateMask = buildUpdateMask(existing.resource, config, secretChanged);

      if (updateMask.paths.length > 0) {
        changeSet.replaces.push({
          name,
          updateRequest: {
            ...buildConnectionRequest(workspaceId, name, config),
            updateMask,
          } as MessageInitShape<typeof UpdateAuthConnectionRequestSchema>,
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
    const owned = trackRemainingResourceOwner({
      labels: entry.allLabels,
      ownerLabel: entry.label,
      appName,
      appId,
      resourceOwners,
    });
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
        logger.info(
          `Connection "${create.name}" was created. Authorize it with:\n` +
            `  tailor authconnection authorize --name ${create.name}\n` +
            `Or via the Console: tailor authconnection open`,
        );
      }),
    );

    for (const replace of changeSet.replaces) {
      const resp = await client.updateAuthConnection(replace.updateRequest);
      if (resp.connection?.status === AuthConnection_Status.UNAUTHORIZED) {
        logger.warn(
          `Connection "${replace.name}" requires re-authorization. Authorize with:\n` +
            `  tailor authconnection authorize --name ${replace.name}\n` +
            `Or via the Console: tailor authconnection open`,
        );
      }
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
      const conn = create.request.connection;
      if (conn?.config?.case === "oauth2") {
        state.connections[create.name] = hashValue(conn.config.value.clientSecret ?? "");
      }
    }
    for (const replace of changeSet.replaces) {
      const conn = replace.updateRequest.connection;
      if (
        conn?.config?.case === "oauth2" &&
        replace.updateRequest.updateMask?.paths?.includes("oauth2.client_secret")
      ) {
        state.connections[replace.name] = hashValue(conn.config.value.clientSecret ?? "");
      }
    }
    saveSecretsState(state);
  } else {
    await Promise.all(
      changeSet.deletes.map(async (del) => {
        await client.deleteAuthConnection(del.request);
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
