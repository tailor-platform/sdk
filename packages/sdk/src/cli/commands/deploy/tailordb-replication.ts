import { type MessageInitShape } from "@bufbuild/protobuf";
import {
  type CreateTailorDBReplicationDestinationRequestSchema,
  type CreateTailorDBReplicationRequestSchema,
  type DeleteTailorDBReplicationDestinationRequestSchema,
  type DeleteTailorDBReplicationRequestSchema,
  UpdateTailorDBReplicationRequestSchema,
} from "@tailor-platform/tailor-proto/tailordb_pb";
import {
  type TailorDBReplication as ProtoReplication,
  type TailorDBReplicationDestination as ProtoDestination,
  type TailorDBReplication_SourceType as ProtoSourceType,
  TailorDBReplicationDestination_State as DestinationState,
} from "@tailor-platform/tailor-proto/tailordb_resource_pb";
import { type OperatorClient } from "#/cli/shared/client";
import { CLIError } from "#/cli/shared/errors";
import { logger, styles } from "#/cli/shared/logger";
import { createChangeSet } from "./change-set";
import { defineRequestComparison, isRequestUnchanged } from "./compare";
import { diffKeyed, labeledResourceChecks } from "./keyed-diff";
import {
  buildMetaRequest,
  type MetadataLabelWrite,
  resourceTrn,
  writeLabelRefreshes,
  writeMetadataLabels,
} from "./label";
import { createOwnershipTracker, fetchExistingResourcesWithLabels } from "./owned-resource";
import type { ApplyPhase, PlanContext } from "#/cli/commands/deploy/types";
import type {
  TailorDBReplication,
  TailorDBReplicationDestination,
} from "#/types/tailordb-replication.generated";
import type { TailorDBPlanResult } from "./tailordb/plan";

type ReplicationRequest = MessageInitShape<typeof CreateTailorDBReplicationRequestSchema>;

type SourceTypeInit = {
  name: string;
  fields?: { case: "excludeFields" | "includeFields"; value: { names: string[] } };
};

/** A replication as deploy sends it. */
type ReplicationInit = {
  name: string;
  source: { namespace: string; types: SourceTypeInit[] };
  destination: string;
  tablePrefix?: string;
  enabled: boolean;
};

type CreateDestination = {
  name: string;
  request: MessageInitShape<typeof CreateTailorDBReplicationDestinationRequestSchema>;
  metaRequest: MetadataLabelWrite;
};

/** A same-named destination this deploy takes over: only its labels are written. */
type UpdateDestination = {
  name: string;
  metaRequest: MetadataLabelWrite;
};

type UnchangedDestination = {
  name: string;
  pendingPermission: boolean;
};

type DeleteDestination = {
  name: string;
  request: MessageInitShape<typeof DeleteTailorDBReplicationDestinationRequestSchema>;
};

type CreateReplication = {
  name: string;
  replication: ReplicationInit;
  request: ReplicationRequest;
  metaRequest: MetadataLabelWrite;
};

type UpdateReplication = {
  name: string;
  replication: ReplicationInit;
  request: MessageInitShape<typeof UpdateTailorDBReplicationRequestSchema>;
  metaRequest: MetadataLabelWrite;
};

type DeleteReplication = {
  name: string;
  request: MessageInitShape<typeof DeleteTailorDBReplicationRequestSchema>;
};

/** A replication whose source namespace changed, so it is deleted and created again. */
type ReplaceReplication = {
  name: string;
  deleteRequest: MessageInitShape<typeof DeleteTailorDBReplicationRequestSchema>;
  replication: ReplicationInit;
  request: ReplicationRequest;
  metaRequest: MetadataLabelWrite;
};

/** A kept replication that stops listing the types TailorDB deletes in this deploy, before they are deleted. */
type DetachReplication = {
  name: string;
  typeNames: string[];
  request: { workspaceId: string; replication: ReplicationInit };
};

type DesiredReplication = {
  name: string;
  replication: ReplicationInit;
  metaRequest: MetadataLabelWrite;
};

const replicationComparison = defineRequestComparison({
  schema: UpdateTailorDBReplicationRequestSchema,
  excluded: ["workspaceId", "updateMask"],
  normalize: (request) => {
    const types = request.replication?.source?.types ?? [];
    types.sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const type of types) type.fields.value?.names.sort();
  },
});

