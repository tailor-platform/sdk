import {
  isCollection,
  isMap,
  isNode,
  isPair,
  isScalar,
  isSeq,
  parseDocument,
  Scalar,
  type Document,
  type Pair,
  type YAMLMap,
} from "yaml";
import { hashContent, type LockTarget } from "./lock";

const MANAGED_HASH_PREFIX = "managed-v1:";

const RESERVED_PREFIX = "tailor-";

const MANAGED_TOP_LEVEL_KEYS: readonly string[] = ["name", "on", "permissions"];

const EDITABLE_JOB_KEYS = ["runs-on", "timeout-minutes", "container", "env"];

// Other managed jobs take `environment` from --environment, so it stays managed there.
export const ENVIRONMENT_EDITABLE_JOBS: readonly string[] = [
  "tailor-changes",
  "tailor-tag-guard",
  "tailor-erd-preview-matrix",
  "tailor-erd-preview",
  "tailor-erd-preview-comment",
  "tailor-result",
  "tailor-preview-result",
];

// Users add their own jobs to the `needs` of these jobs; the `tailor-` entries stay managed.
export const RESULT_JOBS: readonly string[] = ["tailor-result", "tailor-preview-result"];

function editableJobKeys(jobId: string): readonly string[] {
  return ENVIRONMENT_EDITABLE_JOBS.includes(jobId)
    ? [...EDITABLE_JOB_KEYS, "environment"]
    : EDITABLE_JOB_KEYS;
}

// Keyed by the `tailor-platform/actions/<name>` a managed step uses.
const EDITABLE_WITH_KEYS: Record<string, readonly string[]> = {
  "drift-check": ["ignore", "fail-on-drift"],
  "generate-check": ["ignore"],
  install: ["install-command"],
  notify: ["user-mapping"],
  plan: ["label"],
  setup: ["node-version-file"],
};

// Non-`tailor-` step ids that earlier template versions wrote, mapped to the ids that replaced them.
const RETIRED_IDS: Record<string, string> = {
  "tailor-deploy/slack-prereq": "tailor-deploy/tailor-slack-prereq",
};

const STRINGIFY_OPTIONS = { lineWidth: 0, flowCollectionPadding: false } as const;

/** Raised when a file cannot be parsed or merged without losing user content. */
export class ManagedMergeError extends Error {
  override name = "ManagedMergeError";
}

/**
 * Whether a lock `contentHash` was computed by {@link computeManagedHash}.
 * @param contentHash - Hash recorded in the lock
 * @returns True for a managed-projection hash
 */
export function isManagedHash(contentHash: string): boolean {
  return contentHash.startsWith(MANAGED_HASH_PREFIX);
}

