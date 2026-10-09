import { Code, ConnectError } from "@connectrpc/connect";
import { fetchAll, fetchAllTolerant, type OperatorClient } from "#/cli/shared/client";
import { CLIError, internalError } from "#/cli/shared/errors";
import {
  compareSnapshotWithRemote,
  generateAllTypeManifestsFromSnapshot,
  protoGqlPermission,
  type GenerateAllManifestsOptions,
} from "./snapshot-manifest";
import { handleOptionalToRequiredError } from "./types";
import type { SchemaSnapshot } from "./snapshot-types";
import type { TailorDBType as ProtoTailorDBType } from "@tailor-platform/tailor-proto/tailordb_resource_pb";

type RemoteGqlPermission = Awaited<
  ReturnType<OperatorClient["listTailorDBGQLPermissions"]>
>["permissions"][number];

type DesiredGqlPermission = {
  typeName: string;
  permission: ReturnType<typeof protoGqlPermission>;
};

type SnapshotApplyTarget = {
  client: OperatorClient;
  workspaceId: string;
  namespace: string;
};

export type SnapshotApplyPlan = {
  creates: string[];
  updates: string[];
  deletes: string[];
  desiredGqlPermissions: DesiredGqlPermission[];
  gqlPermissionDeletes: RemoteGqlPermission[];
  remoteGqlPermissionTypes: ReadonlySet<string>;
};

export type PlanSnapshotApplyParams = SnapshotApplyTarget & {
  snapshot: SchemaSnapshot;
};

export type ApplySnapshotPlanParams = SnapshotApplyTarget & {
  snapshot: SchemaSnapshot;
  manifestOptions: GenerateAllManifestsOptions;
  plan: SnapshotApplyPlan;
};

async function fetchRemoteGqlPermissions(
  target: SnapshotApplyTarget,
): Promise<RemoteGqlPermission[]> {
  const { client, workspaceId, namespace } = target;
  return fetchAllTolerant(async (pageToken, maxPageSize) => {
    const { permissions, nextPageToken } = await client.listTailorDBGQLPermissions({
      workspaceId,
      namespaceName: namespace,
      pageToken,
      pageSize: maxPageSize,
    });
    return [permissions, nextPageToken];
  });
}

async function fetchRemoteTypes(target: SnapshotApplyTarget): Promise<ProtoTailorDBType[]> {
  const { client, workspaceId, namespace } = target;
  return fetchAll(async (pageToken, maxPageSize) => {
    try {
      const { tailordbTypes, nextPageToken } = await client.listTailorDBTypes({
        workspaceId,
        namespaceName: namespace,
        pageToken,
        pageSize: maxPageSize,
      });
      return [tailordbTypes, nextPageToken];
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.NotFound) {
        throw CLIError({
          code: "MIGRATION_NAMESPACE_NOT_DEPLOYED",
          message: `Cannot sync: TailorDB namespace "${namespace}" has not been deployed yet.`,
          suggestion: "Deploy the namespace before syncing its migration history.",
          cause: error,
        });
      }
      throw error;
    }
  });
}

/**
 * Work out what it takes to make the remote namespace match a snapshot.
 *
 * GQL permissions are reconciled alongside tables: upsert the ones defined
 * in the snapshot, delete remote ones with no snapshot counterpart
 * (including those of deleted tables — an orphaned permission can block
 * the table deletion).
 * @param params - Remote namespace and the snapshot to reach
 * @param params.client - Operator client instance
 * @param params.workspaceId - Workspace ID
 * @param params.namespace - TailorDB namespace
 * @param params.snapshot - Snapshot the remote should match
 * @returns Tables and GQL permissions to create, update, and delete
 */
