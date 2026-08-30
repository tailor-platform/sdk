import { getOrNull } from "#/cli/shared/client";
import { toError } from "#/cli/shared/errors";
import { readPackageJson } from "#/cli/shared/package-json";
import { DeployLockLostError } from "./deploy-lock-error";
import type { MessageInitShape } from "@bufbuild/protobuf";
import type {
  BulkSetMetadataRequestSchema,
  SetMetadataRequestSchema,
} from "@tailor-platform/tailor-proto/metadata_pb";

export type WithLabel<T> = Partial<
  Record<
    string,
    {
      resource: T;
      label: string | undefined;
      allLabels?: Record<string, string>;
    }
  >
>;

/**
 * Build TRN prefix for a workspace.
 * @param workspaceId - Workspace ID
 * @returns TRN prefix string
 */
function trnPrefix(workspaceId: string): string {
  return `trn:v1:workspace:${workspaceId}`;
}

/**
 * Resource kind segment used in a TRN (`trn:v1:workspace:<id>:<kind>:<name>`).
 */
export type ResourceKind =
  | "application"
  | "function_registry"
  | "pipeline"
  | "idp"
  | "auth"
  | "auth_connection"
  | "executor"
  | "workflow"
  | "workflow_job_function"
  | "workflow_job_function_execution_policy"
  | "staticwebsite"
  | "aigateway"
  | "tailordb"
  | "vault";

/**
 * Build the TRN for a workspace resource.
 * @param workspaceId - Workspace ID
 * @param kind - Resource kind segment
 * @param name - Resource name
 * @returns Fully-qualified TRN string
 */
export function resourceTrn(workspaceId: string, kind: ResourceKind, name: string): string {
  return `${trnPrefix(workspaceId)}:${kind}:${name}`;
}

/**
 * Build the TRN for a resource nested inside another.
 *
 * The platform reads everything after the workspace id as alternating key/value
 * pairs and matches the pair list against one resource type, so a nested
 * resource is the parent's pair followed by its own. A TailorDB table is
 * `tailordb:<namespace>:type:<name>`, distinct from the namespace's own
 * `tailordb:<namespace>`.
 * @param workspaceId - Workspace ID
 * @param parent - Parent kind and name, e.g. the namespace holding the resource
 * @param child - Nested key and name, e.g. `["type", "Order"]`
 * @returns Fully-qualified TRN string
 */
function nestedResourceTrn(
  workspaceId: string,
  parent: readonly [ResourceKind, string],
  child: readonly [NestedResourceKey, string],
): string {
  return `${trnPrefix(workspaceId)}:${parent[0]}:${parent[1]}:${child[0]}:${child[1]}`;
}

/** Key naming a resource nested inside a namespace in a TRN. */
type NestedResourceKey = "type" | "resolver";

/**
 * Build the TRN for one TailorDB table.
 * @param workspaceId - Workspace ID
 * @param namespace - TailorDB namespace holding the table
 * @param typeName - Table name
 * @returns Fully-qualified TRN string
 */
export function tailorDBTypeTrn(workspaceId: string, namespace: string, typeName: string): string {
  return nestedResourceTrn(workspaceId, ["tailordb", namespace], ["type", typeName]);
}

/**
 * Build the TRN for one resolver.
 * @param workspaceId - Workspace ID
 * @param namespace - Resolver namespace holding the resolver
 * @param resolverName - Resolver name
 * @returns Fully-qualified TRN string
 */
export function resolverTrn(workspaceId: string, namespace: string, resolverName: string): string {
  return nestedResourceTrn(workspaceId, ["pipeline", namespace], ["resolver", resolverName]);
}

export const sdkNameLabelKey = "sdk-name";
export const sdkVersionLabelKey = "sdk-version";
export const sdkAppIdLabelKey = "sdk-app-id";

// The metadata label value regex requires a leading lowercase letter, while
// the auto-generated app id is a plain UUID (which may start with a digit).
// The `app-` prefix is added at the metadata boundary so the user-facing id
// in `tailor.config.ts` can stay a plain UUID.
const appIdLabelPrefix = "app-";

