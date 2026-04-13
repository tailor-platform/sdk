import { Code, ConnectError } from "@connectrpc/connect";
import { fetchAll, type OperatorClient } from "@/cli/shared/client";
import { logger, styles } from "@/cli/shared/logger";
import { createChangeSet } from "./change-set";
import { buildMetaRequest, hasMatchingSdkVersion, sdkNameLabelKey, type WithLabel } from "./label";
import { hashValue, loadSecretsState, saveSecretsState } from "./secrets-state";
import type { OwnerConflict, UnmanagedResource } from "./confirm";
import type { ApplyPhase, PlanContext } from "@/cli/commands/apply/apply";
import type { Application } from "@/cli/services/application";

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
  const existingVaultList = await fetchAll(async (pageToken, maxPageSize) => {
    try {
      const { vaults, nextPageToken } = await client.listSecretManagerVaults({
        workspaceId,
        pageToken,
        pageSize: maxPageSize,
      });
      return [vaults, nextPageToken];
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.NotFound) {
        return [[], ""];
      }
      throw error;
    }
  });

  const existingVaults: WithLabel<(typeof existingVaultList)[number]> = {};
  await Promise.all(
    existingVaultList.map(async (resource) => {
      const { metadata } = await client.getMetadata({
        trn: vaultTrn(workspaceId, resource.name),
      });
      existingVaults[resource.name] = {
        resource,
        label: metadata?.labels[sdkNameLabelKey],
        allLabels: metadata?.labels,
      };
    }),
  );

  const state = loadSecretsState();
  const skippedSecrets: string[] = [];

  await Promise.all(
    secretVaults.map(async (vault) => {
      const vaultName = vault.vaultName;
      const existing = existingVaults[vaultName];

      if (existing) {
        const metaRequest = await buildMetaRequest(
          vaultTrn(workspaceId, vaultName),
          application.name,
        );
        if (!existing.label) {
          unmanaged.push({
            resourceType: "Secret Manager vault",
            resourceName: vaultName,
          });
        } else if (existing.label !== application.name) {
          conflicts.push({
            resourceType: "Secret Manager vault",
            resourceName: vaultName,
            currentOwner: existing.label,
          });
        }
        if (
          existing.label === application.name &&
          hasMatchingSdkVersion(existing.allLabels, metaRequest.labels)
        ) {
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
    if (label && label !== application.name) {
      resourceOwners.add(label);
    }
    if (label === application.name) {
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

  vaultChangeSet.print();
  secretChangeSet.print();
  if (skippedSecrets.length > 0) {
    logger.log(styles.bold("Secret Manager secrets (skipped - no value provided):"));
    for (const name of skippedSecrets) {
      logger.log(`  ${styles.dim("○")} ${name}`);
    }
  }
  return { vaultChangeSet, secretChangeSet, skippedSecrets, conflicts, unmanaged, resourceOwners };
}

function vaultTrn(workspaceId: string, name: string) {
  return `trn:v1:workspace:${workspaceId}:vault:${name}`;
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
        await client.createSecretManagerVault({
          workspaceId: create.workspaceId,
          secretmanagerVaultName: create.name,
        });
        if (application) {
          const metaRequest = await buildMetaRequest(
            vaultTrn(create.workspaceId, create.name),
            application.name,
          );
          await client.setMetadata(metaRequest);
        }
      }),
    );

    // Update metadata for existing vaults
    if (application) {
      await Promise.all(
        vaultChangeSet.updates.map(async (update) => {
          const metaRequest = await buildMetaRequest(
            vaultTrn(update.workspaceId, update.name),
            application.name,
          );
          await client.setMetadata(metaRequest);
        }),
      );
    }

    // Create new secrets
    await Promise.all(
      secretChangeSet.creates.map((create) =>
        client.createSecretManagerSecret({
          workspaceId: create.workspaceId,
          secretmanagerVaultName: create.vaultName,
          secretmanagerSecretName: create.secretName,
          secretmanagerSecretValue: create.value,
        }),
      ),
    );

    // Update existing secrets
    await Promise.all(
      secretChangeSet.updates.map((update) =>
        client.updateSecretManagerSecret({
          workspaceId: update.workspaceId,
          secretmanagerVaultName: update.vaultName,
          secretmanagerSecretName: update.secretName,
          secretmanagerSecretValue: update.value,
        }),
      ),
    );

    // Persist hash state for all secrets after successful apply
    if (application) {
      const state = loadSecretsState();
      for (const vault of application.secrets) {
        if (!state.vaults[vault.vaultName]) {
          state.vaults[vault.vaultName] = {};
        }
        for (const secret of vault.secrets) {
          if (secret.value != null) {
            state.vaults[vault.vaultName][secret.name] = hashValue(secret.value);
          }
        }
      }
      saveSecretsState(state);
    }
  } else if (phase === "delete") {
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
        if (state.vaults[del.vaultName]) {
          delete state.vaults[del.vaultName][del.secretName];
          if (Object.keys(state.vaults[del.vaultName]).length === 0) {
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
