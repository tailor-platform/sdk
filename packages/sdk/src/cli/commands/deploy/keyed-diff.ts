import { hasMatchingSdkVersion, labelsMatch, type MetadataLabelWrite } from "./label";
import type { UnchangedAnnotation, UpdateAnnotation } from "./change-set";
import type { OwnershipTracker, TrackedResource } from "./owned-resource";

/** Ownership checks for a planner whose resources carry SDK labels. */
export interface KeyedDiffOwnership<Desired, Existing> {
  /** Whether a same-named existing resource is managed by this app; records takeovers. */
  ownsDesired(desired: Desired, existing: Existing): boolean;
  /** Whether a remote-only resource is managed by this app, so deploy may delete it. */
  ownsRemaining(existing: Existing): boolean;
}

/** Ownership, SDK-version, and SDK-label checks of resources whose SDK labels deploy reads. */
export interface LabeledResourceChecks<Desired, Existing> {
  ownership: KeyedDiffOwnership<Desired, Existing>;
  versionMatches(desired: Desired, existing: Existing): boolean;
  labelRefresh(desired: Desired, existing: Existing): MetadataLabelWrite | undefined;
}

/**
 * Check ownership, SDK version, and SDK labels through the labels listed with each existing resource.
 * @param tracker - Ownership tracker of the planner
 * @param describe - Resource kind and name shown when a desired resource is taken over
 * @returns Checks to spread into a keyed diff
 */
export function labeledResourceChecks<
  Desired extends { metaRequest: MetadataLabelWrite },
  Existing extends { allLabels?: Record<string, string> },
>(
  tracker: OwnershipTracker,
  describe: (desired: Desired) => TrackedResource,
): LabeledResourceChecks<Desired, Existing> {
  return {
    ownership: {
      ownsDesired: (desired, existing) =>
        tracker.ownsDesired(existing.allLabels, describe(desired)),
      ownsRemaining: (existing) => tracker.ownsRemaining(existing.allLabels),
    },
    versionMatches: (desired, existing) =>
      hasMatchingSdkVersion(existing.allLabels, desired.metaRequest.labels),
    labelRefresh: (desired, existing) =>
      labelsMatch(existing.allLabels, desired.metaRequest) ? undefined : desired.metaRequest,
  };
}

/** The change-set lists a keyed diff appends to. */
interface KeyedDiffChangeSet<Create, Update, Unchanged, Delete, Replace = never> {
  readonly creates: Create[];
  readonly updates: Array<Update & UpdateAnnotation>;
  readonly unchanged: Array<Unchanged & UnchangedAnnotation>;
  readonly deletes: Delete[];
  readonly replaces: Replace[];
}

/** Desired and existing resources of one kind, and how to turn each match into a change-set item. */
export interface KeyedDiff<Desired, Existing, Create, Update, Unchanged, Delete, Replace = never> {
  changeSet: KeyedDiffChangeSet<Create, Update, Unchanged, Delete, Replace>;
  desired: Iterable<Desired>;
  /** Existing resources keyed by the same key as `keyOf`; undefined entries are skipped. */
  existing: Iterable<readonly [string, Existing | undefined]>;
  keyOf(desired: Desired): string;
  /** Omitted for resources without SDK labels: every match and leftover is then owned. */
  ownership?: KeyedDiffOwnership<Desired, NoInfer<Existing>>;
  /** Whether the existing resource was applied by this SDK version (or nothing forces a reapply). */
  versionMatches(desired: Desired, existing: NoInfer<Existing>): boolean;
  /** The labels to rewrite on an unchanged resource; omitted for resources without SDK labels. */
  labelRefresh?(desired: Desired, existing: NoInfer<Existing>): MetadataLabelWrite | undefined;
  isConfigUnchanged(desired: Desired, existing: Existing): boolean | Promise<boolean>;
  /** Returns a replace item when the match cannot be updated in place. */
  replace?(desired: Desired, existing: Existing): Replace | undefined;
  create(desired: Desired): Create;
  update(desired: Desired, existing: Existing): Update;
  unchanged(desired: Desired, existing: Existing): Unchanged;
  /** Returns undefined to leave a leftover in place. */
  delete(key: string, existing: Existing): Delete | undefined;
}

/**
 * Classify desired resources against existing ones by key and append the
 * resulting creates, updates, unchanged items, replaces, and deletes.
 * @param diff - Desired and existing resources and the item builders
 * @returns Promise that resolves when every item is appended
 */
export async function diffKeyed<
  Desired,
  Existing,
  Create,
  Update,
  Unchanged,
  Delete,
  Replace = never,
>(diff: KeyedDiff<Desired, Existing, Create, Update, Unchanged, Delete, Replace>): Promise<void> {
  const { changeSet, ownership } = diff;
  const remaining = new Map<string, Existing>();
  for (const [key, existing] of diff.existing) {
    if (existing !== undefined) remaining.set(key, existing);
  }
  for (const desired of diff.desired) {
    const key = diff.keyOf(desired);
    const existing = remaining.get(key);
    if (existing === undefined) {
      changeSet.creates.push(diff.create(desired));
      continue;
    }
    remaining.delete(key);
    const owned = ownership?.ownsDesired(desired, existing) ?? true;
    const replace = diff.replace?.(desired, existing);
    if (replace !== undefined) {
      changeSet.replaces.push(replace);
      continue;
    }
    const configUnchanged = owned && (await diff.isConfigUnchanged(desired, existing));
    if (configUnchanged && diff.versionMatches(desired, existing)) {
      const labelRefresh = diff.labelRefresh?.(desired, existing);
      changeSet.unchanged.push({
        ...diff.unchanged(desired, existing),
        ...(labelRefresh && { labelRefresh }),
      });
    } else {
      changeSet.updates.push({
        ...diff.update(desired, existing),
        ...(configUnchanged && { forcedBySdkVersion: true as const }),
      });
    }
  }
  for (const [key, existing] of remaining) {
    if (ownership && !ownership.ownsRemaining(existing)) continue;
    const item = diff.delete(key, existing);
    if (item !== undefined) changeSet.deletes.push(item);
  }
}
