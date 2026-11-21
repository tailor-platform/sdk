import { ViolationsSchema } from "@bufbuild/protovalidate/gen/buf/validate/validate_pb.js";
import { Code, ConnectError } from "@connectrpc/connect";
import { getOrNull } from "#/cli/shared/client";
import { withErrorDiagnostics } from "#/cli/shared/error-diagnostics";
import { CLIError, internalError, isCLIError, toError } from "#/cli/shared/errors";
import { plainRedacted } from "#/cli/shared/logger";
import { readPackageJson } from "#/cli/shared/package-json";
import type { ManagedResourceType } from "./managed-resource-type";
import type { MessageInitShape } from "@bufbuild/protobuf";
import type {
  BulkSetMetadataRequestSchema,
  SetMetadataRequestSchema,
} from "@tailor-platform/tailor-proto/metadata_pb";

export type WithLabel<T> = Partial<
  Record<string, { resource: T; allLabels?: Record<string, string> }>
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
export const sdkManagedLabelKey = "sdk-managed";
export const sdkManagedLabelValue = "workspace";
const onAppLabelPrefix = "sdk-on-app-";

/**
 * Who a deploy manages resources for: one application of a `defineConfig()` config, identified by
 * its name and id, or the whole workspace of a `defineWorkspace()` or `defineApp()` config.
 */
export type DeployOwner =
  | { kind: "application"; name: string; id: string | undefined }
  | { kind: "workspace" };

// The metadata label value regex requires a leading lowercase letter, while
// the auto-generated app id is a plain UUID (which may start with a digit).
// The `app-` prefix is added at the metadata boundary so the user-facing id
// in `tailor.config.ts` can stay a plain UUID.
const appIdLabelPrefix = "app-";

export function sdkAppIdLabelValue(appId: string): string {
  return `${appIdLabelPrefix}${appId}`;
}

/**
 * Application id an `sdk-app-id` label value records.
 * @param value - Label value written by {@link sdkAppIdLabelValue}
 * @returns The id without the label prefix
 */
