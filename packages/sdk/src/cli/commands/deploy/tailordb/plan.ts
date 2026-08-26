import { type MessageInitShape } from "@bufbuild/protobuf";
import {
  type CreateTailorDBGQLPermissionRequestSchema,
  type CreateTailorDBServiceRequestSchema,
  type CreateTailorDBTypeRequestSchema,
  type DeleteTailorDBGQLPermissionRequestSchema,
  type DeleteTailorDBServiceRequestSchema,
  type DeleteTailorDBTypeRequestSchema,
  type UpdateTailorDBGQLPermissionRequestSchema,
  type UpdateTailorDBTypeRequestSchema,
} from "@tailor-platform/tailor-proto/tailordb_pb";
import * as path from "pathe";
import { getNamespacesWithMigrations } from "#/cli/commands/tailordb/migrate/config";
import { captureMigrationFileState } from "#/cli/commands/tailordb/migrate/file-state";
import {
  toTailorDBDeployInput,
  type TailorDBDeployInput,
} from "#/cli/commands/tailordb/migrate/schema-checks";
import { type TailorDBSnapshotType } from "#/cli/commands/tailordb/migrate/snapshot";
import {
  generateTailorDBTypeManifestFromSnapshot,
  protoGqlPermission,
} from "#/cli/commands/tailordb/migrate/snapshot-manifest";
import { byName } from "#/cli/shared/apply-concurrency";
import { fetchAllTolerant, type OperatorClient } from "#/cli/shared/client";
import {
  assertNoPublishEventsConflict,
  publishEventsConflict,
  subscribesToEvents,
} from "#/cli/shared/publish-events";
import { createChangeSet } from "../change-set";
import { areNormalizedEqual } from "../compare";
import {
  addDependencyRecords,
  buildMetaRequest,
  type DependentAppsByResource,
  eventSourceKey,
  hasMatchingSdkVersion,
  type MetadataLabelWrite,
  resourceTrn,
  tailorDBTypeTrn,
} from "../label";
import {
  fetchExistingResourcesWithLabels,
  trackDesiredResourceOwnership,
  trackRemainingResourceOwner,
} from "../owned-resource";
import {
  areTailorDBServicesEqual,
  normalizeComparableGqlPermission,
  normalizeComparableTailorDBType,
} from "./compare";
import { validateAndDetectMigrations } from "./migration-validation";
import type { OwnerConflict, UnmanagedResource } from "../confirm";
import type { PlanContext } from "../types";

export type TailorDBPlanResult = Awaited<ReturnType<typeof planTailorDB>>;

export type TailorDBChangeSet = TailorDBPlanResult["changeSet"];

/**
 * Plan TailorDB-related changes based on current and desired state.
 * @param context - Planning context
 * @returns Planned changes
 */