function sourceTypeOf(type: TailorDBReplication["types"][number]): SourceTypeInit {
  if (type.excludeFields) {
    return {
      name: type.name,
      fields: { case: "excludeFields", value: { names: [...type.excludeFields] } },
    };
  }
  if (type.includeFields) {
    return {
      name: type.name,
      fields: { case: "includeFields", value: { names: [...type.includeFields] } },
    };
  }
  return { name: type.name };
}

function replicationInitOf(config: TailorDBReplication): ReplicationInit {
  return {
    name: config.name,
    source: { namespace: config.source.namespace, types: config.types.map(sourceTypeOf) },
    destination: config.destination,
    ...(config.tablePrefix !== undefined && { tablePrefix: config.tablePrefix }),
    enabled: config.enabled,
  };
}

function existingReplicationInit(existing: ProtoReplication): ReplicationInit {
  return {
    name: existing.name,
    source: {
      namespace: existing.source?.namespace ?? "",
      types: (existing.source?.types ?? []).map((type: ProtoSourceType): SourceTypeInit =>
        type.fields.case === undefined
          ? { name: type.name }
          : {
              name: type.name,
              fields: { case: type.fields.case, value: { names: [...type.fields.value.names] } },
            },
      ),
    },
    destination: existing.destination,
    ...(existing.tablePrefix !== undefined && { tablePrefix: existing.tablePrefix }),
    enabled: existing.enabled,
  };
}

function bigQueryOf(destination: ProtoDestination) {
  return destination.kind.case === "bigquery" ? destination.kind.value : undefined;
}

function assertDestinationsUnmoved(
  desired: ReadonlyArray<TailorDBReplicationDestination>,
  existing: Readonly<Record<string, { resource: ProtoDestination } | undefined>>,
): void {
  const moved = desired.flatMap((destination) => {
    const current = existing[destination.name];
    if (!current) return [];
    const bigquery = bigQueryOf(current.resource);
    if (
      bigquery?.project === destination.bigquery.project &&
      bigquery.dataset === destination.bigquery.dataset
    ) {
      return [];
    }
    return [
      `"${destination.name}" writes to ${bigquery ? `${bigquery.project}.${bigquery.dataset}` : "another kind of destination"}, not ${destination.bigquery.project}.${destination.bigquery.dataset}`,
    ];
  });
  if (moved.length === 0) return;
  throw CLIError({
    code: "TAILORDB_REPLICATION_DESTINATION_IMMUTABLE",
    message: `A replication destination's dataset cannot be changed:\n${moved.map((line) => `  - ${line}`).join("\n")}`,
    suggestion:
      "Give the destination for the new dataset a new name, and point the replications at it.",
    context: { destinations: moved },
  });
}

/**
 * Lowercase a destination table name, as the platform compares them.
 * @param tablePrefix - Table prefix of the replication
 * @param typeName - Replicated type
 * @returns The table name, lowercased
 */
function replicationTableKey(tablePrefix: string | undefined, typeName: string): string {
  return `${tablePrefix ?? ""}${typeName}`.toLowerCase();
}

type TableClaim = { destination: string; tables: ReadonlySet<string> };

function claimOf(replication: ReplicationInit): TableClaim {
  return {
    destination: replication.destination,
    tables: new Set(
      replication.source.types.map((type) =>
        replicationTableKey(replication.tablePrefix, type.name),
      ),
    ),
  };
}

type ReplicationWrite = { name: string; replication: ReplicationInit };

type OrderReplicationWritesParams = {
  /** Every replication in the workspace, whoever owns it. */
  existing: ReadonlyMap<string, ReplicationInit>;
  /** Replications deleted before any write. */
  deleted: ReadonlySet<string>;
  /** Replications detached before any write, with the types they keep. */
  detached: ReadonlyMap<string, ReplicationInit>;
  writes: ReadonlyArray<ReplicationWrite>;
};

/**
 * Order the replication creates and updates so that none writes a table another
 * replication of the same destination still writes when it runs.
 * @param params - Workspace replications and the writes this deploy makes
 * @returns The writes in an order the platform accepts
 * @throws CLIError coded `TAILORDB_REPLICATION_TABLE_CONFLICT` when no order avoids a conflict
 */