export function appIdOfLabelValue(value: string): string {
  return value.startsWith(appIdLabelPrefix) ? value.slice(appIdLabelPrefix.length) : value;
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
 * Marks an unchanged resource whose SDK labels differ from the ones deploy writes. The
 * application, IdP service, and workflow applies write every unchanged item's labels anyway, so
 * for them it is only counted.
 */
export type UnchangedAnnotation = { labelRefresh?: MetadataLabelWrite };

/**
 * Plan a label refresh for an unchanged resource whose labels differ from the ones a write sets
 * and removes. Dependency records are left out: they are reconciled against the labels read at
 * write time.
 * @param existingLabels - Labels currently stored on the remote resource
 * @param write - Labels the current apply run would set and remove
 * @returns The write as `labelRefresh` when it would change a label, otherwise no annotation
 */
export function labelRefreshOf(
  existingLabels: Record<string, string> | undefined,
  write: MetadataLabelWrite,
): UnchangedAnnotation {
  const { dependencies: _dependencies, ...compared } = write;
  const current = existingLabels ?? {};
  return areSameLabels(current, applyMetadataLabelWrite(current, compared))
    ? {}
    : { labelRefresh: write };
}

/**
 * Describe a `defineConfig()` application as the owner of the resources it deploys.
 * @param application - Application name and id
 * @param application.name - Application name
 * @param application.id - Stable application id, when the config resolves one
 * @returns The application owner
 */
export function applicationOwner(application: {
  name: string;
  id: string | undefined;
}): DeployOwner {
  return { kind: "application", name: application.name, id: application.id };
}

/**
 * Get the stable id of an application config's owner.
 * @param owner - Owner of the resources a deploy manages
 * @returns The application id, or undefined for a workspace config or a config with no id
 */
export function applicationIdOf(owner: DeployOwner): string | undefined {
  return owner.kind === "application" ? owner.id : undefined;
}

/**
 * Determine whether a remote resource is managed by the deploy's owner.
 * @param labels - Labels currently stored on the remote resource
 * @param owner - Owner of the resources the deploy manages
 * @returns True when the resource belongs to the owner
 */
export function isOwnedBy(labels: Record<string, string> | undefined, owner: DeployOwner): boolean {
  if (owner.kind === "workspace") {
    return isWorkspaceManaged(labels);
  }
  return isOwnedByApp(labels, owner.name, owner.id);
}

/**
 * Determine whether the deploy manages a resource, or, for the workspace, takes it over from the
 * application config that deployed it.
 * @param labels - Labels currently stored on the remote resource
 * @param owner - Owner of the resources the deploy manages
 * @returns True when the deploy plans the resource's contents
 */
export function ownsOrTakesOver(
  labels: Record<string, string> | undefined,
  owner: DeployOwner,
): boolean {
  return isOwnedBy(labels, owner) || (owner.kind === "workspace" && deployedByApplication(labels));
}

/**
 * Determine whether an application config deployed a resource the workspace does not manage yet.
 * @param labels - Labels currently stored on the remote resource
 * @returns True when the resource carries an application's labels and no workspace mark
 */
export function deployedByApplication(labels: Record<string, string> | undefined): boolean {
  return Boolean(
    labels && !isWorkspaceManaged(labels) && (labels[sdkNameLabelKey] || labels[sdkAppIdLabelKey]),
  );
}

/**
 * Determine whether a resource carries the mark of a workspace config.
 * @param labels - Labels currently stored on the remote resource
 * @returns True when a workspace config manages the resource
 */
export function isWorkspaceManaged(labels: Record<string, string> | undefined): boolean {
  return labels?.[sdkManagedLabelKey] === sdkManagedLabelValue;
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
      throw CLIError({
        code: "APP_ID_INVALID",
        message: `Application id "${appId}" cannot be recorded as a dependency of this deploy.`,
        suggestion:
          'Ids are written by deploy as lowercase UUIDs; restore the generated value in the config\'s "id".',
      });
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
  owner: DeployOwner;
  /** For a workspace owner, the applications that list the resource, each labelled `sdk-on-app-<name>`. */
  onApps?: readonly string[];
}

/**
 * Build metadata request with SDK labels.
 *
 * Sets only the SDK's own labels; {@link writeMetadataLabels} keeps the rest
 * from the labels it reads at write time. Each owner removes the other
 * owner's labels, so the deploy leaves only its own owner's mark.
 *
 * Without an app id the id label is removed rather than merely left unset,
 * because {@link isOwnedByApp} decides ownership by that label alone: one left
 * over from an earlier deploy would keep reading as another app's, and every
 * later deploy would ask to re-tag the same resources again.
 * @param params - Parameters for building the metadata request
 * @param params.trn - Target TRN
 * @param params.owner - Owner of the resources the deploy manages
 * @param params.onApps - For a workspace owner, the applications that list the resource
 * @returns Metadata request
 */
export async function buildMetaRequest(
  params: BuildMetaRequestParams,
): Promise<MetadataLabelWrite> {
  const { trn, owner, onApps = [] } = params;
  const packageJson = await readPackageJson();
  // Format version to be suitable for label value
  const sdkVersion = packageJson.version
    ? `v${packageJson.version.replace(/\./g, "-")}`
    : "unknown";

  if (owner.kind === "workspace") {
    return {
      trn,
      labels: {
        [sdkManagedLabelKey]: sdkManagedLabelValue,
        [sdkVersionLabelKey]: sdkVersion,
        ...Object.fromEntries(onApps.map((app) => [`${onAppLabelPrefix}${app}`, ""])),
      },
      remove: [sdkNameLabelKey, sdkAppIdLabelKey],
      removePrefixes: [dependedByAppLabelPrefix, jobDependedByAppLabelPrefix, onAppLabelPrefix],
    };
  }
  const { name, id } = owner;
  return {
    trn,
    labels: {
      [sdkNameLabelKey]: name,
      [sdkVersionLabelKey]: sdkVersion,
      ...(id ? { [sdkAppIdLabelKey]: sdkAppIdLabelValue(id) } : {}),
    },
    remove: id ? [sdkManagedLabelKey] : [sdkAppIdLabelKey, sdkManagedLabelKey],
    removePrefixes: [onAppLabelPrefix],
  };
}

/**
 * Add labels to a write of the SDK's own labels, which win over a same-named one.
 * @param write - Write of the SDK's own labels
 * @param labels - Labels to add, such as the config's `metadata`
 * @returns The write with the labels added
 */
export function withExtraLabels(
  write: MetadataLabelWrite,
  labels: Record<string, string>,
): MetadataLabelWrite {
  return { ...write, labels: { ...labels, ...write.labels } };
}

/**
 * Read the violation the platform reports when a metadata write holds more
 * labels than it allows on one resource.
 * @param error - Error thrown by a metadata write
 * @returns The violation message, or undefined for any other error
 */
export function labelCountViolation(error: unknown): string | undefined {
  if (!(error instanceof ConnectError) || error.code !== Code.InvalidArgument) return undefined;
  return error
    .findDetails(ViolationsSchema)
    .flatMap(({ violations }) => violations)
    .find(({ ruleId }) => ruleId === "map.max_pairs")?.message;
}

function labelCountViolationIndices(error: unknown): number[] | undefined {
  if (!(error instanceof ConnectError) || error.code !== Code.InvalidArgument) return undefined;
  const indices = error
    .findDetails(ViolationsSchema)
    .flatMap(({ violations }) => violations)
    .filter(({ ruleId }) => ruleId === "map.max_pairs")
    .map(({ field }) => field?.elements[0]?.subscript)
    .map((subscript) => (subscript?.case === "index" ? Number(subscript.value) : undefined));
  if (indices.length === 0 || indices.some((index) => index === undefined)) return undefined;
  return [...new Set(indices as number[])];
}

/** `sdk-on-app-*` labels a resource could not hold because the Platform allows no more labels on it. */
export interface DroppedOnAppLabels {
  trn: string;
  /** Applications whose `sdk-on-app-<name>` label was left off. */
  applications: string[];
}

/** Receives the `sdk-on-app-*` labels a write left off. */
export type DroppedOnAppLabelsSink = (dropped: DroppedOnAppLabels) => void;

const onAppLabelledResourceTypes = {
  tailordb: "tailordb.service",
  pipeline: "pipeline.service",
  auth: "auth.service",
  idp: "idp.service",
  function_registry: "function_registry",
  application: "application",
} as const satisfies Partial<Record<ResourceKind, ManagedResourceType>>;

/**
 * The resource of a TRN that `sdk-on-app-*` labels go on.
 * @param trn - TRN of a namespace, resolver function, or application
 * @returns Its resource type and name
 */
export function onAppLabelledResourceOf(trn: string): {
  resourceType: ManagedResourceType;
  name: string;
} {
  const [, , , , kind, name, ...nested] = trn.split(":");
  const resourceType =
    kind !== undefined && Object.hasOwn(onAppLabelledResourceTypes, kind)
      ? onAppLabelledResourceTypes[kind as keyof typeof onAppLabelledResourceTypes]
      : undefined;
  if (resourceType === undefined || name === undefined || nested.length > 0) {
    throw internalError(`${trn} carries no sdk-on-app labels`);
  }
  return { resourceType, name };
}

/**
 * Write a resource's labels after the Platform rejected them for their count: every label but the
 * `sdk-on-app-*` ones, and as many of those as the Platform accepts, in name order.
 * @param client - Operator client instance
 * @param trn - Target TRN
 * @param labels - Labels the Platform rejected
 * @returns Applications whose `sdk-on-app-*` label was left off
 */
async function setLabelsDroppingOnAppLabels(
  client: MetadataLabelClient,
  trn: string,
  labels: Readonly<Record<string, string>>,
): Promise<string[]> {
  const onAppEntries = Object.entries(labels)
    .filter(([key]) => key.startsWith(onAppLabelPrefix))
    .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const onAppKeys = onAppEntries.map(([key]) => key);
  const others = Object.fromEntries(
    Object.entries(labels).filter(([key]) => !key.startsWith(onAppLabelPrefix)),
  );
  let fitting = -1;
  let low = 0;
  let high = onAppEntries.length - 1;
  while (low <= high) {
    const count = Math.ceil((low + high) / 2);
    const kept = Object.fromEntries(onAppEntries.slice(0, count));
    try {
      await client.setMetadata({ trn, labels: { ...others, ...kept } });
      fitting = count;
      low = count + 1;
    } catch (error) {
      if (labelCountViolation(error) === undefined) throw error;
      high = count - 1;
    }
  }
  if (fitting < 0) {
    throw CLIError({
      code: "METADATA_LABEL_LIMIT_EXCEEDED",
      message: `${trn} holds more labels than the Platform allows, even without the labels that name the applications listing it.`,
      suggestion: "Remove labels that tailor does not set from the resource, then deploy again.",
      context: { trn },
    });
  }
  return onAppKeys.slice(fitting).map((key) => key.slice(onAppLabelPrefix.length));
}

/** What a planner knows about the resource it is recording dependencies for. */
export type ResourceDependencyParams = {
  /** Owner of the resources the deploy manages. */
  owner: DeployOwner;
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
 * A workspace config is the only config of its workspace, so it records none.
 * @param write - The resource's planned metadata write, mutated in place
 * @param params - The resource's key and the run's inputs
 * @returns The same write, for use as an expression
 */
export function addDependencyRecords(
  write: MetadataLabelWrite,
  params: ResourceDependencyParams,
): MetadataLabelWrite {
  const { owner, key, dependentApps, runAppIds, pinned, scope } = params;
  if (owner.kind === "workspace") return write;
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
  /** Prefixes of label keys to delete, except keys this same write sets. */
  removePrefixes?: ReadonlyArray<string>;
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

type LabelRequest = { trn: string; labels: Record<string, string> };

class MetadataWriteBatch {
  readonly #client: MetadataLabelBulkClient;
  readonly #onDropped: DroppedOnAppLabelsSink | undefined;
  readonly #writesByTrn = new Map<string, MetadataLabelWrite[]>();
  #flushPromise: Promise<void> | undefined;

  constructor(client: MetadataLabelBulkClient, onDropped?: DroppedOnAppLabelsSink) {
    this.#client = client;
    this.#onDropped = onDropped;
  }

  async enqueue(write: MetadataLabelWrite): Promise<void> {
    if (this.#flushPromise) {
      // The wrapper reports a flush failure; a late apply sibling must still attempt its write.
      await this.#flushPromise.catch(() => undefined);
      await writeMetadataLabelsDroppingOnAppLabels(this.#client, write, this.#onDropped);
      return;
    }
    const writes = this.#writesByTrn.get(write.trn) ?? [];
    writes.push(write);
    this.#writesByTrn.set(write.trn, writes);
  }

  /**
   * Queue a write that runs before the writes already queued for its resource, so they win.
   * @param write - Write to run first; ignored once the flush has started
   */
  enqueueFirst(write: MetadataLabelWrite): void {
    if (this.#flushPromise) return;
    this.#writesByTrn.set(write.trn, [write, ...(this.#writesByTrn.get(write.trn) ?? [])]);
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
      let freshRequests: LabelRequest[] | undefined = candidates.length === 0 ? [] : undefined;
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
        await this.#bulkSet(latestRequests);
      }
    }
  }

  async #bulkSet(requests: LabelRequest[]): Promise<void> {
    try {
      await this.#client.bulkSetMetadata({ requests });
      return;
    } catch (error) {
      const rejected = labelCountViolationIndices(error);
      if (!rejected?.every((index) => hasOnAppLabels(requests[index]?.labels ?? {}))) throw error;
      const rest = requests.filter((_, index) => !rejected.includes(index));
      if (rest.length > 0) await this.#client.bulkSetMetadata({ requests: rest });
      for (const index of rejected) {
        const { trn, labels } = requests[index] ?? throwMissingRequest(index);
        const applications = await setLabelsDroppingOnAppLabels(this.#client, trn, labels);
        this.#onDropped?.({ trn, applications });
      }
    }
  }
}

function throwMissingRequest(index: number): never {
  throw internalError(`BulkSetMetadata rejected request ${index}, which it was not sent`);
}

function hasMetadataLabelChange(write: MetadataLabelWrite): boolean {
  return Boolean(
    Object.keys(write.labels ?? {}).length ||
    write.remove?.length ||
    write.removePrefixes?.length ||
    write.dependencies?.length,
  );
}

function applyMetadataLabelWrite(
  currentLabels: Record<string, string>,
  write: MetadataLabelWrite,
): Record<string, string> {
  const { labels, remove, removePrefixes, dependencies } = write;
  const resolved = (dependencies ?? []).map((pending) =>
    dependencyLabelWrite({ ...pending, existingLabels: currentLabels }),
  );
  const set: Record<string, string> = {
    ...labels,
    ...Object.assign({}, ...resolved.map((records) => records.labels)),
  };
  const merged: Record<string, string> = { ...currentLabels, ...set };
  for (const key of Object.keys(merged)) {
    if (!(key in set) && removePrefixes?.some((prefix) => key.startsWith(prefix))) {
      delete merged[key];
    }
  }
  for (const key of [...(remove ?? []), ...resolved.flatMap((records) => records.remove)]) {
    delete merged[key];
  }
  return merged;
}

function metadataRecoveryError(applyError: unknown, flushError: unknown): AggregateError {
  const describeCause = (error: unknown) =>
    isCLIError(error) ? plainRedacted(error.format()) : toError(error).message;
  return withErrorDiagnostics(
    new AggregateError(
      [applyError, flushError],
      `Resource apply failed: ${describeCause(applyError)}\nQueued metadata recovery failed: ${describeCause(flushError)}`,
      { cause: flushError },
    ),
    {
      code: "DEPLOY_METADATA_RECOVERY_FAILED",
      suggestion:
        "Some resources may already have changed and deployment metadata could not be saved. Inspect the current resources and resolve both failures before deploying again.",
      causes: { apply: applyError, recovery: flushError },
    },
  );
}

/**
 * Collect metadata label changes and write the final maps in batches.
 * @template TClient, T
 * @param client - Operator client instance
 * @param apply - Resource apply callback using the batch-aware client
 * @param onDropped - Receives the `sdk-on-app-*` labels a resource could not hold
 * @returns The apply callback result
 */
export async function withMetadataWriteBatch<TClient extends MetadataLabelBulkClient, T>(
  client: TClient,
  apply: (client: TClient) => Promise<T>,
  onDropped?: DroppedOnAppLabelsSink,
): Promise<T> {
  const batch = new MetadataWriteBatch(client, onDropped);
  const batchClient = new Proxy(client, {
    get(target, property, receiver) {
      return property === metadataWriteBatch ? batch : Reflect.get(target, property, receiver);
    },
  });
  let result: T;
  try {
    result = await apply(batchClient);
  } catch (applyError) {
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
 * Rewrite the labels of the unchanged resources whose SDK labels differ.
 * @param client - Operator client instance
 * @param unchanged - Unchanged items of a change set
 * @returns One pending write per item with a label refresh
 */
export function writeLabelRefreshes(
  client: MetadataLabelClient,
  unchanged: ReadonlyArray<UnchangedAnnotation>,
): Promise<void>[] {
  return unchanged.flatMap(({ labelRefresh }) =>
    labelRefresh ? [writeMetadataLabels(client, labelRefresh)] : [],
  );
}

/**
 * Write one metadata change immediately, bypassing deploy resource batching.
 * This is reserved for callers that continue only after the label is durable,
 * such as migration checkpoints, or that handle the write's own rejection,
 * which a batch would share with every other write in it.
 * @param client - Operator client instance
 * @param write - TRN, labels to set, and label keys to delete
 * @returns Whether the labels changed
 */
export function writeMetadataLabelsDirect(
  client: MetadataLabelClient,
  write: MetadataLabelWrite,
): Promise<boolean> {
  return writeMergedLabels(client, write);
}

/**
 * Write one metadata change immediately like {@link writeMetadataLabelsDirect}, except that when
 * the Platform rejects the labels for their count and they include `sdk-on-app-*` labels, it
 * writes every other label and as many of those as fit. Under a deploy's write batch, the ones
 * left off are queued to be put back when the batch flushes, which reports those that still do
 * not fit; otherwise `onDropped` receives them.
 * @param client - Operator client instance
 * @param write - TRN, labels to set, and label keys to delete
 * @param onDropped - Receives the `sdk-on-app-*` labels the resource could not hold, outside a batch
 * @returns Whether the labels changed
 */
export function writeMetadataLabelsDroppingOnAppLabels(
  client: MetadataLabelClient,
  write: MetadataLabelWrite,
  onDropped?: DroppedOnAppLabelsSink,
): Promise<boolean> {
  return writeMergedLabels(client, write, async (trn, labels) => {
    const applications = await setLabelsDroppingOnAppLabels(client, trn, labels);
    const batch = (client as MetadataWriteBatchClient)[metadataWriteBatch];
    if (batch) {
      // Queued first, so the deploy's own write for the resource still drops a stale one.
      batch.enqueueFirst({
        trn,
        labels: Object.fromEntries(applications.map((app) => [`${onAppLabelPrefix}${app}`, ""])),
      });
    } else {
      onDropped?.({ trn, applications });
    }
  });
}

async function writeMergedLabels(
  client: MetadataLabelClient,
  write: MetadataLabelWrite,
  onLabelCountViolation?: (trn: string, labels: Record<string, string>) => Promise<void>,
): Promise<boolean> {
  if (!hasMetadataLabelChange(write)) return false;
  const { trn } = write;
  const current = await getOrNull(() => client.getMetadata({ trn }));
  const currentLabels = current?.metadata?.labels ?? {};
  const merged = applyMetadataLabelWrite(currentLabels, write);
  if (areSameLabels(currentLabels, merged)) return false;
  try {
    await client.setMetadata({ trn, labels: merged });
  } catch (error) {
    if (
      !onLabelCountViolation ||
      labelCountViolation(error) === undefined ||
      !hasOnAppLabels(merged)
    ) {
      throw error;
    }
    await onLabelCountViolation(trn, merged);
  }
  return true;
}

function hasOnAppLabels(labels: Readonly<Record<string, string>>): boolean {
  return Object.keys(labels).some((key) => key.startsWith(onAppLabelPrefix));
}

function areSameLabels(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}
