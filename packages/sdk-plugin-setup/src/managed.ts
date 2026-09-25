import {
  isMap,
  isNode,
  isPair,
  isScalar,
  isSeq,
  parseDocument,
  type Document,
  type Pair,
  type YAMLMap,
} from "yaml";
import { hashContent, type LockTarget, type TargetKind } from "./lock";

/**
 * Workflow files keep jobs under `jobs:`; composite actions keep one step list
 * under `runs.steps`, whose step ids are recorded unqualified.
 */
export type Layout = "workflow" | "action";

const MANAGED_HASH_PREFIX = "managed-v1:";

const MANAGED_TOP_LEVEL_KEYS: Record<Layout, readonly string[]> = {
  workflow: ["name", "on", "permissions"],
  action: ["name", "description", "inputs", "outputs", "runs"],
};

const EDITABLE_JOB_KEYS = ["runs-on", "timeout-minutes", "container", "env"];

// Keyed by the `tailor-platform/actions/<name>` a managed step uses.
const EDITABLE_WITH_KEYS: Record<string, readonly string[]> = {
  "drift-check": ["ignore", "fail-on-drift"],
  "generate-check": ["ignore"],
  install: ["install-command"],
  notify: ["user-mapping"],
  plan: ["label"],
  setup: ["node-version-file"],
};

// Slots are SDK-placed steps whose listed fields belong to the user.
const SLOTS: Record<Layout, Record<string, readonly string[]>> = {
  workflow: {},
  action: { "build-site": ["run"] },
};

// Non-`tailor-` step ids that earlier template versions wrote, mapped to the
// ids that replaced them.
const RETIRED_IDS: Record<Layout, Record<string, string>> = {
  workflow: { "tailor-deploy/slack-prereq": "tailor-deploy/tailor-slack-prereq" },
  action: {},
};

const STRINGIFY_OPTIONS = { lineWidth: 0, flowCollectionPadding: false } as const;

/** Raised when a file cannot be parsed or merged without losing user content. */
export class ManagedMergeError extends Error {
  override name = "ManagedMergeError";
}

/**
 * File layout of a target kind.
 * @param kind - Lock target kind
 * @returns The layout used to locate its jobs/steps
 */
