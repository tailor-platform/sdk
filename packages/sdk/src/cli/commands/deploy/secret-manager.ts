import { fetchAllTolerant, type OperatorClient } from "#/cli/shared/client";
import { assertDefined } from "#/utils/assert";
import { createChangeSet } from "./change-set";
import { buildMetaRequest, hasMatchingSdkVersion, resourceTrn, writeMetadataLabels } from "./label";
import {
  fetchExistingResourcesWithLabels,
  trackDesiredResourceOwnership,
  trackRemainingResourceOwner,
} from "./owned-resource";
import {
  hashValue,
  loadSecretsState,
  saveSecretsState,
  serializeUpdateTime,
  withSecretsStateLock,
} from "./secrets-state";
import type { ApplyPhase, PlanContext } from "#/cli/commands/deploy/types";
import type { Application } from "#/cli/services/application";
import type { OwnerConflict, UnmanagedResource } from "./confirm";
import type { MessageInitShape } from "@bufbuild/protobuf";
import type {
  CreateSecretManagerSecretRequestSchema,
  CreateSecretManagerVaultRequestSchema,
  UpdateSecretManagerSecretRequestSchema,
} from "@tailor-platform/tailor-proto/secret_manager_pb";

type CreateVault = {
  name: string;
  workspaceId: string;
};

type ExistingVault = {
  name: string;
  workspaceId: string;
};

type DeleteVault = {
  name: string;
  workspaceId: string;
};

type CreateSecret = {
  name: string;
  secretName: string;
  workspaceId: string;
  vaultName: string;
  value: string;
};

type UpdateSecret = {
  name: string;
  secretName: string;
  workspaceId: string;
  vaultName: string;
  value: string;
};

type DeleteSecret = {
  name: string;
  secretName: string;
  workspaceId: string;
  vaultName: string;
};

/**
 * Build the CreateSecretManagerVault request for a planned vault create.
 * @param create - Planned vault create
 * @returns Request init shape
 */
export function vaultCreateRequest(
  create: CreateVault,
): MessageInitShape<typeof CreateSecretManagerVaultRequestSchema> {
  return {
    workspaceId: create.workspaceId,
    secretmanagerVaultName: create.name,
  };
}

/**
 * Build the CreateSecretManagerSecret request for a planned secret create.
 * @param create - Planned secret create
 * @returns Request init shape
 */
export function secretCreateRequest(
  create: CreateSecret,
): MessageInitShape<typeof CreateSecretManagerSecretRequestSchema> {
  return {
    workspaceId: create.workspaceId,
    secretmanagerVaultName: create.vaultName,
    secretmanagerSecretName: create.secretName,
    secretmanagerSecretValue: create.value,
  };
}

/**
 * Build the UpdateSecretManagerSecret request for a planned secret update.
 * @param update - Planned secret update
 * @returns Request init shape
 */
export function secretUpdateRequest(
  update: UpdateSecret,
): MessageInitShape<typeof UpdateSecretManagerSecretRequestSchema> {
  return {
    workspaceId: update.workspaceId,
    secretmanagerVaultName: update.vaultName,
    secretmanagerSecretName: update.secretName,
    secretmanagerSecretValue: update.value,
  };
}

/**
 * Plan secret manager changes based on current and desired state.
 * @param context - Planning context
 * @returns Planned changes for vaults and secrets
 */
