import { Code, ConnectError } from "@connectrpc/connect";
import { fetchAll, type OperatorClient } from "#/cli/shared/client";
import { assertDefined } from "#/utils/assert";
import { createChangeSet } from "./change-set";
import { buildMetaRequest, hasMatchingSdkVersion, isOwnedByApp, resourceTrn } from "./label";
import { fetchExistingResourcesWithLabels } from "./owned-resource";
import { hashValue, loadSecretsState, saveSecretsState } from "./secrets-state";
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
    workspaceId,
    fetchPage: async (pageToken, maxPageSize) => {
      const { vaults, nextPageToken } = await client.listSecretManagerVaults({
        workspaceId,
        pageToken,
        pageSize: maxPageSize,
      });
      return [vaults, nextPageToken];
    },
    getName: (resource) => resource.name,
    getTrn: (workspaceId, name) => resourceTrn(workspaceId, "vault", name),
  });

  const state = loadSecretsState();
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
        const owned = isOwnedByApp(existing.allLabels, application.name, application.id);
        if (!owned) {
          if (!existing.label) {
            unmanaged.push({
              resourceType: "Secret Manager vault",
              resourceName: vaultName,
            });
          } else {
            conflicts.push({
              resourceType: "Secret Manager vault",
              resourceName: vaultName,
              currentOwner: existing.label,
            });
          }
        }
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
      let existingSecrets: string[] = [];
      if (existing) {
        const secrets = await fetchAll(async (pageToken, maxPageSize) => {
          try {
            const { secrets, nextPageToken } = await client.listSecretManagerSecrets({
              workspaceId,
              secretmanagerVaultName: vaultName,
              pageToken,
              pageSize: maxPageSize,
            });
            return [secrets, nextPageToken];
          } catch (error) {
            if (error instanceof ConnectError && error.code === Code.NotFound) {
              return [[], ""];
            }
            throw error;
          }
        });
        existingSecrets = secrets.map((s) => s.name);
      }

      const existingSet = new Set(existingSecrets);

      // Diff secrets
      for (const secret of vault.secrets) {
        if (secret.value == null) {
          // Nullish value: skip create/update/delete for this secret
          existingSet.delete(secret.name);
          skippedSecrets.push(`${vaultName}/${secret.name}`);
          continue;
        }

        if (existingSet.has(secret.name)) {
          const currentHash = hashValue(secret.value);
          const storedHash = state.vaults[vaultName]?.[secret.name];
          if (forceApplyAll || currentHash !== storedHash) {
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
    const label = entry.label;
    const owned = isOwnedByApp(entry.allLabels, application.name, application.id);
    if (label && !owned) {
      resourceOwners.add(label);
    }
    if (owned) {
      // Delete secrets inside the vault before deleting the vault itself
      const secrets = await fetchAll(async (pageToken, maxPageSize) => {
        try {
          const { secrets, nextPageToken } = await client.listSecretManagerSecrets({
            workspaceId,
            secretmanagerVaultName: name,
            pageToken,
            pageSize: maxPageSize,
          });
          return [secrets, nextPageToken];
        } catch (error) {
          if (error instanceof ConnectError && error.code === Code.NotFound) {
            return [[], ""];
          }
          throw error;
        }
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

  return { vaultChangeSet, secretChangeSet, skippedSecrets, conflicts, unmanaged, resourceOwners };
}

/**
 * Apply secret manager changes for the given phase.
 * @param client - Operator client instance
 * @param result - Planned secret changes
 * @param phase - Apply phase
 * @param application - Application to read secrets from for hash state persistence
 * @returns Promise that resolves when secret changes are applied
 */
export async function applySecretManager(
  client: OperatorClient,
  result: Awaited<ReturnType<typeof planSecretManager>>,
  phase: Extract<ApplyPhase, "create-update" | "delete"> = "create-update",
  application?: Readonly<Application>,
) {
  const { vaultChangeSet, secretChangeSet } = result;

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
          await client.setMetadata(metaRequest);
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
          await client.setMetadata(metaRequest);
        }),
      );
    }

    // Create new secrets
    await Promise.all(
      secretChangeSet.creates.map((create) =>
        client.createSecretManagerSecret(secretCreateRequest(create)),
      ),
    );

    // Update existing secrets
    await Promise.all(
      secretChangeSet.updates.map((update) =>
        client.updateSecretManagerSecret(secretUpdateRequest(update)),
      ),
    );

    // Persist hash state for all secrets after successful apply
    if (application) {
      const state = loadSecretsState();
      for (const vault of application.secrets) {
        if (!Object.hasOwn(state.vaults, vault.vaultName)) {
          state.vaults[vault.vaultName] = {};
        }
        for (const secret of vault.secrets) {
          if (secret.value != null) {
            assertDefined(state.vaults[vault.vaultName], "vault state entry missing")[secret.name] =
              hashValue(secret.value);
          }
        }
      }
      saveSecretsState(state);
    }
  } else {
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
    if (secretChangeSet.deletes.length > 0 || vaultChangeSet.deletes.length > 0) {
      const state = loadSecretsState();
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
      saveSecretsState(state);
    }
  }
}