export async function planTailorDB(context: PlanContext) {
  const {
    client,
    workspaceId,
    application,
    forRemoval,
    config,
    noSchemaCheck,
    forceApplyAll = false,
  } = context;
  const tailordbs: TailorDBDeployInput[] = [];
  const migrationTestSnapshots =
    context.migrationTestSnapshots ??
    (context.migrationTestBaselines
      ? new Map(
          [...context.migrationTestBaselines].map(([namespace, baseline]) => [
            namespace,
            baseline.snapshot,
          ]),
        )
      : undefined);
  if (!forRemoval) {
    for (const tailordb of application.tailorDBServices) {
      await tailordb.loadTypes();
      const input = toTailorDBDeployInput(tailordb);
      const snapshot = migrationTestSnapshots?.get(tailordb.namespace);
      tailordbs.push(snapshot ? { ...input, types: snapshot.tables } : input);
    }
  }
  const executors = forRemoval
    ? []
    : Object.values((await application.executorService?.loadExecutors()) ?? {});
  const executorUsedTables = new Set(context.executorUsedTailorDBTables ?? []);
  for (const executor of executors) {
    if (!subscribesToEvents(executor)) continue;
    if (executor.trigger.kind === "tailordb") {
      executorUsedTables.add(executor.trigger.tableName);
    }
  }

  // Validate migrations at plan time so a missing migration script fails the
  // deploy (including --dry-run) before any resource is applied.
  const typesByNamespace = new Map<string, Record<string, TailorDBSnapshotType>>();
  for (const tailordb of tailordbs) {
    typesByNamespace.set(tailordb.namespace, tailordb.types);
  }
  const migrationTestBaselines = context.migrationTestBaselines;
  if (migrationTestSnapshots) {
    for (const namespace of migrationTestSnapshots.keys()) {
      if (!tailordbs.some((tailordb) => tailordb.namespace === namespace)) {
        throw new Error(
          `Migration test snapshot targets unknown TailorDB namespace "${namespace}".`,
        );
      }
    }
    const namespaceByType = new Map<string, string>();
    for (const tailordb of tailordbs) {
      for (const tableName of Object.keys(tailordb.types)) {
        const existingNamespace = namespaceByType.get(tableName);
        if (existingNamespace) {
          throw new Error(
            `Migration test snapshot has duplicate TailorDB table name "${tableName}" in namespaces "${existingNamespace}" and "${tailordb.namespace}".`,
          );
        }
        namespaceByType.set(tableName, tailordb.namespace);
      }
    }
  }
  const migrationConfig = getNamespacesWithMigrations(config, path.dirname(config.path));
  const { namespacesWithMigrations, migrationFileState, checkpointRepairs } = forRemoval
    ? { namespacesWithMigrations: [], migrationFileState: {}, checkpointRepairs: [] }
    : migrationTestBaselines
      ? {
          namespacesWithMigrations: migrationConfig,
          migrationFileState: captureMigrationFileState(migrationConfig),
          checkpointRepairs: [],
        }
      : await validateAndDetectMigrations(
          client,
          workspaceId,
          typesByNamespace,
          config,
          noSchemaCheck ?? false,
          tailordbs,
        );

  const {
    changeSet: serviceChangeSet,
    conflicts,
    unmanaged,
    resourceOwners,
  } = await planServices(client, workspaceId, application.name, application.id, tailordbs);
  const deletedServices = serviceChangeSet.deletes.map((del) => del.name);
  const [typeChangeSet, gqlPermissionChangeSet] = await Promise.all([
    planTypes(
      client,
      workspaceId,
      tailordbs,
      executorUsedTables,
      deletedServices,
      undefined,
      forceApplyAll,
      {
        appName: application.name,
        appId: application.id,
        dependentApps: context.dependentApps,
        runAppIds: context.runAppIds,
      },
    ),
    planGqlPermissions(client, workspaceId, tailordbs, deletedServices, forceApplyAll),
  ]);

  // Apply table DDL in a stable, name-sorted order so the create burst (capped
  // by the operator client's concurrency limiter) is reproducible across runs.
  typeChangeSet.creates.sort(byName);
  typeChangeSet.updates.sort(byName);
  typeChangeSet.deletes.sort(byName);

  return {
    changeSet: {
      service: serviceChangeSet,
      type: typeChangeSet,
      gqlPermission: gqlPermissionChangeSet,
    },
    conflicts,
    unmanaged,
    resourceOwners,
    context: {
      workspaceId,
      application,
      tailorDBInputs: tailordbs,
      executorUsedTables,
      config,
      noSchemaCheck: noSchemaCheck ?? false,
      ...(migrationTestBaselines ? { migrationTestBaselines } : {}),
      namespacesWithMigrations,
      migrationFileState,
      checkpointRepairs,
    },
  };
}

type CreateService = {
  name: string;
  request: MessageInitShape<typeof CreateTailorDBServiceRequestSchema>;
  metaRequest: MetadataLabelWrite;
};

type UpdateService = {
  name: string;
  metaRequest: MetadataLabelWrite;
};