export async function planSecretManager(context: PlanContext) {
  const { client, workspaceId, application, forRemoval, forceApplyAll = false } = context;
  const secretVaults = forRemoval ? [] : application.secrets;

  const vaultChangeSet = createChangeSet<CreateVault, ExistingVault, DeleteVault>(
    "Secret Manager vaults",
  );
  const secretChangeSet = createChangeSet<CreateSecret, UpdateSecret, DeleteSecret>(
    "Secret Manager secrets",
  );
  const conflicts: OwnerConflict[] = [];
  const unmanaged: UnmanagedResource[] = [];
  const resourceOwners = new Set<string>();

  // Fetch all existing vaults with metadata to track managed resources
  const existingVaults = await fetchExistingResourcesWithLabels({
    client,
    fetchPage: async (pageToken, maxPageSize) => {
      const { vaults, nextPageToken } = await client.listSecretManagerVaults({
        workspaceId,
        pageToken,
        pageSize: maxPageSize,
      });
      return [vaults, nextPageToken];
    },
    getName: (resource) => resource.name,
    getTrn: (name) => resourceTrn(workspaceId, "vault", name),
  });

  const stateScope = {
    workspaceId,
    applicationId: application.id,
    applicationName: application.name,
  };
  const state = loadSecretsState(stateScope);
  const skippedSecrets: string[] = [];

  await Promise.all(
    secretVaults.map(async (vault) => {
      const vaultName = vault.vaultName;
      const existing = existingVaults[vaultName];

      if (existing) {
        const metaRequest = await buildMetaRequest({
          trn: resourceTrn(workspaceId, "vault", vaultName),
          appName: application.name,
          appId: application.id,
        });
        const owned = trackDesiredResourceOwnership({
          labels: existing.allLabels,
          ownerLabel: existing.label,
          appName: application.name,
          appId: application.id,
          resourceType: "Secret Manager vault",
          resourceName: vaultName,
          conflicts,
          unmanaged,
        });
        if (owned && hasMatchingSdkVersion(existing.allLabels, metaRequest.labels)) {
          vaultChangeSet.unchanged.push({ name: vaultName });
        } else {
          vaultChangeSet.updates.push({
            name: vaultName,
            workspaceId,
          });
        }
        delete existingVaults[vaultName];
      } else {
        vaultChangeSet.creates.push({
          name: vaultName,
          workspaceId,
        });
      }

      // Fetch existing secrets in this vault
      const existingSecretTimes = new Map<string, string | undefined>();
      if (existing) {
        const secrets = await fetchAllTolerant(async (pageToken, maxPageSize) => {
          const { secrets, nextPageToken } = await client.listSecretManagerSecrets({
            workspaceId,
            secretmanagerVaultName: vaultName,
            pageToken,
            pageSize: maxPageSize,
          });
          return [secrets, nextPageToken];
        });
        for (const secret of secrets) {
          existingSecretTimes.set(secret.name, serializeUpdateTime(secret.updateTime));
        }
      }

      const existingSet = new Set(existingSecretTimes.keys());

      // Diff secrets
      for (const secret of vault.secrets) {
        if (secret.value == null) {
          // Nullish value: skip create/update/delete for this secret
          existingSet.delete(secret.name);
          skippedSecrets.push(`${vaultName}/${secret.name}`);
          continue;
        }

        if (existingSet.has(secret.name)) {
          const stored = state.vaults[vaultName]?.[secret.name];
          const remoteUpdateTime = existingSecretTimes.get(secret.name);
          // Skip only when the stored hash matches and the remote updateTime
          // proves no other writer changed the secret since that hash was saved.
          const unchanged =
            stored !== undefined &&
            stored.hash === hashValue(secret.value) &&
            stored.updateTime !== undefined &&
            stored.updateTime === remoteUpdateTime;
          if (forceApplyAll || !unchanged) {
            secretChangeSet.updates.push({
              name: `${vaultName}/${secret.name}`,
              secretName: secret.name,
              workspaceId,
              vaultName,
              value: secret.value,
            });
          }
          existingSet.delete(secret.name);
        } else {
          secretChangeSet.creates.push({
            name: `${vaultName}/${secret.name}`,
            secretName: secret.name,
            workspaceId,
            vaultName,
            value: secret.value,
          });
        }
      }

      // Remaining in existingSet are orphans - mark for deletion
      for (const orphanName of existingSet) {
        secretChangeSet.deletes.push({
          name: `${vaultName}/${orphanName}`,
          secretName: orphanName,
          workspaceId,
          vaultName,
        });
      }
    }),
  );

  // Remaining existing vaults not in config - mark managed ones for deletion
  for (const [name, entry] of Object.entries(existingVaults)) {
    if (!entry) continue;
    const owned = trackRemainingResourceOwner({
      labels: entry.allLabels,
      ownerLabel: entry.label,
      appName: application.name,
      appId: application.id,
      resourceOwners,
    });
    if (owned) {
      // Delete secrets inside the vault before deleting the vault itself
      const secrets = await fetchAllTolerant(async (pageToken, maxPageSize) => {
        const { secrets, nextPageToken } = await client.listSecretManagerSecrets({
          workspaceId,
          secretmanagerVaultName: name,
          pageToken,
          pageSize: maxPageSize,
        });
        return [secrets, nextPageToken];
      });
      for (const secret of secrets) {
        secretChangeSet.deletes.push({
          name: `${name}/${secret.name}`,
          secretName: secret.name,
          workspaceId,
          vaultName: name,
        });
      }

      vaultChangeSet.deletes.push({
        name,
        workspaceId,
      });
    }
  }

  return {
    vaultChangeSet,
    secretChangeSet,
    skippedSecrets,
    conflicts,
    unmanaged,
    resourceOwners,
    stateScope,
  };
}