function orderReplicationWrites(params: OrderReplicationWritesParams): ReplicationWrite[] {
  const claims = new Map<string, TableClaim>();
  for (const [name, replication] of params.existing) {
    if (params.deleted.has(name)) continue;
    claims.set(name, claimOf(params.detached.get(name) ?? replication));
  }
  const conflictsOf = (write: ReplicationWrite) => {
    const claim = claimOf(write.replication);
    return [...claims].flatMap(([name, other]) =>
      name === write.name || other.destination !== claim.destination
        ? []
        : [...claim.tables]
            .filter((table) => other.tables.has(table))
            .map((table) => ({ replication: write.name, table, writtenBy: name })),
    );
  };
  const ordered: ReplicationWrite[] = [];
  const pending = [...params.writes];
  while (pending.length > 0) {
    const next = pending.findIndex((write) => conflictsOf(write).length === 0);
    if (next < 0) {
      const conflicts = pending.flatMap(conflictsOf);
      throw CLIError({
        code: "TAILORDB_REPLICATION_TABLE_CONFLICT",
        message: `Replications would write tables another replication still writes:\n${conflicts
          .map(
            ({ replication, table, writtenBy }) =>
              `  - "${replication}" would write table "${table}", which "${writtenBy}" writes`,
          )
          .join("\n")}`,
        suggestion:
          "Deploy in two steps: first move one of these replications to tables no other replication writes and deploy, then make the rest of the change and deploy again.",
        context: { conflicts },
      });
    }
    const [write] = pending.splice(next, 1);
    if (write) {
      ordered.push(write);
      claims.set(write.name, claimOf(write.replication));
    }
  }
  return ordered;
}

function assertNoTableCollisionsWithin(desired: ReadonlyArray<DesiredReplication>): void {
  const collisions = desired.flatMap(({ name, replication }) => {
    const seen = new Map<string, string>();
    return replication.source.types.flatMap((type) => {
      const table = replicationTableKey(replication.tablePrefix, type.name);
      const other = seen.get(table);
      seen.set(table, type.name);
      return other === undefined
        ? []
        : [`"${name}" maps "${other}" and "${type.name}" to one table`];
    });
  });
  if (collisions.length === 0) return;
  throw CLIError({
    code: "TAILORDB_REPLICATION_TABLE_CONFLICT",
    message: `Destination table names are compared case-insensitively:\n${collisions.map((line) => `  - ${line}`).join("\n")}`,
    suggestion: "Replicate these types in separate replications with different table prefixes.",
    context: { collisions },
  });
}

function detachesOf(
  existing: ReadonlyMap<string, ReplicationInit>,
  kept: ReadonlySet<string>,
  tailorDB: Pick<TailorDBPlanResult, "changeSet">,
  workspaceId: string,
): DetachReplication[] {
  const deletedTypes = new Set(
    tailorDB.changeSet.type.deletes.map((del) => `${del.request.namespaceName}/${del.name}`),
  );
  return [...existing].flatMap(([name, replication]) => {
    if (!kept.has(name)) return [];
    const { namespace, types } = replication.source;
    const typeNames = types
      .map((type) => type.name)
      .filter((typeName) => deletedTypes.has(`${namespace}/${typeName}`));
    if (typeNames.length === 0) return [];
    return [
      {
        name,
        typeNames,
        request: {
          workspaceId,
          replication: {
            ...replication,
            source: {
              namespace,
              types: types.filter((type) => !typeNames.includes(type.name)),
            },
          },
        },
      },
    ];
  });
}

/**
 * Plan TailorDB replication destination and replication changes.
 * @param context - Planning context
 * @param tailorDB - TailorDB plan of the same deployment, whose type deletes replications must stop listing first
 * @returns Planned changes
 */