type DeleteService = {
  name: string;
  request: MessageInitShape<typeof DeleteTailorDBServiceRequestSchema>;
};

async function planServices(
  client: OperatorClient,
  workspaceId: string,
  appName: string,
  appId: string | undefined,
  tailordbs: ReadonlyArray<TailorDBDeployInput>,
) {
  const changeSet = createChangeSet<CreateService, UpdateService, DeleteService>(
    "TailorDB services",
  );
  const conflicts: OwnerConflict[] = [];
  const unmanaged: UnmanagedResource[] = [];
  const resourceOwners = new Set<string>();

  const existingServices = await fetchExistingResourcesWithLabels({
    client,
    fetchPage: async (pageToken, maxPageSize) => {
      const { tailordbServices, nextPageToken } = await client.listTailorDBServices({
        workspaceId,
        pageToken,
        pageSize: maxPageSize,
      });
      return [tailordbServices, nextPageToken];
    },
    getName: (resource) => resource.namespace?.name,
    getTrn: (name) => resourceTrn(workspaceId, "tailordb", name),
  });

  for (const tailordb of tailordbs) {
    const existing = existingServices[tailordb.namespace];
    const metaRequest = await buildMetaRequest({
      trn: resourceTrn(workspaceId, "tailordb", tailordb.namespace),
      appName,
      appId,
    });
    if (existing) {
      const owned = trackDesiredResourceOwnership({
        labels: existing.allLabels,
        ownerLabel: existing.label,
        appName,
        appId,
        resourceType: "TailorDB service",
        resourceName: tailordb.namespace,
        conflicts,
        unmanaged,
      });

      if (
        owned &&
        hasMatchingSdkVersion(existing.allLabels, metaRequest.labels) &&
        areTailorDBServicesEqual(existing.resource, tailordb)
      ) {
        changeSet.unchanged.push({ name: tailordb.namespace });
      } else {
        changeSet.updates.push({
          name: tailordb.namespace,
          metaRequest,
        });
      }
      delete existingServices[tailordb.namespace];
    } else {
      changeSet.creates.push({
        name: tailordb.namespace,
        request: {
          workspaceId,
          namespaceName: tailordb.namespace,
          // Keep generated TailorDB services aligned with Terraform defaults.
          defaultTimezone: "UTC",
        },
        metaRequest,
      });
    }
  }
  Object.entries(existingServices).forEach(([namespaceName]) => {
    const entry = existingServices[namespaceName];
    const owned = trackRemainingResourceOwner({
      labels: entry?.allLabels,
      ownerLabel: entry?.label,
      appName,
      appId,
      resourceOwners,
    });
    if (owned) {
      changeSet.deletes.push({
        name: namespaceName,
        request: {
          workspaceId,
          namespaceName,
        },
      });
    }
  });

  return { changeSet, conflicts, unmanaged, resourceOwners };
}

type CreateType = {
  name: string;
  request: MessageInitShape<typeof CreateTailorDBTypeRequestSchema>;
  metaRequest: MetadataLabelWrite;
};

type UpdateType = {
  name: string;
  request: MessageInitShape<typeof UpdateTailorDBTypeRequestSchema>;
  metaRequest: MetadataLabelWrite;
};

/**
 * A table whose schema is unchanged but whose dependency records may not be. The
 * plan shows it as unchanged; apply still writes its labels.
 */
type UnchangedType = {
  name: string;
  metaRequest?: MetadataLabelWrite;
};

/** What planTypes needs to record dependencies on each table. */
type TypeRecordInputs = {
  appName?: string;
  appId?: string;
  dependentApps?: DependentAppsByResource;
  runAppIds?: ReadonlySet<string>;
};

type DeleteType = {
  name: string;
  request: MessageInitShape<typeof DeleteTailorDBTypeRequestSchema>;
};