/**
 * Apply secret manager changes for the given phase.
 * @param client - Operator client instance
 * @param result - Planned secret changes
 * @param phase - Apply phase
 * @param application - Application used for ownership metadata and hash state persistence
 * @returns Promise that resolves when secret changes are applied
 */
export async function applySecretManager(
  client: OperatorClient,
  result: Awaited<ReturnType<typeof planSecretManager>>,
  phase: Extract<ApplyPhase, "create-update" | "delete"> = "create-update",
  application?: Readonly<Application>,
) {
  const { vaultChangeSet, secretChangeSet, stateScope } = result;

  if (phase === "create-update") {
    // Create vaults first and set metadata
    await Promise.all(
      vaultChangeSet.creates.map(async (create) => {
        await client.createSecretManagerVault(vaultCreateRequest(create));
        if (application) {
          const metaRequest = await buildMetaRequest({
            trn: resourceTrn(create.workspaceId, "vault", create.name),
            appName: application.name,
            appId: application.id,
          });
          await writeMetadataLabels(client, metaRequest);
        }
      }),
    );

    // Update metadata for existing vaults
    if (application) {
      await Promise.all(
        vaultChangeSet.updates.map(async (update) => {
          const metaRequest = await buildMetaRequest({
            trn: resourceTrn(update.workspaceId, "vault", update.name),
            appName: application.name,
            appId: application.id,
          });
          await writeMetadataLabels(client, metaRequest);
        }),
      );
    }

    const secretHashUpdates = [...secretChangeSet.creates, ...secretChangeSet.updates];
    if (secretHashUpdates.length > 0) {
      await withSecretsStateLock(stateScope, async () => {
        // Evidence must come from this deploy's own mutation responses; pairing
        // the hash with a re-listed timestamp could adopt another writer's.
        const appliedUpdateTimes = new Map<string, string | undefined>();

        // Create new secrets
        await Promise.all(
          secretChangeSet.creates.map(async (create) => {
            const response = await client.createSecretManagerSecret(secretCreateRequest(create));
            appliedUpdateTimes.set(create.name, serializeUpdateTime(response.secret?.updateTime));
          }),
        );

        // Update existing secrets
        await Promise.all(
          secretChangeSet.updates.map(async (update) => {
            const response = await client.updateSecretManagerSecret(secretUpdateRequest(update));
            appliedUpdateTimes.set(update.name, serializeUpdateTime(response.secret?.updateTime));
          }),
        );

        if (application) {
          const state = loadSecretsState(stateScope);
          for (const secret of secretHashUpdates) {
            if (!Object.hasOwn(state.vaults, secret.vaultName)) {
              state.vaults[secret.vaultName] = {};
            }
            const updateTime = appliedUpdateTimes.get(secret.name);
            assertDefined(state.vaults[secret.vaultName], "vault state entry missing")[
              secret.secretName
            ] = {
              hash: hashValue(secret.value),
              ...(updateTime === undefined ? {} : { updateTime }),
            };
          }
          saveSecretsState(stateScope, state);
        }
      });
    }
  } else if (secretChangeSet.deletes.length > 0 || vaultChangeSet.deletes.length > 0) {
    await withSecretsStateLock(stateScope, async () => {
      // Delete orphan secrets
      await Promise.all(
        secretChangeSet.deletes.map((del) =>
          client.deleteSecretManagerSecret({
            workspaceId: del.workspaceId,
            secretmanagerVaultName: del.vaultName,
            secretmanagerSecretName: del.secretName,
          }),
        ),
      );

      // Delete orphan vaults
      await Promise.all(
        vaultChangeSet.deletes.map((del) =>
          client.deleteSecretManagerVault({
            workspaceId: del.workspaceId,
            secretmanagerVaultName: del.name,
          }),
        ),
      );

      // Remove deleted secrets and vaults from hash state
      const state = loadSecretsState(stateScope);
      for (const del of secretChangeSet.deletes) {
        if (Object.hasOwn(state.vaults, del.vaultName)) {
          delete assertDefined(state.vaults[del.vaultName], "vault state entry missing")[
            del.secretName
          ];
          if (
            Object.keys(assertDefined(state.vaults[del.vaultName], "vault state entry missing"))
              .length === 0
          ) {
            delete state.vaults[del.vaultName];
          }
        }
      }
      for (const del of vaultChangeSet.deletes) {
        delete state.vaults[del.name];
      }
      saveSecretsState(stateScope, state);
    });
  }
}
