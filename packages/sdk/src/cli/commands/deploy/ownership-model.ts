import * as c from "@toiroakr/chisel";
import {
  type DeployOwner,
  sdkAppIdLabelKey,
  sdkAppIdLabelValue,
  sdkManagedLabelKey,
  sdkManagedLabelValue,
  sdkNameLabelKey,
} from "./label";

// A label holding "" is read as absent, as the deploy has always read it.
const label = c.variants("state", {
  absent: c.object({}),
  given: c.object({ value: c.string().min(1) }),
});

const metadata = c.variants("metadata", {
  none: c.object({}),
  attached: c.object({ workspaceManaged: c.boolean(), sdkName: label, sdkAppId: label }),
});

const ownershipInput = c.variants("owner", {
  application: c.object({ name: c.string().min(1), appIdLabel: label, labels: metadata }),
  workspace: c.object({ labels: metadata }),
});

export const ownsDesiredBehavior = c.behavior("owns-desired", {
  description:
    "Whether a deploy plans a same-named existing resource, and what it must confirm otherwise",
  input: ownershipInput,
  result: c.variants("verdict", {
    owned: c.object({}),
    takeover: c.object({ currentOwner: c.string().optional() }),
    conflict: c.object({ currentOwner: c.string() }),
    unmanaged: c.object({}),
  }),
  effects: c.variants("kind", {}),
});

export const ownsRemainingBehavior = c.behavior("owns-remaining", {
  description: "Whether a deploy deletes an existing resource its config no longer defines",
  input: ownershipInput,
  result: c.variants("verdict", {
    delete: c.object({}),
    takeoverDelete: c.object({ currentOwner: c.string().optional() }),
    keep: c.object({ otherOwner: c.string().optional() }),
  }),
  effects: c.variants("kind", {}),
});

type Input = c.Infer<typeof ownershipInput>;
type Label = c.Infer<typeof label>;
type Attached = Extract<c.Infer<typeof metadata>, { metadata: "attached" }>;
type Application = Extract<Input, { owner: "application" }>;

// Owned by id when the resource carries one, otherwise by name.
function byApplication<R>(params: {
  input: c.TermOf<Application>;
  labels: c.TermOf<Attached>;
  owned: c.Template<R>;
  other: () => c.Template<R>;
}): c.Expression<R> {
  const { input, labels, owned, other } = params;
  return c.matchValue<typeof label, R>(label, labels.sdkAppId, {
    given: (appId) =>
      c.matchValue<typeof label, R>(label, input.appIdLabel, {
        given: (id) => c.choose<R, R>(appId.value.$eq(id.value), owned, other()),
        absent: other,
      }),
    absent: () =>
      c.matchValue<typeof label, R>(label, labels.sdkName, {
        given: (name) => c.choose<R, R>(name.value.$eq(input.name), owned, other()),
        absent: other,
      }),
  });
}

type Desired = c.Infer<(typeof ownsDesiredBehavior)["result"]>;
type Remaining = c.Infer<(typeof ownsRemainingBehavior)["result"]>;

const owned: Desired = { verdict: "owned" };
const unmanaged: Desired = { verdict: "unmanaged" };

export const ownsDesiredImplementation = c.implement(ownsDesiredBehavior, {
  cases: {
    application: c.model("application owns desired", (input) => ({
      result: c.matchValue<typeof metadata, Desired>(metadata, input.labels, {
        none: () => unmanaged,
        attached: (labels: c.TermOf<Attached>) =>
          byApplication<Desired>({
            input,
            labels,
            owned,
            other: () =>
              c.matchValue<typeof label, Desired>(label, labels.sdkName, {
                given: (name) => ({ verdict: "conflict", currentOwner: name.value }),
                absent: () => unmanaged,
              }),
          }),
      }),
      effects: [],
    })),
    workspace: c.model("workspace owns desired", (input) => ({
      result: c.matchValue<typeof metadata, Desired>(metadata, input.labels, {
        none: () => unmanaged,
        attached: (labels: c.TermOf<Attached>) =>
          c.choose(
            labels.workspaceManaged.$eq(true),
            owned,
            c.matchValue<typeof label, Desired>(label, labels.sdkName, {
              given: (name) => ({ verdict: "takeover", currentOwner: name.value }),
              absent: () =>
                c.matchValue<typeof label, Desired>(label, labels.sdkAppId, {
                  given: () => ({ verdict: "takeover" }),
                  absent: () => unmanaged,
                }),
            }),
          ),
      }),
      effects: [],
    })),
  },
});

const deleted: Remaining = { verdict: "delete" };
const kept: Remaining = { verdict: "keep" };

export const ownsRemainingImplementation = c.implement(ownsRemainingBehavior, {
  cases: {
    application: c.model("application owns remaining", (input) => ({
      result: c.matchValue<typeof metadata, Remaining>(metadata, input.labels, {
        none: () => kept,
        attached: (labels: c.TermOf<Attached>) =>
          byApplication<Remaining>({
            input,
            labels,
            owned: deleted,
            other: () =>
              c.matchValue<typeof label, Remaining>(label, labels.sdkName, {
                given: (name) => ({ verdict: "keep", otherOwner: name.value }),
                absent: () => kept,
              }),
          }),
      }),
      effects: [],
    })),
    workspace: c.model("workspace owns remaining", (input) => ({
      result: c.matchValue<typeof metadata, Remaining>(metadata, input.labels, {
        none: () => kept,
        attached: (labels: c.TermOf<Attached>) =>
          c.choose(
            labels.workspaceManaged.$eq(true),
            deleted,
            c.matchValue<typeof label, Remaining>(label, labels.sdkAppId, {
              given: () =>
                c.matchValue<typeof label, Remaining>(label, labels.sdkName, {
                  given: (name) => ({ verdict: "takeoverDelete", currentOwner: name.value }),
                  absent: () => ({ verdict: "takeoverDelete" }),
                }),
              absent: () => kept,
            }),
          ),
      }),
      effects: [],
    })),
  },
});

function labelOf(value: string | undefined): Label {
  return value ? { state: "given", value } : { state: "absent" };
}

/**
 * Read the labels of an existing resource and the deploy's owner as the ownership models' input.
 * @param labels - Labels currently stored on the remote resource
 * @param owner - Owner of the resources the deploy manages
 * @returns The models' input
 */
export function ownershipInputOf(
  labels: Record<string, string> | undefined,
  owner: DeployOwner,
): Input {
  const read =
    labels === undefined
      ? { metadata: "none" as const }
      : {
          metadata: "attached" as const,
          workspaceManaged: labels[sdkManagedLabelKey] === sdkManagedLabelValue,
          sdkName: labelOf(labels[sdkNameLabelKey]),
          sdkAppId: labelOf(labels[sdkAppIdLabelKey]),
        };
  return owner.kind === "workspace"
    ? { owner: "workspace", labels: read }
    : {
        owner: "application",
        name: owner.name,
        appIdLabel: labelOf(owner.id === undefined ? undefined : sdkAppIdLabelValue(owner.id)),
        labels: read,
      };
}