export async function planTailorDBReplication(
  context: PlanContext,
  tailorDB: Pick<TailorDBPlanResult, "changeSet">,
) {
  const { client, workspaceId, application, owner, forRemoval } = context;
  const destination = createChangeSet<
    CreateDestination,
    UpdateDestination,
    DeleteDestination,
    never,
    UnchangedDestination
  >("TailorDB replication destinations");
  const replication = createChangeSet<
    CreateReplication,
    UpdateReplication,
    DeleteReplication,
    ReplaceReplication
  >("TailorDB replications");
  const ownership = createOwnershipTracker(owner);

  const [existingDestinations, existingReplications] = await Promise.all([
    fetchExistingResourcesWithLabels({
      client,
      fetchPage: async (pageToken, pageSize) => {
        const { destinations, nextPageToken } = await client.listTailorDBReplicationDestinations({
          workspaceId,
          pageToken,
          pageSize,
        });
        return [destinations, nextPageToken];
      },
      getName: (resource) => resource.name,
      getTrn: (name) => resourceTrn(workspaceId, "tailordb_replication_destination", name),
    }),
    fetchExistingResourcesWithLabels({
      client,
      fetchPage: async (pageToken, pageSize) => {
        const { replications, nextPageToken } = await client.listTailorDBReplications({
          workspaceId,
          pageToken,
          pageSize,
        });
        return [replications, nextPageToken];
      },
      getName: (resource) => resource.name,
      getTrn: (name) => resourceTrn(workspaceId, "tailordb_replication", name),
    }),
  ]);

  const desiredDestinations = forRemoval ? [] : application.tailordbReplicationDestinations;
  const desiredReplications = forRemoval ? [] : application.tailordbReplications;
  assertDestinationsUnmoved(desiredDestinations, existingDestinations);

  const destinationChecks = labeledResourceChecks(ownership, "tailordb.replication_destination");
  await diffKeyed({
    changeSet: destination,
    desired: await Promise.all(
      desiredDestinations.map(async (config) => ({
        config,
        metaRequest: await buildMetaRequest({
          trn: resourceTrn(workspaceId, "tailordb_replication_destination", config.name),
          owner,
        }),
      })),
    ),
    existing: Object.entries(existingDestinations),
    keyOf: ({ config }) => config.name,
    ...destinationChecks,
    versionMatches: () => true,
    isConfigUnchanged: () => true,
    create: ({ config, metaRequest }) => ({
      name: config.name,
      request: {
        workspaceId,
        destination: {
          name: config.name,
          kind: {
            case: "bigquery" as const,
            value: { project: config.bigquery.project, dataset: config.bigquery.dataset },
          },
        },
      },
      metaRequest,
    }),
    update: ({ config, metaRequest }) => ({ name: config.name, metaRequest }),
    unchanged: ({ config }, existing) => ({
      name: config.name,
      pendingPermission: existing.resource.status?.state === DestinationState.PENDING_PERMISSION,
    }),
    delete: (name) => ({ name, request: { workspaceId, name } }),
  });

  const desired: DesiredReplication[] = await Promise.all(
    desiredReplications.map(async (config) => ({
      name: config.name,
      replication: replicationInitOf(config),
      metaRequest: await buildMetaRequest({
        trn: resourceTrn(workspaceId, "tailordb_replication", config.name),
        owner,
      }),
    })),
  );
  assertNoTableCollisionsWithin(desired);

  await diffKeyed({
    changeSet: replication,
    desired,
    existing: Object.entries(existingReplications),
    keyOf: (item) => item.name,
    ...labeledResourceChecks(ownership, "tailordb.replication"),
    isConfigUnchanged: (item, existing) =>
      isRequestUnchanged(
        replicationComparison,
        { replication: item.replication },
        { replication: existing.resource },
      ),
    replace: (item, existing) =>
      existing.resource.source?.namespace === item.replication.source.namespace
        ? undefined
        : {
            name: item.name,
            deleteRequest: { workspaceId, name: item.name },
            replication: item.replication,
            request: { workspaceId, replication: item.replication },
            metaRequest: item.metaRequest,
          },
    create: (item) => ({
      name: item.name,
      replication: item.replication,
      request: { workspaceId, replication: item.replication },
      metaRequest: item.metaRequest,
    }),
    update: (item) => ({
      name: item.name,
      replication: item.replication,
      request: { workspaceId, replication: item.replication },
      metaRequest: item.metaRequest,
    }),
    unchanged: (item) => ({ name: item.name }),
    delete: (name) => ({ name, request: { workspaceId, name } }),
  });

  const existingInits = new Map(
    Object.entries(existingReplications).flatMap(([name, entry]) =>
      entry ? [[name, existingReplicationInit(entry.resource)] as const] : [],
    ),
  );
  const deleted = new Set([
    ...replication.deletes.map(({ name }) => name),
    ...replication.replaces.map(({ name }) => name),
  ]);
  const kept = new Set([...replication.updates, ...replication.unchanged].map(({ name }) => name));
  const detaches = detachesOf(existingInits, kept, tailorDB, workspaceId);
  const writeOrder = orderReplicationWrites({
    existing: existingInits,
    deleted,
    detached: new Map(detaches.map((detach) => [detach.name, detach.request.replication])),
    writes: [...replication.creates, ...replication.replaces, ...replication.updates].map(
      (item) => ({ name: item.name, replication: item.replication }),
    ),
  }).map(({ name }) => name);

  const referenced = new Set(
    [...existingInits]
      .filter(([name]) => !deleted.has(name))
      .map(([, existing]) => existing.destination),
  );
  const earlyDestinationDeletes = new Set(
    destination.deletes.filter(({ name }) => !referenced.has(name)).map(({ name }) => name),
  );

  return {
    workspaceId,
    changeSet: { destination, replication },
    detaches,
    writeOrder,
    earlyDestinationDeletes,
    ...ownership.result,
    existingDestinations,
    existingReplications,
  };
}