export function sdkAppIdLabelValue(appId: string): string {
  return `${appIdLabelPrefix}${appId}`;
}

/**
 * Check whether existing metadata was produced by the current SDK version.
 * @param existingLabels - Labels currently stored on the remote resource
 * @param desiredLabels - Labels that will be written by the current apply run
 * @returns True when sdk-version matches
 */
export function hasMatchingSdkVersion(
  existingLabels: Record<string, string> | undefined,
  desiredLabels: Record<string, string> | undefined,
): boolean {
  return existingLabels?.[sdkVersionLabelKey] === desiredLabels?.[sdkVersionLabelKey];
}

/**
 * Determine whether a remote resource is owned by the given application.
 * When the resource carries an `sdk-app-id`, ownership is decided strictly
 * by id match — a resource explicitly tagged with another app's id is
 * NOT ours even if the legacy sdk-name happens to match. Resources without
 * `sdk-app-id` (legacy) fall back to sdk-name comparison.
 * @param labels - Labels currently stored on the remote resource
 * @param appName - Application name from the local config
 * @param appId - Stable application id from the local config (when present)
 * @returns True when the resource is owned by the application
 */
export function isOwnedByApp(
  labels: Record<string, string> | undefined,
  appName: string,
  appId: string | undefined,
): boolean {
  if (!labels) return false;
  const labelAppId = labels[sdkAppIdLabelKey];
  if (labelAppId) {
    return appId !== undefined && labelAppId === sdkAppIdLabelValue(appId);
  }
  return labels[sdkNameLabelKey] === appName;
}

// Records that another config must take part in the same deploy, because this
// application's resources are applied differently when it does. The dependent
// application's id goes in the key so several can be recorded at once — a label
// value cannot hold a delimited list (values are `^$|^[a-z][a-z0-9_-]{0,62}$`).
const dependedByAppLabelPrefix = "sdk-depended-by-app-";

// A workflow carries two independent values: its own publishExecutionEvents and
// the one its jobs get. Different trigger kinds drive them, so their records need
// separate namespaces on the one TRN — collapsing them lets a subscriber of one
// suppress the confirmation for the other.
const jobDependedByAppLabelPrefix = "sdk-job-depended-by-app-";

/** Which of a resource's values a dependency record concerns. */
export type DependencyScope = "resource" | "jobs";

function prefixFor(scope: DependencyScope): string {
  return scope === "jobs" ? jobDependedByAppLabelPrefix : dependedByAppLabelPrefix;
}

/** Why a dependent config has to take part in the same deploy. */
export type DeployDependencyReason = "publish-events";

// Label keys are `^[a-z][a-z0-9_-]{0,62}$`, so an id that is not a lowercase
// UUID cannot be recorded. `ensureConfigIdForDeploy` writes canonical UUIDs;
// this guards a hand-edited value rather than silently building an invalid key.
const RECORDABLE_APP_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Build the label key recording that an application depends on this deploy.
 * @param appId - Stable id of the dependent application
 * @param scope - Which of the resource's values the record concerns
 * @returns Label key, or undefined when the id cannot form a valid key
 */
export function dependedByAppLabelKey(
  appId: string,
  scope: DependencyScope = "resource",
): string | undefined {
  return RECORDABLE_APP_ID.test(appId) ? `${prefixFor(scope)}${appId}` : undefined;
}

/** An application recorded as depending on this deploy. */
export type RecordedDependency = {
  /** Stable id of the dependent application. */
  appId: string;
  /** Why it has to take part in the same deploy. */
  reason: string;
};

/**
 * Read the dependent applications recorded on a resource.
 *
 * Only keys {@link dependedByAppLabelKey} could have written are read back, so a
 * label the SDK could not have produced cannot raise a confirmation prompt that
 * naming no config in the run makes unanswerable.
 * @param labels - Labels currently stored on the remote resource
 * @param scope - Which of the resource's values to read records for
 * @returns Recorded dependencies, in label-key order
 */