export async function planSnapshotApply(
  params: PlanSnapshotApplyParams,
): Promise<SnapshotApplyPlan> {
  const { snapshot, ...target } = params;
  const remoteTypes = await fetchRemoteTypes(target);
  const existingTypeNames = new Set(remoteTypes.map((t) => t.name));
  const { creates, updates, deletes } = compareSnapshotWithRemote(snapshot, existingTypeNames);

  const remoteGqlPermissions = await fetchRemoteGqlPermissions(target);
  const remoteGqlPermissionTypes = new Set(remoteGqlPermissions.map((p) => p.typeName));
  const desiredGqlPermissions = Object.entries(snapshot.tables).flatMap(
    ([typeName, snapshotType]) =>
      snapshotType.permissions?.gql
        ? [{ typeName, permission: protoGqlPermission(snapshotType.permissions.gql) }]
        : [],
  );
  const desiredGqlPermissionTypes = new Set(desiredGqlPermissions.map((p) => p.typeName));
  const gqlPermissionDeletes = remoteGqlPermissions.filter(
    (p) => !desiredGqlPermissionTypes.has(p.typeName),
  );

  return {
    creates,
    updates,
    deletes,
    desiredGqlPermissions,
    gqlPermissionDeletes,
    remoteGqlPermissionTypes,
  };
}

/**
 * Send a plan to the remote: create and update tables, upsert and delete GQL
 * permissions, then delete tables. The writes within each step run
 * concurrently, so a failure partway leaves the remote partly updated; running
 * the same plan again converges it.
 * @param params - Remote namespace, snapshot, and the plan to send
 * @param params.client - Operator client instance
 * @param params.workspaceId - Workspace ID
 * @param params.namespace - TailorDB namespace
 * @param params.snapshot - Snapshot the manifests are generated from
 * @param params.manifestOptions - Manifest generation options deploy would use
 * @param params.plan - What {@link planSnapshotApply} returned
 */
export async function applySnapshotPlan(params: ApplySnapshotPlanParams): Promise<void> {
  const { client, workspaceId, namespace, snapshot, manifestOptions, plan } = params;
  const { creates, updates, deletes, desiredGqlPermissions, gqlPermissionDeletes } = plan;
  const manifests = generateAllTypeManifestsFromSnapshot(snapshot, manifestOptions);

  // Resolve all manifests before issuing any RPC: a missing manifest
  // indicates an internal inconsistency, and skipping or failing midway
  // would leave the remote schema partially synced.
  const manifestFor = (tableName: string) => {
    const manifest = manifests.get(tableName);
    if (!manifest) {
      throw internalError(
        `Internal error: no manifest generated for table "${tableName}". No changes were applied.`,
      );
    }
    return manifest;
  };
  const createManifests = creates.map((tableName) => manifestFor(tableName));
  const updateManifests = updates.map((tableName) => manifestFor(tableName));

  try {
    await Promise.all([
      ...createManifests.map((tailordbType) =>
        client.createTailorDBType({
          workspaceId,
          namespaceName: namespace,
          tailordbType,
        }),
      ),
      ...updateManifests.map((tailordbType) =>
        client.updateTailorDBType({
          workspaceId,
          namespaceName: namespace,
          tailordbType,
        }),
      ),
    ]);
  } catch (error) {
    handleOptionalToRequiredError(error, [
      "The target snapshot marks a field as required, but existing remote records have no value for it.",
      "Populate those records first (e.g. with a migration script applied via 'tailor deploy'), then re-run the sync.",
    ]);
  }
  await Promise.all(
    desiredGqlPermissions.map(({ typeName, permission }) => {
      const request = { workspaceId, namespaceName: namespace, typeName, permission };
      return plan.remoteGqlPermissionTypes.has(typeName)
        ? client.updateTailorDBGQLPermission(request)
        : client.createTailorDBGQLPermission(request);
    }),
  );
  await Promise.all(
    gqlPermissionDeletes.map((p) =>
      client.deleteTailorDBGQLPermission({
        workspaceId,
        namespaceName: namespace,
        typeName: p.typeName,
      }),
    ),
  );
  await Promise.all(
    deletes.map((tableName) =>
      client.deleteTailorDBType({
        workspaceId,
        namespaceName: namespace,
        tailordbTypeName: tableName,
      }),
    ),
  );
}