export type TailorDBReplicationPlanResult = Awaited<ReturnType<typeof planTailorDBReplication>>;

/**
 * Phase of a TailorDB replication apply, in the order a deploy runs them:
 * - `"prepare"`: delete removed replications and the destinations nothing references any more,
 *   create destinations, and detach the types TailorDB deletes in this deploy
 * - `"create-update"`: once TailorDB is applied, create and update replications
 * - `"delete"`: delete the remaining removed destinations
 */
type TailorDBReplicationApplyPhase = "prepare" | Extract<ApplyPhase, "create-update" | "delete">;

function grantInstructions(email: string, dataset: string): string {
  return `Grant ${styles.bold(email)} the BigQuery Data Editor role on dataset ${styles.bold(dataset)} and the BigQuery Job User role on its project; the next deploy checks the grant again.`;
}

function reportDestination(destination: ProtoDestination | undefined, created: boolean): void {
  if (!destination) return;
  const bigquery = bigQueryOf(destination);
  const dataset = bigquery ? `${bigquery.project}.${bigquery.dataset}` : destination.name;
  const email = bigquery?.serviceAccountEmail ?? "";
  const state = destination.status?.state;
  if (state === DestinationState.ACTIVE) {
    if (created)
      logger.success(`Replication destination "${destination.name}" can write to ${dataset}.`);
    return;
  }
  const reason = destination.status?.message ? ` ${destination.status.message}` : "";
  logger.warn(
    `Replication destination "${destination.name}" cannot write to ${dataset} yet.${reason}`,
  );
  logger.log(`  ${grantInstructions(email, dataset)}`);
}

/**
 * Apply TailorDB replication changes for the given phase.
 * @param client - Operator client instance
 * @param result - Planned TailorDB replication changes
 * @param phase - Apply phase
 */
export async function applyTailorDBReplication(
  client: OperatorClient,
  result: TailorDBReplicationPlanResult,
  phase: TailorDBReplicationApplyPhase,
): Promise<void> {
  const { destination, replication } = result.changeSet;
  if (phase === "prepare") {
    await Promise.all([
      ...replication.deletes.map((del) => client.deleteTailorDBReplication(del.request)),
      ...replication.replaces.map((replace) =>
        client.deleteTailorDBReplication(replace.deleteRequest),
      ),
    ]);
    await Promise.all(
      destination.deletes
        .filter(({ name }) => result.earlyDestinationDeletes.has(name))
        .map((del) => client.deleteTailorDBReplicationDestination(del.request)),
    );
    for (const create of destination.creates) {
      await client.createTailorDBReplicationDestination(create.request);
      await writeMetadataLabels(client, create.metaRequest);
      const { destination: created } = await client.getTailorDBReplicationDestination({
        workspaceId: result.workspaceId,
        name: create.name,
      });
      reportDestination(created, true);
    }
    await Promise.all([
      ...destination.updates.map((update) => writeMetadataLabels(client, update.metaRequest)),
      ...writeLabelRefreshes(client, destination.unchanged),
    ]);
    for (const pending of destination.unchanged.filter((item) => item.pendingPermission)) {
      const response = await client.verifyTailorDBReplicationDestination({
        workspaceId: result.workspaceId,
        name: pending.name,
      });
      reportDestination(response.destination, false);
    }
    await Promise.all(
      result.detaches.map((detach) => client.updateTailorDBReplication(detach.request)),
    );
    return;
  }
  if (phase === "create-update") {
    const writes = new Map(
      [...replication.creates, ...replication.replaces].map((item) => [
        item.name,
        async () => {
          await client.createTailorDBReplication(item.request);
          await writeMetadataLabels(client, item.metaRequest);
        },
      ]),
    );
    for (const update of replication.updates) {
      writes.set(update.name, async () => {
        await client.updateTailorDBReplication(update.request);
        await writeMetadataLabels(client, update.metaRequest);
      });
    }
    for (const name of result.writeOrder) {
      await writes.get(name)?.();
    }
    await Promise.all(writeLabelRefreshes(client, replication.unchanged));
    return;
  }
  await Promise.all(
    destination.deletes
      .filter(({ name }) => !result.earlyDestinationDeletes.has(name))
      .map((del) => client.deleteTailorDBReplicationDestination(del.request)),
  );
}