export function layoutOf(kind: TargetKind): Layout {
  return kind === "action" ? "action" : "workflow";
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

function projectSteps(
  steps: unknown,
  prefix: string,
  managed: ReadonlySet<string>,
  slots: Record<string, readonly string[]>,
): unknown[] {
  if (!Array.isArray(steps)) return [];
  return steps.filter(isPlainObject).flatMap((step) => {
    const id = step["id"];
    if (typeof id !== "string") return [];
    const slotFields = lookup(slots, `${prefix}${id}`);
    if (slotFields) return [omit(step, slotFields)];
    if (!managed.has(`${prefix}${id}`)) return [];
    const editable = editableWithKeys(step["uses"]) ?? [];
    const withMap = step["with"];
    return [isPlainObject(withMap) ? { ...step, with: omit(withMap, editable) } : step];
  });
}

/**
 * Hash the SDK-managed parts of a generated file: the top-level keys the
 * template writes and the jobs/steps listed in `managedIds`, minus the fields
 * users may edit. Comments, formatting, and user-owned nodes do not affect it.
 * @param content - Workflow or composite action YAML
 * @param layout - File layout
 * @param managedIds - Managed ids as recorded in the lock (`<job>` / `<job>/<step>`)
 * @returns Versioned hash string
 */
export function computeManagedHash(
  content: string,
  layout: Layout,
  managedIds: readonly string[],
): string {
  const doc = readMapping(content);
  const managed = new Set(managedIds);
  const slots = SLOTS[layout];
  const projection: Plain = {};
  for (const key of MANAGED_TOP_LEVEL_KEYS[layout]) {
    projection[key] = doc[key] ?? null;
  }
  if (layout === "action") {
    const runs = isPlainObject(doc["runs"]) ? doc["runs"] : {};
    projection["runs"] = {
      ...omit(runs, ["steps"]),
      steps: projectSteps(runs["steps"], "", managed, slots),
    };
  } else {
    const jobs = isPlainObject(doc["jobs"]) ? doc["jobs"] : {};
    projection["jobs"] = Object.fromEntries(
      managedIds
        .filter((id) => !id.includes("/"))
        .map((jobId) => {
          const job = jobs[jobId];
          if (!isPlainObject(job)) return [jobId, null];
          return [
            jobId,
            {
              ...omit(job, [...EDITABLE_JOB_KEYS, "steps"]),
              steps: projectSteps(job["steps"], `${jobId}/`, managed, slots),
            },
          ];
        }),
    );
  }
  return `${MANAGED_HASH_PREFIX}${hashContent(canonicalJson(projection))}`;
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
  rendered: ReadonlySet<string>;
  slots: Record<string, readonly string[]>;
  retired: Record<string, string>;
  force: boolean;
  dropped: string[];
};

function isSdkOwned(qualifiedId: string, ctx: MergeContext): boolean {
  if (Object.hasOwn(ctx.slots, qualifiedId) || ctx.previous.has(qualifiedId)) return true;
  const replacement = lookup(ctx.retired, qualifiedId);
  if (replacement !== undefined && !ctx.previous.has(replacement)) return true;
  if (ctx.rendered.has(qualifiedId)) {
    if (ctx.force) return true;
    throw new ManagedMergeError(
      `"${qualifiedId}" is now managed by the SDK but already exists as your own job or step. ` +
        "Rename yours, or re-run with --force to replace it.",
    );
  }
  return false;
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
  for (const node of currentSteps.items) {
    const id = stepIdOf(node);
    if (id === undefined || !isMap(node)) continue;
    const match = renderedSteps.items.find((candidate) => stepIdOf(candidate) === id);
    if (!isMap(match)) continue;
    const slotFields = lookup(ctx.slots, `${prefix}${id}`);
    if (slotFields) {
      carryFields(node, match, slotFields);
      continue;
    }
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
    (node) => stepIdOf(node),
  );
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
 * the template does not write, jobs and steps outside the managed ids, and the
 * editable fields of managed nodes. Each user node is placed after the managed
 * sibling that preceded it.
 * @param params - Merge inputs
 * @param params.current - File content on disk
 * @param params.rendered - Fresh template render
 * @param params.layout - File layout
 * @param params.previousIds - Managed ids recorded when `current` was generated
 * @param params.renderedIds - Managed ids of `rendered`
 * @param params.force - Replace user nodes that collide with managed ids and drop user steps whose managed job no longer exists, instead of failing
 * @returns Merged content and the labels of any dropped user steps
 */
export function mergeUserContent(params: {
  current: string;
  rendered: string;
  layout: Layout;
  previousIds: readonly string[];
  renderedIds: readonly string[];
  force: boolean;
}): { content: string; dropped: string[] } {
  const { layout } = params;
  const currentDoc = parse(params.current, "The file");
  const renderedDoc = parse(params.rendered, "The rendered template");
  const currentRoot = currentDoc.contents;
  const renderedRoot = renderedDoc.contents;
  if (!isMap(currentRoot) || !isMap(renderedRoot)) {
    throw new ManagedMergeError("The file is not a YAML mapping.");
  }
  const ctx: MergeContext = {
    previous: new Set(params.previousIds),
    rendered: new Set(params.renderedIds),
    slots: SLOTS[layout],
    retired: RETIRED_IDS[layout],
    force: params.force,
    dropped: [],
  };

  const containerKey = layout === "action" ? "runs" : "jobs";
  const managedTop = new Set([...MANAGED_TOP_LEVEL_KEYS[layout], containerKey]);
  placeAfterAnchors(
    currentRoot.items,
    renderedRoot.items,
    (pair) => !managedTop.has(keyOf(pair) ?? ""),
    keyOf,
  );

  if (layout === "action") {
    const currentRuns = mapAt(currentRoot, "runs");
    const renderedRuns = mapAt(renderedRoot, "runs");
    if (currentRuns) mergeSteps(currentRuns, renderedRuns, "", ctx);
  } else {
    const currentJobs = mapAt(currentRoot, "jobs");
    const renderedJobs = mapAt(renderedRoot, "jobs");
    if (currentJobs && renderedJobs) {
      const userJobs = currentJobs.items.filter((pair) => !isSdkOwned(keyOf(pair) ?? "", ctx));
      for (const pair of currentJobs.items) {
        if (userJobs.includes(pair) || !isMap(pair.value)) continue;
        const jobId = keyOf(pair) ?? "";
        const renderedJob = mapAt(renderedJobs, jobId);
        if (renderedJob) carryFields(pair.value, renderedJob, EDITABLE_JOB_KEYS);
        mergeSteps(pair.value, renderedJob, `${jobId}/`, ctx);
      }
      carryLeadingComment(currentJobs, currentJobs.items[0], userJobs);
      placeAfterAnchors(
        currentJobs.items,
        renderedJobs.items,
        (pair) => userJobs.includes(pair),
        keyOf,
      );
    }
    assertNeedsResolve(renderedRoot);
  }

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
  const expected = computeManagedHash(params.rendered, layout, params.renderedIds);
  const roundTripped =
    canonicalJson(toPlain(renderedDoc, "The merged file")) ===
    canonicalJson(toPlain(parse(content, "The merged file"), "The merged file"));
  if (!roundTripped || computeManagedHash(content, layout, params.renderedIds) !== expected) {
    throw mergeFailed("");
  }
  return { content, dropped: ctx.dropped };
}

// Lock entries written before managed hashing record a whole-file hash, with
// the build-site slot body normalized for composite actions.
const BUILD_SITE_RUN_RE =
  /([ \t]*- id: build-site\n(?:[ \t]+if: [^\n]+\n)?[ \t]+shell: bash\n[ \t]+run: \|)([\s\S]*?)(\n[ \t]*- |\n*$)/;

/**
 * Replace the build-site slot body with a placeholder, as legacy lock hashes do.
 * @param content - Composite action content
 * @returns Content with the build-site run body normalized
 */
export function normalizeActionContent(content: string): string {
  return content.replace(
    BUILD_SITE_RUN_RE,
    (_, header, _body, tail) => `${header}\n        true${tail}`,
  );
}

/**
 * Hash on-disk content in the same scheme as the target's recorded hash.
 * @param target - Lock target
 * @param content - File content on disk
 * @returns The comparable hash, or null when the file is not valid YAML
 */
export function currentContentHash(
  target: Pick<LockTarget, "kind" | "contentHash" | "generatedIds">,
  content: string,
): string | null {
  try {
    if (isManagedHash(target.contentHash)) {
      return computeManagedHash(content, layoutOf(target.kind), target.generatedIds);
    }
    readMapping(content);
    return hashContent(target.kind === "action" ? normalizeActionContent(content) : content);
  } catch (error) {
    if (error instanceof ManagedMergeError) return null;
    throw error;
  }
}
