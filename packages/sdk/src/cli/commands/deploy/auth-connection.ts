import { type MessageInitShape } from "@bufbuild/protobuf";
import {
  AuthConnection_Status,
  AuthConnection_Type,
} from "@tailor-platform/tailor-proto/auth_resource_pb";
import { partition } from "es-toolkit";
import { type AuthService } from "#/cli/services/auth/service";
import { fetchAllTolerant, type OperatorClient } from "#/cli/shared/client";
import { logger } from "#/cli/shared/logger";
import { createChangeSet } from "./change-set";
import {
  buildMetaRequest,
  type MetadataLabelWrite,
  resourceTrn,
  type WithLabel,
  writeMetadataLabels,
} from "./label";
import { createOwnershipTracker } from "./owned-resource";
import {
  hashValue,
  loadSecretsState,
  saveSecretsState,
  withSecretsStateLock,
  type SecretsStateScope,
} from "./secrets-state";
import type { AuthConnectionConfig } from "#/types/auth-connection.generated";
import type { ApplyPhase } from "./phase";
import type {
  CreateAuthConnectionRequestSchema,
  DeleteAuthConnectionRequestSchema,
  UpdateAuthConnectionRequestSchema,
} from "@tailor-platform/tailor-proto/auth_pb";
import type {
  AuthConnection,
  AuthConnectionSchema,
} from "@tailor-platform/tailor-proto/auth_resource_pb";

type CreateConnection = {
  name: string;
  request: MessageInitShape<typeof CreateAuthConnectionRequestSchema>;
  metaRequest: MetadataLabelWrite;
};

type UpdateConnection = {
  name: string;
  /** Absent when only the connection's metadata labels are written. */
  request?: MessageInitShape<typeof UpdateAuthConnectionRequestSchema>;
  metaRequest: MetadataLabelWrite;
};

type ConfigUpdateConnection = UpdateConnection & Required<Pick<UpdateConnection, "request">>;

function isConfigUpdate(update: UpdateConnection): update is ConfigUpdateConnection {
  return update.request !== undefined;
}

type DeleteConnection = {
  name: string;
  request: MessageInitShape<typeof DeleteAuthConnectionRequestSchema>;
};