function toPlain(doc: Document, label: string): unknown {
  try {
    return doc.toJS();
  } catch (error) {
    throw new ManagedMergeError(
      `${label} could not be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function parse(content: string, label: string): Document {
  const doc = parseDocument(content);
  const [error] = doc.errors;
  if (error) {
    throw new ManagedMergeError(`${label} is not valid YAML: ${error.message}`);
  }
  return doc;
}

type Plain = Record<string, unknown>;

function isPlainObject(value: unknown): value is Plain {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readMapping(content: string): Plain {
  const root = toPlain(parse(content, "The file"), "The file");
  if (!isPlainObject(root)) throw new ManagedMergeError("The file is not a YAML mapping.");
  return root;
}

function lookup<T>(record: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function editableWithKeys(uses: unknown): readonly string[] | undefined {
  if (typeof uses !== "string") return undefined;
  const name = /^tailor-platform\/actions\/([a-z0-9-]+)@/.exec(uses)?.[1];
  return name === undefined ? undefined : lookup(EDITABLE_WITH_KEYS, name);
}

function omit(value: Plain, keys: readonly string[]): Plain {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
}

function isUserNeed(need: unknown): boolean {
  return typeof need === "string" && !need.startsWith(RESERVED_PREFIX);
}

function needsList(needs: unknown): unknown[] | undefined {
  if (typeof needs === "string") return [needs];
  return Array.isArray(needs) ? needs : undefined;
}

function withoutUserNeeds(jobId: string, job: Plain): Plain {
  if (!RESULT_JOBS.includes(jobId)) return job;
  const list = needsList(job["needs"]);
  return list ? { ...job, needs: list.filter((need) => !isUserNeed(need)) } : job;
}

function canonicalJson(value: unknown, seen = new WeakSet<object>()): string {
  if (typeof value === "object" && value !== null) {
    if (seen.has(value)) throw new ManagedMergeError("The file contains a recursive alias.");
    seen.add(value);
  }
  try {
    if (Array.isArray(value))
      return `[${value.map((item) => canonicalJson(item, seen)).join(",")}]`;
    if (isPlainObject(value)) {
      const entries = Object.keys(value)
        .toSorted()
        .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key], seen)}`);
      return `{${entries.join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
  } finally {
    if (typeof value === "object" && value !== null) seen.delete(value);
  }
}

function resolveRetired(
  qualifiedId: string,
  retired: Record<string, string>,
  recorded: ReadonlySet<string>,
): string {
  const replacement = lookup(retired, qualifiedId);
  return replacement !== undefined && !recorded.has(replacement) ? replacement : qualifiedId;
}

function projectSteps(steps: unknown, prefix: string, managed: ReadonlySet<string>): unknown[] {
  if (!Array.isArray(steps)) return [];
  return steps.filter(isPlainObject).flatMap((step) => {
    const id = step["id"];
    if (typeof id !== "string") return [];
    const qualifiedId = `${prefix}${id}`;
    if (!managed.has(qualifiedId)) return [];
    const editable = editableWithKeys(step["uses"]) ?? [];
    const withMap = step["with"];
    return [isPlainObject(withMap) ? { ...step, with: omit(withMap, editable) } : step];
  });
}

/**
 * Hash the SDK-managed parts of a generated file: the top-level keys the
 * SDK manages and the jobs/steps listed in `managedIds`, minus the fields
 * users may edit. Comments, formatting, and user-owned nodes do not affect it.
 * @param content - Workflow YAML
 * @param managedIds - Managed ids as recorded in the lock (`<job>` / `<job>/<step>`)
 * @returns Versioned hash string
 */
export function computeManagedHash(content: string, managedIds: readonly string[]): string {
  const projection = projectManaged(content, managedIds);
  return `${MANAGED_HASH_PREFIX}${hashContent(canonicalJson(projection))}`;
}

/**
 * Hash each SDK-managed part of a generated file separately: every top-level
 * key the SDK manages, every managed job (with the order of its managed
 * steps), and every managed step.
 * @param content - Workflow YAML
 * @param managedIds - Managed ids as recorded in the lock (`<job>` / `<job>/<step>`)
 * @returns Hashes keyed by top-level key, `<job>`, or `<job>/<step>`
 */
export function computeManagedParts(
  content: string,
  managedIds: readonly string[],
): Record<string, string> {
  const projection = projectManaged(content, managedIds);
  const parts: Record<string, unknown> = {};
  const addWithSteps = (key: string, container: Plain, prefix: string): void => {
    const steps = (container["steps"] as Plain[]).map(
      (step) => [`${prefix}${String(step["id"])}`, step] as const,
    );
    parts[key] = { ...omit(container, ["steps"]), steps: steps.map(([id]) => id) };
    for (const [id, step] of steps) parts[id] = step;
  };
  for (const key of MANAGED_TOP_LEVEL_KEYS) parts[key] = projection[key];
  for (const [jobId, job] of Object.entries(projection["jobs"] as Record<string, Plain | null>)) {
    if (job !== null) addWithSteps(jobId, job, `${jobId}/`);
  }
  return Object.fromEntries(
    Object.entries(parts).map(([key, part]) => [key, hashContent(canonicalJson(part))]),
  );
}

/**
 * Compare per-part hashes from {@link computeManagedParts}.
 * @param recorded - Hashes recorded when the file was generated
 * @param current - Hashes of the file on disk
 * @returns Changed or missing parts in recorded order; the steps of a missing job are not listed
 */
export function findEditedParts(
  recorded: Record<string, string>,
  current: Record<string, string>,
): string[] {
  const changed = Object.keys(recorded).filter((key) => lookup(current, key) !== recorded[key]);
  return changed.filter((key) => {
    const slash = key.indexOf("/");
    if (slash === -1) return true;
    const job = key.slice(0, slash);
    return !(changed.includes(job) && lookup(current, job) === undefined);
  });
}

/**
 * Name the managed parts of `content` that differ from those recorded for a
 * lock target.
 * @param target - Lock target
 * @param content - File content on disk
 * @returns Edited parts, or undefined when the lock records no per-part hashes or the file cannot be read
 */
export function editedPartsOf(
  target: Pick<LockTarget, "generatedIds" | "managedHashes">,
  content: string,
): string[] | undefined {
  if (target.managedHashes === undefined) return undefined;
  try {
    const current = computeManagedParts(content, target.generatedIds);
    return findEditedParts(target.managedHashes, current);
  } catch (error) {
    if (error instanceof ManagedMergeError) return undefined;
    throw error;
  }
}

/**
 * Open a hand-edit message, naming the edited parts when they are known.
 * @param subject - What was edited, such as a file path
 * @param parts - Edited parts from {@link editedPartsOf}
 * @returns The first sentence of the message
 */
export function describeHandEdit(subject: string, parts: readonly string[] | undefined): string {
  if (parts === undefined || parts.length === 0) {
    return `SDK-managed parts of ${subject} (tailor-* jobs/steps or top-level keys) were edited by hand.`;
  }
  return `SDK-managed parts of ${subject} were edited by hand: ${parts.map((part) => `"${part}"`).join(", ")}.`;
}

function projectManaged(content: string, managedIds: readonly string[]): Plain {
  const doc = readMapping(content);
  const sdkIds = managedIds.filter(
    (id) => localId(id).startsWith(RESERVED_PREFIX) || Object.hasOwn(RETIRED_IDS, id),
  );
  const managed = new Set(sdkIds);
  const projection: Plain = {};
  for (const key of MANAGED_TOP_LEVEL_KEYS) {
    projection[key] = doc[key] ?? null;
  }
  const jobs = isPlainObject(doc["jobs"]) ? doc["jobs"] : {};
  projection["jobs"] = Object.fromEntries(
    sdkIds
      .filter((id) => !id.includes("/"))
      .map((jobId) => {
        const job = jobs[jobId];
        if (!isPlainObject(job)) return [jobId, null];
        return [
          jobId,
          {
            ...omit(withoutUserNeeds(jobId, job), [...editableJobKeys(jobId), "steps"]),
            steps: projectSteps(job["steps"], `${jobId}/`, managed),
          },
        ];
      }),
  );
  return projection;
}

function stepIds(steps: unknown, prefix: string): string[] {
  if (!Array.isArray(steps)) return [];
  return steps.flatMap((step) =>
    isPlainObject(step) && typeof step["id"] === "string" ? [`${prefix}${step["id"]}`] : [],
  );
}

/**
 * List the jobs and steps that use the reserved `tailor-` prefix without
 * being managed by the SDK.
 * @param content - Workflow YAML
 * @param managedIds - Managed ids as recorded in the lock (`<job>` / `<job>/<step>`)
 * @returns Offending ids in file order
 */
export function findReservedIds(content: string, managedIds: readonly string[]): string[] {
  const doc = readMapping(content);
  const managed = new Set(managedIds);
  const jobs = isPlainObject(doc["jobs"]) ? doc["jobs"] : {};
  const ids = Object.entries(jobs).flatMap(([jobId, job]) => [
    jobId,
    ...(isPlainObject(job) ? stepIds(job["steps"], `${jobId}/`) : []),
  ]);
  return ids.filter((id) => localId(id).startsWith(RESERVED_PREFIX) && !managed.has(id));
}

function keyOf(pair: Pair): string | undefined {
  return isScalar(pair.key) ? String(pair.key.value) : undefined;
}

function stepIdOf(node: unknown): string | undefined {
  if (!isMap(node)) return undefined;
  const id = node.get("id");
  return typeof id === "string" ? id : undefined;
}

function stepLabel(node: unknown): string {
  if (!isMap(node)) return "(step)";
  const label = node.get("id") ?? node.get("name") ?? node.get("uses") ?? node.get("run");
  return typeof label === "string" ? label : "(step)";
}

function findPair(map: YAMLMap, key: string): Pair | undefined {
  return map.items.find((pair) => keyOf(pair) === key);
}

function mapAt(map: YAMLMap, key: string): YAMLMap | undefined {
  const value = findPair(map, key)?.value;
  return isMap(value) ? value : undefined;
}

// Rebuilds `target` so every kept item sits right after the nearest item
// that preceded it in `source` and still exists in `target`.
function placeAfterAnchors<T>(
  source: readonly T[],
  target: T[],
  keep: (item: T) => boolean,
  anchorKey: (item: T) => string | undefined,
): void {
  const targetKeys = new Set(target.map(anchorKey).filter((key) => key !== undefined));
  const groups = new Map<string | undefined, T[]>();
  let anchor: string | undefined;
  for (const item of source) {
    if (keep(item)) {
      groups.set(anchor, [...(groups.get(anchor) ?? []), item]);
      continue;
    }
    const key = anchorKey(item);
    if (key !== undefined && targetKeys.has(key)) anchor = key;
  }
  const rebuilt = [...(groups.get(undefined) ?? [])];
  for (const item of target) {
    rebuilt.push(item);
    const key = anchorKey(item);
    if (key !== undefined) rebuilt.push(...(groups.get(key) ?? []));
  }
  target.splice(0, target.length, ...rebuilt);
}

function carryFields(current: YAMLMap, rendered: YAMLMap, keys: readonly string[]): void {
  const carried = current.items.filter((pair) => keys.includes(keyOf(pair) ?? ""));
  if (carried.length === 0) return;
  const carriedKeys = new Set(carried.map(keyOf));
  rendered.items = rendered.items.filter((pair) => !carriedKeys.has(keyOf(pair)));
  placeAfterAnchors(current.items, rendered.items, (pair) => carried.includes(pair), keyOf);
}

// A comment above the first item of a collection is stored on the collection;
// move it onto that item when the item is the user's.
function carryLeadingComment(
  collection: { commentBefore?: string | null },
  firstItem: unknown,
  userItems: readonly unknown[],
): void {
  const comment = collection.commentBefore;
  if (!comment || !userItems.includes(firstItem)) return;
  const target = isPair(firstItem) ? firstItem.key : firstItem;
  if (!isNode(target)) return;
  target.commentBefore = target.commentBefore ? `${comment}\n${target.commentBefore}` : comment;
}

type MergeContext = {
  previous: ReadonlySet<string>;
  force: boolean;
  dropped: string[];
};

function localId(qualifiedId: string): string {
  return qualifiedId.slice(qualifiedId.lastIndexOf("/") + 1);
}

/**
 * Explain how to fix a user job or step id that uses the reserved prefix.
 * @param qualifiedId - `<job>` / `<job>/<step>`
 * @returns Message naming the id and a rename suggestion
 */
export function describeReservedId(qualifiedId: string): string {
  const suggestion = localId(qualifiedId).slice(RESERVED_PREFIX.length);
  const example = suggestion === "" ? "" : ` (e.g. "${suggestion}")`;
  return (
    `"${qualifiedId}" uses the ${RESERVED_PREFIX} prefix reserved for SDK-managed jobs and steps. ` +
    `Rename it${example}; --force does not rename it.`
  );
}

function reservedIdError(qualifiedId: string): ManagedMergeError {
  return new ManagedMergeError(describeReservedId(qualifiedId));
}

function isSdkOwned(qualifiedId: string, ctx: MergeContext): boolean {
  if (resolveRetired(qualifiedId, RETIRED_IDS, ctx.previous) !== qualifiedId) return true;
  if (!localId(qualifiedId).startsWith(RESERVED_PREFIX)) return false;
  if (ctx.previous.has(qualifiedId)) return true;
  throw reservedIdError(qualifiedId);
}

function assertNoReservedSteps(job: unknown, prefix: string): void {
  if (!isMap(job)) return;
  const steps = findPair(job, "steps")?.value;
  if (!isSeq(steps)) return;
  for (const node of steps.items) {
    const id = stepIdOf(node);
    if (id?.startsWith(RESERVED_PREFIX)) throw reservedIdError(`${prefix}${id}`);
  }
}

function mergeSteps(
  current: YAMLMap,
  rendered: YAMLMap | undefined,
  prefix: string,
  ctx: MergeContext,
): void {
  const currentSteps = findPair(current, "steps")?.value;
  if (!isSeq(currentSteps)) return;
  const owned = (node: unknown): boolean => {
    const id = stepIdOf(node);
    return id !== undefined && isSdkOwned(`${prefix}${id}`, ctx);
  };
  const userSteps = currentSteps.items.filter((node) => !owned(node));
  const renderedSteps = rendered ? findPair(rendered, "steps")?.value : undefined;
  if (!isSeq(renderedSteps)) {
    if (userSteps.length === 0) return;
    const labels = userSteps.map((node) => `${prefix}${stepLabel(node)}`);
    if (!ctx.force) {
      throw new ManagedMergeError(
        `Your steps ${labels.join(", ")} are inside a job the SDK no longer generates. ` +
          "Move them to your own job, or re-run with --force to drop them.",
      );
    }
    ctx.dropped.push(...labels);
    return;
  }
  const renderedIdOf = (node: unknown): string | undefined => {
    const id = stepIdOf(node);
    return id === undefined
      ? undefined
      : localId(resolveRetired(`${prefix}${id}`, RETIRED_IDS, ctx.previous));
  };
  for (const node of currentSteps.items) {
    const renderedId = renderedIdOf(node);
    if (renderedId === undefined || !isMap(node)) continue;
    const match = renderedSteps.items.find((candidate) => stepIdOf(candidate) === renderedId);
    if (!isMap(match)) continue;
    const editable = editableWithKeys(match.get("uses"));
    const currentWith = mapAt(node, "with");
    const renderedWith = mapAt(match, "with");
    if (editable && currentWith && renderedWith) carryFields(currentWith, renderedWith, editable);
  }
  carryLeadingComment(currentSteps, currentSteps.items[0], userSteps);
  placeAfterAnchors(
    currentSteps.items,
    renderedSteps.items,
    (node) => userSteps.includes(node),
    renderedIdOf,
  );
}

function plainJob(root: unknown, jobId: string): Plain | undefined {
  const jobs = isPlainObject(root) ? root["jobs"] : undefined;
  const job = isPlainObject(jobs) ? lookup(jobs, jobId) : undefined;
  return isPlainObject(job) ? job : undefined;
}

function sharedValue(values: readonly unknown[]): unknown {
  const [first] = values;
  return values.every((value) => canonicalJson(value) === canonicalJson(first)) ? first : undefined;
}

// Only a runner every kept job shares is carried; mixed runners are not guessed between.
function carryRunsOnToAddedJobs(params: {
  doc: Document;
  currentJobs: YAMLMap;
  renderedJobs: YAMLMap;
  currentRoot: unknown;
  renderedRoot: unknown;
}): void {
  const templateOf = (jobId: string): unknown => plainJob(params.renderedRoot, jobId)?.["runs-on"];
  const jobIds = params.renderedJobs.items.map((pair) => keyOf(pair) ?? "");
  const kept = jobIds.filter((jobId) => findPair(params.currentJobs, jobId) !== undefined);
  const template = sharedValue(kept.map(templateOf));
  const runsOn = sharedValue(
    kept.map((jobId) => plainJob(params.currentRoot, jobId)?.["runs-on"] ?? templateOf(jobId)),
  );
  if (template === undefined || runsOn === undefined) return;
  if (canonicalJson(runsOn) === canonicalJson(template)) return;
  const source = mapAt(params.currentJobs, kept[0] ?? "")?.get("runs-on", true);
  const flow = isCollection(source) && source.flow === true;
  for (const pair of params.renderedJobs.items) {
    const jobId = keyOf(pair) ?? "";
    if (kept.includes(jobId) || !isMap(pair.value)) continue;
    if (canonicalJson(templateOf(jobId)) !== canonicalJson(template)) continue;
    pair.value.set(
      "runs-on",
      params.doc.createNode(runsOn, { flow, aliasDuplicateObjects: false }),
    );
  }
}

function carryUserNeeds(currentRoot: unknown, jobId: string, rendered: YAMLMap): void {
  const renderedNeeds = findPair(rendered, "needs")?.value;
  const job = plainJob(currentRoot, jobId);
  if (!job || !isSeq(renderedNeeds)) return;
  const source = (needsList(job["needs"]) ?? []).map((need) =>
    isUserNeed(need) ? new Scalar(need) : need,
  );
  placeAfterAnchors(source, renderedNeeds.items, isScalar, (item) => {
    const value: unknown = isScalar(item) ? item.value : item;
    return typeof value === "string" ? value : undefined;
  });
}

function assertNeedsResolve(root: YAMLMap): void {
  const jobs = mapAt(root, "jobs");
  if (!jobs) return;
  const jobIds = new Set(jobs.items.map(keyOf));
  for (const pair of jobs.items) {
    const job = pair.value;
    if (!isMap(job)) continue;
    const needs: unknown = job.toJSON()["needs"];
    const list = typeof needs === "string" ? [needs] : Array.isArray(needs) ? needs : [];
    const missing = list.filter((need) => typeof need === "string" && !jobIds.has(need));
    if (missing.length > 0) {
      throw new ManagedMergeError(
        `Job "${String(keyOf(pair))}" needs ${missing.join(", ")}, which the SDK no longer generates. ` +
          "Update its needs, then re-run setup.",
      );
    }
  }
}

/**
 * Carry the user-owned parts of `current` into a fresh render: top-level keys
 * the SDK does not manage (replacing the template's default for one it also
 * writes), jobs and steps outside the managed ids, and the editable fields of
 * managed nodes. Each user node is placed after the managed sibling that
 * preceded it.
 * @param params - Merge inputs
 * @param params.current - File content on disk
 * @param params.rendered - Fresh template render
 * @param params.previousIds - Managed ids recorded when `current` was generated
 * @param params.renderedIds - Managed ids of `rendered`
 * @param params.force - Drop user steps whose managed job no longer exists instead of failing
 * @returns Merged content and the labels of any dropped user steps
 */
export function mergeUserContent(params: {
  current: string;
  rendered: string;
  previousIds: readonly string[];
  renderedIds: readonly string[];
  force: boolean;
}): { content: string; dropped: string[] } {
  const currentDoc = parse(params.current, "The file");
  const renderedDoc = parse(params.rendered, "The rendered template");
  const currentRoot = currentDoc.contents;
  const renderedRoot = renderedDoc.contents;
  if (!isMap(currentRoot) || !isMap(renderedRoot)) {
    throw new ManagedMergeError("The file is not a YAML mapping.");
  }
  const currentPlain = toPlain(currentDoc, "The file");
  const renderedPlain = toPlain(renderedDoc, "The rendered template");
  const ctx: MergeContext = {
    previous: new Set(params.previousIds),
    force: params.force,
    dropped: [],
  };

  const managedTop = new Set([...MANAGED_TOP_LEVEL_KEYS, "jobs"]);
  const userTopKeys = currentRoot.items
    .map((pair) => keyOf(pair) ?? "")
    .filter((key) => !managedTop.has(key));
  carryFields(currentRoot, renderedRoot, userTopKeys);

  const currentJobs = mapAt(currentRoot, "jobs");
  const renderedJobs = mapAt(renderedRoot, "jobs");
  if (currentJobs && renderedJobs) {
    const userJobs = currentJobs.items.filter((pair) => !isSdkOwned(keyOf(pair) ?? "", ctx));
    for (const pair of userJobs) assertNoReservedSteps(pair.value, `${keyOf(pair) ?? ""}/`);
    for (const pair of currentJobs.items) {
      if (userJobs.includes(pair) || !isMap(pair.value)) continue;
      const jobId = keyOf(pair) ?? "";
      const renderedJob = mapAt(renderedJobs, jobId);
      if (renderedJob) {
        carryFields(pair.value, renderedJob, editableJobKeys(jobId));
        if (RESULT_JOBS.includes(jobId)) carryUserNeeds(currentPlain, jobId, renderedJob);
      }
      mergeSteps(pair.value, renderedJob, `${jobId}/`, ctx);
    }
    carryRunsOnToAddedJobs({
      doc: renderedDoc,
      currentJobs,
      renderedJobs,
      currentRoot: currentPlain,
      renderedRoot: renderedPlain,
    });
    carryLeadingComment(currentJobs, currentJobs.items[0], userJobs);
    placeAfterAnchors(
      currentJobs.items,
      renderedJobs.items,
      (pair) => userJobs.includes(pair),
      keyOf,
    );
  }
  assertNeedsResolve(renderedRoot);

  if (currentDoc.comment) renderedDoc.comment = currentDoc.comment;
  const mergeFailed = (detail: string) =>
    new ManagedMergeError(
      `Your edits could not be merged into the regenerated file automatically${detail}. ` +
        "Move your changes out, delete the file, and re-run setup.",
    );
  let content: string;
  try {
    content = renderedDoc.toString(STRINGIFY_OPTIONS);
  } catch (error) {
    throw mergeFailed(`: ${error instanceof Error ? error.message : String(error)}`);
  }
  const expected = computeManagedHash(params.rendered, params.renderedIds);
  const roundTripped =
    canonicalJson(toPlain(renderedDoc, "The merged file")) ===
    canonicalJson(toPlain(parse(content, "The merged file"), "The merged file"));
  if (!roundTripped || computeManagedHash(content, params.renderedIds) !== expected) {
    throw mergeFailed("");
  }
  return { content, dropped: ctx.dropped };
}

/**
 * Hash on-disk content in the same scheme as the target's recorded hash.
 * @param target - Lock target
 * @param content - File content on disk
 * @returns The comparable hash, or null when the file is not valid YAML
 */
export function currentContentHash(
  target: Pick<LockTarget, "contentHash" | "generatedIds">,
  content: string,
): string | null {
  try {
    if (isManagedHash(target.contentHash)) {
      return computeManagedHash(content, target.generatedIds);
    }
    readMapping(content);
    return hashContent(content);
  } catch (error) {
    if (error instanceof ManagedMergeError) return null;
    throw error;
  }
}