async function planTypes(
  client: OperatorClient,
  workspaceId: string,
  tailordbs: ReadonlyArray<TailorDBDeployInput>,
  executorUsedTables: ReadonlySet<string>,
  deletedServices: ReadonlyArray<string>,
  filteredTypesByNamespace?: Map<string, Record<string, TailorDBSnapshotType>>,
  forceApplyAll = false,
  records: TypeRecordInputs = {},
) {
  const changeSet = createChangeSet<CreateType, UpdateType, DeleteType, never, UnchangedType>(
    "TailorDB tables",
  );
  const { appName, appId, dependentApps, runAppIds } = records;

  /**
   * Build one table's metadata write, carrying the dependency records that belong
   * to it. The table is what publishes record events, so the record lives there.
   * @param namespace - Namespace holding the table
   * @param tableName - Table name
   * @param explicitPublishEvents - `publishEvents` declared on the table, if any
   * @returns The table's metadata write
   */
  const typeMetaRequest = async (
    namespace: string,
    tableName: string,
    explicitPublishEvents: boolean | undefined,
  ) => {
    const trn = tailorDBTypeTrn(workspaceId, namespace, tableName);
    return addDependencyRecords(await buildMetaRequest({ trn, appName: appName ?? "", appId }), {
      key: eventSourceKey.tailorDBType(namespace, tableName),
      dependentApps,
      runAppIds,
      pinned: explicitPublishEvents !== undefined,
    });
  };

  const fetchTypes = (namespaceName: string) => {
    return fetchAllTolerant(async (pageToken, maxPageSize) => {
      const { tailordbTypes, nextPageToken } = await client.listTailorDBTypes({
        workspaceId,
        namespaceName,
        pageToken,
        pageSize: maxPageSize,
      });
      return [tailordbTypes, nextPageToken];
    });
  };

  // Reject a conflicting opt-out before any request, not partway through.
  for (const tailordb of tailordbs) {
    const types = filteredTypesByNamespace?.get(tailordb.namespace) ?? tailordb.types;
    for (const [tableName, type] of Object.entries(types)) {
      assertNoPublishEventsConflict({
        explicit: type.settings?.publishEvents,
        subscribed: executorUsedTables.has(tableName),
        conflict: publishEventsConflict.tailorDBType(tableName),
      });
    }
  }

  for (const tailordb of tailordbs) {
    const existingTypes = await fetchTypes(tailordb.namespace);
    const existingTypesMap = new Map(existingTypes.map((type) => [type.name, type]));

    // Use filtered tables if provided, otherwise use local tables
    const types = filteredTypesByNamespace?.get(tailordb.namespace) ?? tailordb.types;
    const typeMeta = (tableName: string) =>
      typeMetaRequest(tailordb.namespace, tableName, types[tableName]?.settings?.publishEvents);

    for (const [tableName, tailordbTypeSnapshot] of Object.entries(types)) {
      const tailordbType = generateTailorDBTypeManifestFromSnapshot(tailordbTypeSnapshot, {
        subscribed: executorUsedTables.has(tableName),
        namespaceGqlOperations: tailordb.config.gqlOperations,
      });
      const existingType = existingTypesMap.get(tableName);
      if (existingType) {
        if (
          !forceApplyAll &&
          areNormalizedEqual(
            normalizeComparableTailorDBType(existingType),
            normalizeComparableTailorDBType(tailordbType),
          )
        ) {
          // The schema matches, but the records may not, so the labels still go.
          changeSet.unchanged.push({ name: tableName, metaRequest: await typeMeta(tableName) });
        } else {
          changeSet.updates.push({
            name: tableName,
            request: {
              workspaceId,
              namespaceName: tailordb.namespace,
              tailordbType,
            },
            metaRequest: await typeMeta(tableName),
          });
        }
        existingTypesMap.delete(tableName);
      } else {
        changeSet.creates.push({
          name: tableName,
          request: {
            workspaceId,
            namespaceName: tailordb.namespace,
            tailordbType,
          },
          metaRequest: await typeMeta(tableName),
        });
      }
    }
    existingTypesMap.forEach((_type, name) => {
      changeSet.deletes.push({
        name,
        request: {
          workspaceId,
          namespaceName: tailordb.namespace,
          tailordbTypeName: name,
        },
      });
    });
  }
  for (const namespaceName of deletedServices) {
    const existingTypes = await fetchTypes(namespaceName);
    existingTypes.forEach((typ) => {
      changeSet.deletes.push({
        name: typ.name,
        request: {
          workspaceId,
          namespaceName,
          tailordbTypeName: typ.name,
        },
      });
    });
  }
  return changeSet;
}

