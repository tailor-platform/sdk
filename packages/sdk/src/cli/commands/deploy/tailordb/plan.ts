import { type MessageInitShape } from "@bufbuild/protobuf";
import {
  type CreateTailorDBGQLPermissionRequestSchema,
  type CreateTailorDBServiceRequestSchema,
  type CreateTailorDBTypeRequestSchema,
  type DeleteTailorDBGQLPermissionRequestSchema,
  type DeleteTailorDBServiceRequestSchema,
  type DeleteTailorDBTypeRequestSchema,
  UpdateTailorDBGQLPermissionRequestSchema,
  type UpdateTailorDBTypeRequestSchema,
} from "@tailor-platform/tailor-proto/tailordb_pb";
import * as path from "pathe";
import { getNamespacesWithMigrations } from "#/cli/commands/tailordb/migrate/config";
import { captureMigrationFileState } from "#/cli/commands/tailordb/migrate/file-state";
import { getTablesDeletedAfterCheckpoint } from "#/cli/commands/tailordb/migrate/pre-migration-schema";
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
import { CLIError } from "#/cli/shared/errors";
import {
  assertNoPublishEventsConflict,
  namespacedNames,
  type NamespacedNames,
  publishEventsConflict,
  subscribesToEvents,
} from "#/cli/shared/publish-events";
import { namesSharedAcrossNamespaces } from "#/utils/tailordb-type-names";
import { createChangeSet } from "../change-set";
import { defineRequestComparison, isRequestUnchanged } from "../compare";
import { applicationsListing } from "../deploy-application";
import { localTailorDBTriggerNamespace } from "../executor";
import { diffKeyed, labeledResourceChecks } from "../keyed-diff";
import {
  addDependencyRecords,
  buildMetaRequest,
  type DependentAppsByResource,
  type DeployOwner,
  eventSourceKey,
  type MetadataLabelWrite,
  resourceTrn,
  tailorDBTypeTrn,
} from "../label";
import { createOwnershipTracker, fetchExistingResourcesWithLabels } from "../owned-resource";
import { tailordbTypeComparison } from "./compare";
import { assertPendingMigrationsRunnable } from "./migration";
import { selectSkipStepsOfNamespaces } from "./migration-skip-steps";
import {
  logMigrationPlanNotices,
  type ValidateAndDetectResult,
  validateAndDetectMigrations,
} from "./migration-validation";
import type { ListingApplication } from "../deploy-application";
import type { PlanContext } from "../types";

export type TailorDBPlanResult = Awaited<ReturnType<typeof planTailorDB>>;

export type TailorDBChangeSet = TailorDBPlanResult["changeSet"];

/** A change-set entry that names a table and the namespace it lives in. */
export type NamespacedEntry = { name: string; request: { namespaceName?: string | undefined } };

/**
 * Whether change-set entries name a table.
 * @param entries - Change-set entries
 * @param namespaceName - Namespace of the table
 * @param tableName - Name of the table
 * @returns Whether an entry names the table in the namespace
 */
export function plansTable(
  entries: readonly NamespacedEntry[],
  namespaceName: string,
  tableName: string,
): boolean {
  return entries.some(
    (entry) => entry.name === tableName && (entry.request.namespaceName ?? "") === namespaceName,
  );
}

/**
 * Whether the plan deletes a table and creates it again: the deletion runs before the
 * migrations or once the migration that removes the table commits, so the closing deletions
 * leave the table the deploy created again.
 * @param changeSet - TailorDB change set
 * @param namespaceName - Namespace of the table
 * @param tableName - Name of the table
 * @returns Whether the plan both deletes and creates a table of that name in the namespace
 */
export function isRecreated(
  changeSet: TailorDBChangeSet,
  namespaceName: string,
  tableName: string,
): boolean {
  return (
    plansTable(changeSet.type.deletes, namespaceName, tableName) &&
    plansTable(changeSet.type.creates, namespaceName, tableName)
  );
}

/**
 * Name the tables that the local definitions keep but whose remote table, if any, the deploy
 * deletes and creates again, so they start without the records they had: those whose deletion an
 * earlier deploy left unfinished, and those a pending migration removes or renames away.
 * @param detected - Validated migration state
 * @param tailordbs - TailorDB deploy inputs
 * @returns Table names by namespace
 */