function buildConnection(
  name: string,
  config: AuthConnectionConfig,
): MessageInitShape<typeof AuthConnectionSchema> {
  return {
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
 * @param stateScope - Workspace, application, and config the connections belong to
 * @param auths - Auth services with connection configs
 * @returns Planned changes for auth connections
 */
export async function planAuthConnections(
  client: OperatorClient,
  stateScope: SecretsStateScope,
  auths: ReadonlyArray<Readonly<AuthService>>,
) {
  const { workspaceId, applicationName: appName, applicationId: appId } = stateScope;
  const changeSet = createChangeSet<CreateConnection, UpdateConnection, DeleteConnection>(
    "Auth connections",
  );
  const ownership = createOwnershipTracker(appName, appId);

  const desiredConnections: Record<string, AuthConnectionConfig> = {};
  for (const auth of auths) {
    for (const [name, config] of Object.entries(auth.connections)) {
      desiredConnections[name] = config;
      logger.registerSecret(config.clientSecret);
    }
  }

  const existingList = await fetchAllTolerant(async (pageToken, maxPageSize) => {
    const { connections, nextPageToken } = await client.listAuthConnections({
      workspaceId,
      pageToken,
      pageSize: maxPageSize,
    });
    return [connections, nextPageToken];
  });

  const existingConnections: WithLabel<AuthConnection> = {};
  await Promise.all(
    existingList.map(async (resource) => {
      const { metadata } = await client.getMetadata({
        trn: resourceTrn(workspaceId, "auth_connection", resource.name),
      });
      existingConnections[resource.name] = { resource, allLabels: metadata?.labels };
    }),
  );

  const state = loadSecretsState(stateScope);

  for (const [name, config] of Object.entries(desiredConnections)) {
    const existing = existingConnections[name];
    const metaRequest = await buildMetaRequest({
      trn: resourceTrn(workspaceId, "auth_connection", name),
      appName,
      appId,
    });

    if (existing) {
      const owned = ownership.ownsDesired(existing.allLabels, {
        resourceType: "auth.connection",
        resourceName: name,
      });

      const currentHash = hashValue(config.clientSecret);
      const storedHash = state.connections?.[name];
      const secretChanged = currentHash !== storedHash;
      const updateMask = buildUpdateMask(existing.resource, config, secretChanged);

      if (updateMask.paths.length > 0) {
        changeSet.updates.push({
          name,
          request: { workspaceId, connection: buildConnection(name, config), updateMask },
          metaRequest,
        });
      } else if (!owned) {
        // The connection itself is unchanged, but this application does not own
        // it yet: it carries no SDK label (just adopted, or created by an SDK
        // that predates ownership labels), or it carries an id this config does
        // not match. Either way the labels have to be written, or the take-over
        // the user just confirmed would not happen and the next deploy would ask
        // the same question again.
        changeSet.updates.push({ name, metaRequest });
      } else {
        changeSet.unchanged.push({ name });
      }
      delete existingConnections[name];
    } else {
      changeSet.creates.push({
        name,
        request: { workspaceId, connection: buildConnection(name, config) },
        metaRequest,
      });
    }
  }

  for (const [name, entry] of Object.entries(existingConnections)) {
    if (!entry) continue;
    // Only delete connections we own. Connections without our label are
    // treated as unowned and left untouched, even if the local secrets-state
    // happens to track them.
    if (ownership.ownsRemaining(entry.allLabels)) {
      changeSet.deletes.push({
        name,
        request: { workspaceId, connectionName: name },
      });
    }
  }

  return { changeSet, ...ownership.result, stateScope };
}

type AuthConnectionApplyResult = Pick<
  Awaited<ReturnType<typeof planAuthConnections>>,
  "changeSet" | "stateScope"
>;

/**
 * Apply auth connection changes for the given phase.
 * @param client - Operator client instance
 * @param result - Planned auth connection changes
 * @param phase - Apply phase
 */
export async function applyAuthConnections(
  client: OperatorClient,
  result: AuthConnectionApplyResult,
  phase: Exclude<ApplyPhase, "delete-services">,
) {
  const { changeSet, stateScope } = result;

  if (phase === "create-update") {
    const [configUpdates, labelUpdates] = partition(changeSet.updates, isConfigUpdate);
    if (changeSet.creates.length > 0 || configUpdates.length > 0) {
      await withSecretsStateLock(stateScope, async () => {
        await Promise.all(
          changeSet.creates.map(async (create) => {
            await client.createAuthConnection(create.request);
            await writeMetadataLabels(client, create.metaRequest);
            logger.info(
              `Connection "${create.name}" was created. Authorize it with:\n` +
                `  tailor authconnection authorize --name ${create.name}\n` +
                `Or via the Console: tailor authconnection open`,
            );
          }),
        );

        for (const update of configUpdates) {
          const resp = await client.updateAuthConnection(update.request);
          if (resp.connection?.status === AuthConnection_Status.UNAUTHORIZED) {
            logger.warn(
              `Connection "${update.name}" requires re-authorization. Authorize with:\n` +
                `  tailor authconnection authorize --name ${update.name}\n` +
                `Or via the Console: tailor authconnection open`,
            );
          }
          await writeMetadataLabels(client, update.metaRequest);
        }

        const secretUpdates = configUpdates.filter((update) =>
          update.request.updateMask?.paths?.includes("oauth2.client_secret"),
        );
        if (changeSet.creates.length > 0 || secretUpdates.length > 0) {
          const state = loadSecretsState(stateScope);
          if (!state.connections) {
            state.connections = {};
          }
          for (const create of changeSet.creates) {
            const conn = create.request.connection;
            if (conn?.config?.case === "oauth2") {
              state.connections[create.name] = hashValue(conn.config.value.clientSecret ?? "");
            }
          }
          for (const update of secretUpdates) {
            const conn = update.request.connection;
            if (conn?.config?.case === "oauth2") {
              state.connections[update.name] = hashValue(conn.config.value.clientSecret ?? "");
            }
          }
          saveSecretsState(stateScope, state);
        }
      });
    }

    // Metadata-only updates: backfill the SDK ownership label on connections
    // whose configuration is otherwise unchanged.
    await Promise.all(
      labelUpdates.map(async (update) => {
        await writeMetadataLabels(client, update.metaRequest);
      }),
    );
  } else if (changeSet.deletes.length > 0) {
    await withSecretsStateLock(stateScope, async () => {
      await Promise.all(
        changeSet.deletes.map(async (del) => {
          await client.deleteAuthConnection(del.request);
        }),
      );

      const state = loadSecretsState(stateScope);
      if (state.connections) {
        for (const del of changeSet.deletes) {
          delete state.connections[del.name];
        }
        saveSecretsState(stateScope, state);
      }
    });
  }
}