export function recordedDependencies(
  labels: Record<string, string> | undefined,
  scope: DependencyScope = "resource",
): RecordedDependency[] {
  if (!labels) return [];
  const prefix = prefixFor(scope);
  return Object.entries(labels)
    .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .flatMap(([key, reason]) => {
      if (!key.startsWith(prefix)) return [];
      const appId = key.slice(prefix.length);
      return RECORDABLE_APP_ID.test(appId) ? [{ appId, reason }] : [];
    });
}

/**
 * Key one event-publishing resource for the dependency records.
 *
 * Planners rebuild the same string from the resource they are applying, so the
 * shape is the TRN's tail rather than anything new to keep in step.
 */
export const eventSourceKey = {
  tailorDBType: (namespace: string, typeName: string) => `tailordb:${namespace}:type:${typeName}`,
  resolver: (namespace: string, resolverName: string) =>
    `pipeline:${namespace}:resolver:${resolverName}`,
  idp: (name: string) => `idp:${name}`,
  workflow: (name: string) => `workflow:${name}`,
  // A workflowJobExecution trigger names a workflow, but drives the jobs' value
  // rather than the workflow's own, so it aggregates separately.
  workflowJobs: (name: string) => `workflow:${name}:jobs`,
} as const;

/**
 * Dependent application ids and reasons, keyed by the resource that carries them.
 * The key is the TRN's tail, e.g. `tailordb:db:type:Order` or `workflow:nightly`.
 */
export type DependentAppsByResource = ReadonlyMap<
  string,
  ReadonlyMap<string, DeployDependencyReason>
>;

/** Inputs deciding which dependency records a deploy writes and drops. */
export type DependencyLabelParams = {
  /** Labels currently stored on the resource. */
  existingLabels: Record<string, string> | undefined;
  /** Applications this run found depending on the resource being planned. */
  dependentApps: ReadonlyMap<string, DeployDependencyReason> | undefined;
  /** Stable ids of every application taking part in the run. */
  runAppIds: ReadonlySet<string> | undefined;
  /**
   * Whether the resource declares `publishEvents`. A declared value is not
   * recomputed, so no absent config can change it.
   */
  pinned: boolean;
  /** Which of the resource's values these records concern. */
  scope?: DependencyScope;
};

/**
 * Split the dependency records into the ones to write and the ones to drop.
 *
 * A record for an application outside the run appears in neither list, so
 * {@link writeMetadataLabels} keeps it: it was written when both took part, and
 * dropping it would lose the only signal that this partial deploy is about to
 * change how the resource is applied. A record for an application that does take
 * part is rewritten or dropped, so a dependency that no longer exists disappears
 * on the next deploy including both.
 *
 * A resource that declares `publishEvents` drops every record instead. Nothing
 * about it depends on which configs the run covers, so a record could only
 * produce a prompt about a change that cannot happen — and one the owner could
 * never clear on its own, since clearing needs the dependent to take part.
 * @param params - Existing labels and the run's dependency inputs
 * @returns Labels to set and label keys to delete
 */
export function dependencyLabelWrite(
  params: DependencyLabelParams,
): Required<Pick<MetadataLabelWrite, "labels" | "remove">> {
  const { existingLabels, dependentApps, runAppIds, pinned, scope = "resource" } = params;
  if (pinned) {
    return {
      labels: {},
      remove: recordedDependencies(existingLabels, scope).flatMap(
        ({ appId }) => dependedByAppLabelKey(appId, scope) ?? [],
      ),
    };
  }
  const dependents = dependentApps ?? new Map<string, DeployDependencyReason>();
  const inRun = runAppIds ?? new Set<string>();

  const labels: Record<string, string> = {};
  for (const [appId, reason] of dependents) {
    const key = dependedByAppLabelKey(appId, scope);
    if (!key) {
      throw new Error(
        `Application id "${appId}" cannot be recorded as a dependency of this deploy. ` +
          `Ids are written by deploy as lowercase UUIDs; restore the generated value in the ` +
          `config's "id".`,
      );
    }
    labels[key] = reason;
  }

  const remove = recordedDependencies(existingLabels, scope).flatMap(({ appId }) => {
    if (!inRun.has(appId) || dependents.has(appId)) return [];
    const key = dependedByAppLabelKey(appId, scope);
    return key ? [key] : [];
  });

  return { labels, remove };
}

