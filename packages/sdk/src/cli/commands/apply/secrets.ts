import { Code, ConnectError } from "@connectrpc/connect";
import { fetchAll, type OperatorClient } from "@/cli/shared/client";
import { createChangeSet } from "./change-set";
import type { ApplyPhase, PlanContext } from "@/cli/commands/apply/apply";

type CreateVault = {
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
export async function planSecrets(context: PlanContext) {
  const { client, workspaceId, application, forRemoval } = context;
  const secretVaults = forRemoval ? [] : application.secrets;

  const vaultChangeSet = createChangeSet<CreateVault, never, never>("Secret Manager vaults");
  const secretChangeSet = createChangeSet<CreateSecret, UpdateSecret, DeleteSecret>(
    "Secret Manager secrets",
  );

  if (secretVaults.length === 0) {
    return { vaultChangeSet, secretChangeSet };
  }

  for (const vault of secretVaults) {
    const vaultName = vault.vaultName;

    // Check if vault exists
    let vaultExists = false;
    try {
      await client.getSecretManagerVault({
        workspaceId,
        secretmanagerVaultName: vaultName,
      });
      vaultExists = true;
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.NotFound) {
        vaultExists = false;
      } else {
        throw error;
      }
    }

    if (!vaultExists) {
      vaultChangeSet.creates.push({
        name: vaultName,
        workspaceId,
      });
    }

    // Fetch existing secrets in this vault
    let existingSecrets: string[] = [];
    if (vaultExists) {
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
      if (existingSet.has(secret.name)) {
        // Always update (we can't compare values)
        secretChangeSet.updates.push({
          name: `${vaultName}/${secret.name}`,
          secretName: secret.name,
          workspaceId,
          vaultName,
          value: secret.value,
        });
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
  }

  vaultChangeSet.print();
  secretChangeSet.print();
  return { vaultChangeSet, secretChangeSet };
}

/**
 * Apply secret manager changes for the given phase.
 * @param client - Operator client instance
 * @param result - Planned secret changes
 * @param phase - Apply phase
 * @returns Promise that resolves when secret changes are applied
 */
export async function applySecrets(
  client: OperatorClient,
  result: Awaited<ReturnType<typeof planSecrets>>,
  phase: Extract<ApplyPhase, "create-update" | "delete"> = "create-update",
) {
  const { vaultChangeSet, secretChangeSet } = result;
  if (phase === "create-update") {
    // Create vaults first
    for (const create of vaultChangeSet.creates) {
      await client.createSecretManagerVault({
        workspaceId: create.workspaceId,
        secretmanagerVaultName: create.name,
      });
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
  }
}