type CreateGqlPermission = {
  name: string;
  request: MessageInitShape<typeof CreateTailorDBGQLPermissionRequestSchema>;
};

type UpdateGqlPermission = {
  name: string;
  request: MessageInitShape<typeof UpdateTailorDBGQLPermissionRequestSchema>;
};

type DeleteGqlPermission = {
  name: string;
  request: MessageInitShape<typeof DeleteTailorDBGQLPermissionRequestSchema>;
};

async function planGqlPermissions(
  client: OperatorClient,
  workspaceId: string,
  tailordbs: ReadonlyArray<TailorDBDeployInput>,
  deletedServices: ReadonlyArray<string>,
  forceApplyAll = false,
) {
  const changeSet = createChangeSet<CreateGqlPermission, UpdateGqlPermission, DeleteGqlPermission>(
    "TailorDB gqlPermissions",
  );

  const fetchGqlPermissions = (namespaceName: string) => {
    return fetchAllTolerant(async (pageToken, maxPageSize) => {
      const { permissions, nextPageToken } = await client.listTailorDBGQLPermissions({
        workspaceId,
        namespaceName,
        pageToken,
        pageSize: maxPageSize,
      });
      return [permissions, nextPageToken];
    });
  };

  for (const tailordb of tailordbs) {
    const existingGqlPermissions = await fetchGqlPermissions(tailordb.namespace);
    const existingNameSet = new Set<string>();
    existingGqlPermissions.forEach((gqlPermission) => {
      existingNameSet.add(gqlPermission.typeName);
    });

    const types = tailordb.types;
    for (const [tableName, typeEntry] of Object.entries(types)) {
      const gqlPermission = typeEntry.permissions?.gql;
      if (!gqlPermission) {
        continue;
      }
      const desiredPermission = protoGqlPermission(gqlPermission);
      const existingPermission = existingGqlPermissions.find(
        (entry) => entry.typeName === tableName,
      );
      if (existingNameSet.has(tableName)) {
        if (
          !forceApplyAll &&
          existingPermission &&
          areNormalizedEqual(
            normalizeComparableGqlPermission(existingPermission.permission),
            normalizeComparableGqlPermission(desiredPermission),
          )
        ) {
          changeSet.unchanged.push({ name: tableName });
        } else {
          changeSet.updates.push({
            name: tableName,
            request: {
              workspaceId,
              namespaceName: tailordb.namespace,
              typeName: tableName,
              permission: desiredPermission,
            },
          });
        }
        existingNameSet.delete(tableName);
      } else {
        changeSet.creates.push({
          name: tableName,
          request: {
            workspaceId,
            namespaceName: tailordb.namespace,
            typeName: tableName,
            permission: desiredPermission,
          },
        });
      }
    }
    existingNameSet.forEach((name) => {
      changeSet.deletes.push({
        name,
        request: {
          workspaceId,
          namespaceName: tailordb.namespace,
          typeName: name,
        },
      });
    });
  }
  for (const namespaceName of deletedServices) {
    const existingGqlPermissions = await fetchGqlPermissions(namespaceName);
    existingGqlPermissions.forEach((gqlPermission) => {
      changeSet.deletes.push({
        name: gqlPermission.typeName,
        request: {
          workspaceId,
          namespaceName,
          typeName: gqlPermission.typeName,
        },
      });
    });
  }
  return changeSet;
}