export interface BuildMetaRequestParams {
  trn: string;
  appName: string;
  appId?: string;
}

/**
 * Build metadata request with SDK labels.
 *
 * Sets only the SDK's own labels; {@link writeMetadataLabels} keeps the rest
 * from the labels it reads at write time.
 *
 * Without an app id the id label is removed rather than merely left unset,
 * because {@link isOwnedByApp} decides ownership by that label alone: one left
 * over from an earlier deploy would keep reading as another app's, and every
 * later deploy would ask to re-tag the same resources again.
 * @param params - Parameters for building the metadata request
 * @param params.trn - Target TRN
 * @param params.appName - Application name label
 * @param params.appId - Stable application id label (when managed by SDK)
 * @returns Metadata request
 */
export async function buildMetaRequest(
  params: BuildMetaRequestParams,
): Promise<MetadataLabelWrite> {
  const { trn, appName, appId } = params;
  const packageJson = await readPackageJson();
  // Format version to be suitable for label value
  const sdkVersion = packageJson.version
    ? `v${packageJson.version.replace(/\./g, "-")}`
    : "unknown";

  return {
    trn,
    labels: {
      [sdkNameLabelKey]: appName,
      [sdkVersionLabelKey]: sdkVersion,
      ...(appId ? { [sdkAppIdLabelKey]: sdkAppIdLabelValue(appId) } : {}),
    },
    remove: appId ? undefined : [sdkAppIdLabelKey],
  };
}

/** What a planner knows about the resource it is recording dependencies for. */
export type ResourceDependencyParams = {
  /** Key identifying the resource, e.g. `workflow:nightly`. */
  key: string;
  /** Dependents the run resolved, keyed by resource. */
  dependentApps: DependentAppsByResource | undefined;
  /** Stable ids of every application taking part in the run. */
  runAppIds: ReadonlySet<string> | undefined;
  /** Whether the resource declares `publishEvents`. */
  pinned: boolean;
  /** Which of the resource's values these records concern. */
  scope?: DependencyScope;
};

/**
 * Fold a resource's dependency records into the write already planned for it.
 *
 * The reconciliation is attached rather than computed, so it runs against the
 * labels read at write time. Whatever {@link buildMetaRequest} asked for —
 * dropping a stale `sdk-app-id`, for instance — still happens alongside it.
 * @param write - The resource's planned metadata write, mutated in place
 * @param params - The resource's key and the run's inputs
 * @returns The same write, for use as an expression
 */
export function addDependencyRecords(
  write: MetadataLabelWrite,
  params: ResourceDependencyParams,
): MetadataLabelWrite {
  const { key, dependentApps, runAppIds, pinned, scope } = params;
  write.dependencies = [
    ...(write.dependencies ?? []),
    { dependentApps: dependentApps?.get(key), runAppIds, pinned, scope },
  ];
  return write;
}

/**
 * The client surface {@link writeMetadataLabels} needs. Narrower than the full
 * operator client so tests can pass a stub and the module stays decoupled.
 */
export interface MetadataLabelClient {
  getMetadata(request: { trn: string }): Promise<{ metadata?: { labels: Record<string, string> } }>;
  setMetadata(request: MessageInitShape<typeof SetMetadataRequestSchema>): Promise<unknown>;
}

export interface MetadataLabelBulkClient extends MetadataLabelClient {
  bulkSetMetadata(request: MessageInitShape<typeof BulkSetMetadataRequestSchema>): Promise<unknown>;
}