export function recreatedTablesOf(
  detected: Pick<ValidateAndDetectResult, "unfinishedRemovals" | "pendingMigrations">,
  tailordbs: ReadonlyArray<TailorDBDeployInput>,
): Map<string, ReadonlySet<string>> {
  const removedTables = new Map<string, Set<string>>();
  const addRemoved = (namespace: string, tableNames: Iterable<string>) => {
    const removed = removedTables.get(namespace) ?? new Set<string>();
    for (const tableName of tableNames) removed.add(tableName);
    removedTables.set(namespace, removed);
  };
  for (const [namespace, { tableNames }] of detected.unfinishedRemovals) {
    addRemoved(namespace, tableNames);
  }
  for (const migration of detected.pendingMigrations) {
    addRemoved(migration.namespace, getTablesDeletedAfterCheckpoint(migration.diff));
  }
  const recreatedTables = new Map<string, ReadonlySet<string>>();
  for (const [namespace, tableNames] of removedTables) {
    const localTypes = tailordbs.find((tailordb) => tailordb.namespace === namespace)?.types ?? {};
    const kept = [...tableNames].filter((tableName) => Object.hasOwn(localTypes, tableName));
    if (kept.length > 0) recreatedTables.set(namespace, new Set(kept));
  }
  return recreatedTables;
}

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
    migrationSkipSteps,
    migrationRecoveryProfile,
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
  const executorUsedTables = namespacedNames([
    ...(context.executorUsedTailorDBTables?.entries ?? []),
    ...executors.flatMap((executor) => {
      if (!subscribesToEvents(executor) || executor.trigger.kind !== "tailordb") return [];
      const namespace = localTailorDBTriggerNamespace(application, executor.trigger);
      return namespace === undefined ? [] : [{ namespace, name: executor.trigger.tableName }];
    }),
  ]);

  // Validate migrations at plan time so a migration script that is missing,
  // cannot be bundled, or has no machine user to run it fails the deploy
  // (including --dry-run) before any resource is applied.
  const typesByNamespace = new Map<string, Record<string, TailorDBSnapshotType>>();
  for (const tailordb of tailordbs) {
    typesByNamespace.set(tailordb.namespace, tailordb.types);
  }
  const migrationTestBaselines = context.migrationTestBaselines;
  if (migrationTestSnapshots) {
    for (const namespace of migrationTestSnapshots.keys()) {
      if (!tailordbs.some((tailordb) => tailordb.namespace === namespace)) {
        throw CLIError({
          code: "MIGRATION_TEST_SNAPSHOT_INVALID",
          message: `Migration test snapshot targets unknown TailorDB namespace "${namespace}".`,
        });
      }
    }
  }
  const migrationConfig = forRemoval
    ? []
    : getNamespacesWithMigrations(config, path.dirname(config.path));
  const detected =
    forRemoval || migrationTestBaselines
      ? undefined
      : await validateAndDetectMigrations(
          client,
          workspaceId,
          typesByNamespace,
          config,
          noSchemaCheck ?? false,
          tailordbs,
          migrationRecoveryProfile,
        );
  if (detected) {
    await assertPendingMigrationsRunnable({
      client,
      workspaceId,
      requested: selectSkipStepsOfNamespaces(
        migrationSkipSteps,
        tailordbs.map((tailordb) => tailordb.namespace),
      ),
      pendingMigrations: detected.pendingMigrations,
      inProgressByNamespace: detected.inProgressMigrations,
      source: context,
    });
    logMigrationPlanNotices(detected);
  }
  const recreatedTables = detected
    ? recreatedTablesOf(detected, tailordbs)
    : new Map<string, ReadonlySet<string>>();
  const { namespacesWithMigrations, migrationFileState, checkpointRepairs, pendingMigrations } =
    detected ?? {
      namespacesWithMigrations: migrationConfig,
      migrationFileState: captureMigrationFileState(migrationConfig),
      checkpointRepairs: [],
      pendingMigrations: [],
    };

  const {
    changeSet: serviceChangeSet,
    conflicts,
    unmanaged,
    takeovers,
    resourceOwners,
  } = await planServices(client, workspaceId, context.owner, context.applications, tailordbs);
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
        owner: context.owner,
        dependentApps: context.dependentApps,
        runAppIds: context.runAppIds,
      },
      recreatedTables,
    ),
    planGqlPermissions(
      client,
      workspaceId,
      tailordbs,
      deletedServices,
      forceApplyAll,
      recreatedTables,
    ),
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
    takeovers,
    resourceOwners,
    context: {
      workspaceId,
      application,
      owner: context.owner,
      tailorDBInputs: tailordbs,
      executorUsedTables,
      config,
      noSchemaCheck: noSchemaCheck ?? false,
      ...(migrationSkipSteps ? { migrationSkipSteps } : {}),
      ...(migrationRecoveryProfile ? { migrationRecoveryProfile } : {}),
      ...(migrationTestBaselines ? { migrationTestBaselines } : {}),
      ...(context.migrationMachineUserOverride !== undefined
        ? { migrationMachineUserOverride: context.migrationMachineUserOverride }
        : {}),
      namespacesWithMigrations,
      migrationFileState,
      checkpointRepairs,
      pendingMigrations: pendingMigrations.map(({ namespace, number }) => ({ namespace, number })),
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

type DesiredService = {
  name: string;
  metaRequest: MetadataLabelWrite;
};

async function planServices(
  client: OperatorClient,
  workspaceId: string,
  owner: DeployOwner,
  applications: ReadonlyArray<ListingApplication>,
  tailordbs: ReadonlyArray<TailorDBDeployInput>,
) {
  const changeSet = createChangeSet<CreateService, UpdateService, DeleteService>(
    "TailorDB services",
  );
  const ownership = createOwnershipTracker(owner);

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

  const desired: DesiredService[] = [];
  for (const tailordb of tailordbs) {
    desired.push({
      name: tailordb.namespace,
      metaRequest: await buildMetaRequest({
        trn: resourceTrn(workspaceId, "tailordb", tailordb.namespace),
        owner,
        onApps: applicationsListing(applications, "tailordb", tailordb.namespace),
      }),
    });
  }

  await diffKeyed({
    changeSet,
    desired,
    existing: Object.entries(existingServices),
    keyOf: (service) => service.name,
    ...labeledResourceChecks(ownership, "tailordb.service"),
    // An update writes only the labels, so no setting of the service can differ from it.
    isConfigUnchanged: () => true,
    create: ({ name, metaRequest }) => ({
      name,
      request: {
        workspaceId,
        namespaceName: name,
        // Keep generated TailorDB services aligned with Terraform defaults.
        defaultTimezone: "UTC",
      },
      metaRequest,
    }),
    update: ({ name, metaRequest }) => ({ name, metaRequest }),
    unchanged: ({ name }) => ({ name }),
    delete: (namespaceName) => ({ name: namespaceName, request: { workspaceId, namespaceName } }),
  });

  return { changeSet, ...ownership.result };
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
  request: { namespaceName: string };
  metaRequest?: MetadataLabelWrite | undefined;
};

/** What planTypes needs to record dependencies on each table. */
type TypeRecordInputs = {
  owner: DeployOwner;
  dependentApps?: DependentAppsByResource | undefined;
  runAppIds?: ReadonlySet<string> | undefined;
};

type DeleteType = {
  name: string;
  request: MessageInitShape<typeof DeleteTailorDBTypeRequestSchema>;
};

type DesiredType = {
  name: string;
  request: MessageInitShape<typeof CreateTailorDBTypeRequestSchema> &
    MessageInitShape<typeof UpdateTailorDBTypeRequestSchema>;
  metaRequest: MetadataLabelWrite;
};

async function planTypes(
  client: OperatorClient,
  workspaceId: string,
  tailordbs: ReadonlyArray<TailorDBDeployInput>,
  executorUsedTables: NamespacedNames,
  deletedServices: ReadonlyArray<string>,
  filteredTypesByNamespace: Map<string, Record<string, TailorDBSnapshotType>> | undefined,
  forceApplyAll: boolean,
  records: TypeRecordInputs,
  recreatedTables: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
) {
  const changeSet = createChangeSet<CreateType, UpdateType, DeleteType, never, UnchangedType>(
    "TailorDB tables",
  );
  const { owner, dependentApps, runAppIds } = records;

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
    return addDependencyRecords(await buildMetaRequest({ trn, owner }), {
      owner,
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
  const sharedTableNames = namesSharedAcrossNamespaces(
    tailordbs.map((tailordb) =>
      Object.keys(filteredTypesByNamespace?.get(tailordb.namespace) ?? tailordb.types),
    ),
  );
  for (const tailordb of tailordbs) {
    const types = filteredTypesByNamespace?.get(tailordb.namespace) ?? tailordb.types;
    for (const [tableName, type] of Object.entries(types)) {
      assertNoPublishEventsConflict({
        explicit: type.settings?.publishEvents,
        subscribed: executorUsedTables.has(tailordb.namespace, tableName),
        conflict: publishEventsConflict.tailorDBType(
          tableName,
          sharedTableNames.has(tableName) ? tailordb.namespace : undefined,
        ),
      });
    }
  }

  const namespaces = [
    ...tailordbs.map((tailordb) => ({
      namespaceName: tailordb.namespace,
      // Use filtered tables if provided, otherwise use local tables
      types: filteredTypesByNamespace?.get(tailordb.namespace) ?? tailordb.types,
      gqlOperations: tailordb.config.gqlOperations,
    })),
    ...deletedServices.map((namespaceName) => ({
      namespaceName,
      types: {},
      gqlOperations: undefined,
    })),
  ];
  for (const { namespaceName, types, gqlOperations } of namespaces) {
    const remoteTypes = await fetchTypes(namespaceName);
    const recreated = recreatedTables.get(namespaceName);
    const existingTypes = remoteTypes.filter((type) => !recreated?.has(type.name));
    const desired: DesiredType[] = [];
    for (const [tableName, tailordbTypeSnapshot] of Object.entries(types)) {
      desired.push({
        name: tableName,
        request: {
          workspaceId,
          namespaceName,
          tailordbType: generateTailorDBTypeManifestFromSnapshot(tailordbTypeSnapshot, {
            subscribed: executorUsedTables.has(namespaceName, tableName),
            namespaceGqlOperations: gqlOperations,
          }),
        },
        metaRequest: await typeMetaRequest(
          namespaceName,
          tableName,
          tailordbTypeSnapshot.settings?.publishEvents,
        ),
      });
    }
    await diffKeyed({
      changeSet,
      desired,
      existing: existingTypes.map((type) => [type.name, type] as const),
      keyOf: (type) => type.name,
      versionMatches: () => !forceApplyAll,
      isConfigUnchanged: (type, existing) =>
        isRequestUnchanged(tailordbTypeComparison, type.request, { tailordbType: existing }),
      create: ({ name, request, metaRequest }) => ({ name, request, metaRequest }),
      update: ({ name, request, metaRequest }) => ({ name, request, metaRequest }),
      // The schema matches, but the records may not, so the labels still go.
      unchanged: ({ name, metaRequest }) => ({ name, request: { namespaceName }, metaRequest }),
      delete: (tailordbTypeName) => ({
        name: tailordbTypeName,
        request: { workspaceId, namespaceName, tailordbTypeName },
      }),
    });
    for (const type of remoteTypes) {
      if (!recreated?.has(type.name)) continue;
      changeSet.deletes.push({
        name: type.name,
        request: { workspaceId, namespaceName, tailordbTypeName: type.name },
      });
    }
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
  previousPermission: MessageInitShape<
    typeof UpdateTailorDBGQLPermissionRequestSchema
  >["permission"];
};

type DeleteGqlPermission = {
  name: string;
  request: MessageInitShape<typeof DeleteTailorDBGQLPermissionRequestSchema>;
};

type DesiredGqlPermission = {
  name: string;
  request: MessageInitShape<typeof CreateTailorDBGQLPermissionRequestSchema> &
    MessageInitShape<typeof UpdateTailorDBGQLPermissionRequestSchema>;
};

const gqlPermissionComparison = defineRequestComparison({
  schema: UpdateTailorDBGQLPermissionRequestSchema,
  excluded: ["workspaceId", "namespaceName", "typeName"],
  normalize: ({ permission }) => {
    if (!permission) return;
    // The platform assigns the id.
    permission.id = "";
    for (const policy of permission.policies) {
      policy.actions.sort((left, right) => left - right);
    }
  },
});

async function planGqlPermissions(
  client: OperatorClient,
  workspaceId: string,
  tailordbs: ReadonlyArray<TailorDBDeployInput>,
  deletedServices: ReadonlyArray<string>,
  forceApplyAll = false,
  recreatedTables: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
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

  const namespaces: ReadonlyArray<{ namespaceName: string; types: TailorDBDeployInput["types"] }> =
    [
      ...tailordbs.map((tailordb) => ({
        namespaceName: tailordb.namespace,
        types: tailordb.types,
      })),
      ...deletedServices.map((namespaceName) => ({ namespaceName, types: {} })),
    ];
  for (const { namespaceName, types } of namespaces) {
    const remoteGqlPermissions = await fetchGqlPermissions(namespaceName);
    const recreated = recreatedTables.get(namespaceName);
    const existingGqlPermissions = remoteGqlPermissions.filter(
      (entry) => !recreated?.has(entry.typeName),
    );
    const desired: DesiredGqlPermission[] = Object.entries(types).flatMap(
      ([typeName, typeEntry]) => {
        const gqlPermission = typeEntry.permissions?.gql;
        if (!gqlPermission) return [];
        const permission = protoGqlPermission(gqlPermission);
        return [{ name: typeName, request: { workspaceId, namespaceName, typeName, permission } }];
      },
    );
    await diffKeyed({
      changeSet,
      desired,
      existing: existingGqlPermissions.map((entry) => [entry.typeName, entry] as const),
      keyOf: (gqlPermission) => gqlPermission.name,
      versionMatches: () => !forceApplyAll,
      isConfigUnchanged: (gqlPermission, existing) =>
        isRequestUnchanged(gqlPermissionComparison, gqlPermission.request, existing),
      create: ({ name, request }) => ({ name, request }),
      update: ({ name, request }, existing) => ({
        name,
        request,
        previousPermission: existing.permission,
      }),
      unchanged: ({ name }) => ({ name }),
      delete: (typeName) => ({ name: typeName, request: { workspaceId, namespaceName, typeName } }),
    });
    for (const entry of remoteGqlPermissions) {
      if (!recreated?.has(entry.typeName)) continue;
      changeSet.deletes.push({
        name: entry.typeName,
        request: { workspaceId, namespaceName, typeName: entry.typeName },
      });
    }
  }
  return changeSet;
}