/** A metadata label write, expressed as a change rather than a whole map. */
export interface MetadataLabelWrite {
  /** Target TRN. */
  trn: string;
  /** Labels to set. Keys absent here keep whatever the resource already has. */
  labels?: Record<string, string>;
  /** Label keys to delete. Absent keys are ignored. */
  remove?: ReadonlyArray<string>;
  /**
   * Dependency records to reconcile against the labels found at write time.
   *
   * Which records to drop depends on what is already there, and
   * {@link writeMetadataLabels} reads that anyway — resolving it here rather than
   * while planning saves every planner a second read of the same resource.
   */
  dependencies?: ReadonlyArray<PendingDependencyRecords>;
}

/** A dependency-record reconciliation waiting on the resource's current labels. */
type PendingDependencyRecords = Omit<DependencyLabelParams, "existingLabels">;

const metadataWriteBatch = Symbol("metadataWriteBatch");
const metadataWriteBatchSize = 100;
const metadataReadWaveSize = 100;

interface MetadataWriteBatchClient extends MetadataLabelClient {
  [metadataWriteBatch]?: MetadataWriteBatch;
}

class MetadataWriteBatch {
  readonly #client: MetadataLabelBulkClient;
  readonly #writesByTrn = new Map<string, MetadataLabelWrite[]>();
  #flushPromise: Promise<void> | undefined;

  constructor(client: MetadataLabelBulkClient) {
    this.#client = client;
  }

  async enqueue(write: MetadataLabelWrite): Promise<void> {
    if (this.#flushPromise) {
      // The wrapper reports a flush failure; a late apply sibling must still attempt its write.
      await this.#flushPromise.catch(() => undefined);
      await writeMetadataLabelsDirect(this.#client, write);
      return;
    }
    const writes = this.#writesByTrn.get(write.trn) ?? [];
    writes.push(write);
    this.#writesByTrn.set(write.trn, writes);
  }

  flush(): Promise<void> {
    this.#flushPromise ??= this.#flushQueued();
    return this.#flushPromise;
  }

  async #flushQueued(): Promise<void> {
    const queued = [...this.#writesByTrn].toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const readRequest = async ([trn, writes]: (typeof queued)[number]) => {
      const current = await getOrNull(() => this.#client.getMetadata({ trn }));
      const currentLabels = current?.metadata?.labels ?? {};
      const labels = writes.reduce(applyMetadataLabelWrite, currentLabels);
      return areSameLabels(currentLabels, labels) ? undefined : { trn, labels };
    };
    const candidates: (typeof queued)[number][] = [];
    let cursor = 0;

    while (cursor < queued.length || candidates.length > 0) {
      let freshRequests: MessageInitShape<typeof SetMetadataRequestSchema>[] | undefined =
        candidates.length === 0 ? [] : undefined;
      while (cursor < queued.length && candidates.length < metadataWriteBatchSize) {
        // Fixed-width waves keep a nearly full batch from serializing a long no-op tail.
        if (candidates.length > 0) freshRequests = undefined;
        const entries = queued.slice(cursor, cursor + metadataReadWaveSize);
        cursor += entries.length;
        const changed = await Promise.all(
          entries.map(async (entry) => {
            const request = await readRequest(entry);
            return request ? { entry, request } : undefined;
          }),
        );
        for (const candidate of changed) {
          if (!candidate) continue;
          candidates.push(candidate.entry);
          freshRequests?.push(candidate.request);
        }
      }

      const batchEntries = candidates.splice(0, metadataWriteBatchSize);
      // Candidates spanning waves or carried past a bulk need one shared freshness barrier.
      const latestRequests =
        freshRequests ??
        (await Promise.all(batchEntries.map((entry) => readRequest(entry)))).filter(
          (request) => request !== undefined,
        );
      if (latestRequests.length > 0) {
        await this.#client.bulkSetMetadata({ requests: latestRequests });
      }
    }
  }
}

function hasMetadataLabelChange(write: MetadataLabelWrite): boolean {
  return Boolean(
    Object.keys(write.labels ?? {}).length || write.remove?.length || write.dependencies?.length,
  );
}

function applyMetadataLabelWrite(
  currentLabels: Record<string, string>,
  write: MetadataLabelWrite,
): Record<string, string> {
  const { labels, remove, dependencies } = write;
  const resolved = (dependencies ?? []).map((pending) =>
    dependencyLabelWrite({ ...pending, existingLabels: currentLabels }),
  );
  const merged: Record<string, string> = {
    ...currentLabels,
    ...labels,
    ...Object.assign({}, ...resolved.map((records) => records.labels)),
  };
  for (const key of [...(remove ?? []), ...resolved.flatMap((records) => records.remove)]) {
    delete merged[key];
  }
  return merged;
}

function metadataRecoveryError(applyError: unknown, flushError: unknown): AggregateError {
  return new AggregateError(
    [applyError, flushError],
    `Resource apply failed: ${toError(applyError).message}\nQueued metadata recovery failed: ${toError(flushError).message}`,
    { cause: flushError },
  );
}

/**
 * Collect metadata label changes and write the final maps in batches.
 * @template TClient, T
 * @param client - Operator client instance
 * @param apply - Resource apply callback using the batch-aware client
 * @returns The apply callback result
 */
export async function withMetadataWriteBatch<TClient extends MetadataLabelBulkClient, T>(
  client: TClient,
  apply: (client: TClient) => Promise<T>,
): Promise<T> {
  const batch = new MetadataWriteBatch(client);
  const batchClient = new Proxy(client, {
    get(target, property, receiver) {
      return property === metadataWriteBatch ? batch : Reflect.get(target, property, receiver);
    },
  });
  let result: T;
  try {
    result = await apply(batchClient);
  } catch (applyError) {
    // Another deploy owns the resources now; its labels must not be overwritten.
    if (applyError instanceof DeployLockLostError) throw applyError;
    try {
      await batch.flush();
    } catch (flushError) {
      throw metadataRecoveryError(applyError, flushError);
    }
    throw applyError;
  }
  await batch.flush();
  return result;
}

/**
 * Write metadata labels as a change against the resource's current labels.
 *
 * `SetMetadata` replaces the whole label map, so a request built from labels
 * read earlier deletes anything written in between. This applies `labels` and
 * `remove` to the latest labels this helper reads before writing, which is why
 * every label write in the SDK goes through it.
 *
 * Concurrent writers are still not safe in the strict sense — that needs
 * server-side conditional writes — but a write can no longer be built from
 * state this process read at an unrelated point in time.
 *
 * A write that changes nothing does nothing — whether the caller requested no
 * change or the change turns out to already hold. Writing back what was just
 * read would still overwrite whatever landed in between, for no gain, and the
 * labels the SDK sets are unchanged on most deploys.
 * @param client - Operator client instance
 * @param write - TRN, labels to set, and label keys to delete
 * @returns Promise that resolves when the change is queued for a batch or written directly
 */
export async function writeMetadataLabels(
  client: MetadataLabelClient,
  write: MetadataLabelWrite,
): Promise<void> {
  if (!hasMetadataLabelChange(write)) return;
  const batch = (client as MetadataWriteBatchClient)[metadataWriteBatch];
  if (batch) {
    await batch.enqueue(write);
    return;
  }
  await writeMetadataLabelsDirect(client, write);
}

/**
 * Write one metadata change immediately, bypassing deploy resource batching.
 * This is reserved for migration checkpoints whose callers continue only
 * after the label is durable.
 * @param client - Operator client instance
 * @param write - TRN, labels to set, and label keys to delete
 */
export async function writeMetadataLabelsDirect(
  client: MetadataLabelClient,
  write: MetadataLabelWrite,
): Promise<void> {
  if (!hasMetadataLabelChange(write)) return;
  const { trn } = write;
  const current = await getOrNull(() => client.getMetadata({ trn }));
  const currentLabels = current?.metadata?.labels ?? {};
  const merged = applyMetadataLabelWrite(currentLabels, write);
  if (areSameLabels(currentLabels, merged)) return;
  await client.setMetadata({ trn, labels: merged });
}

function areSameLabels(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}
