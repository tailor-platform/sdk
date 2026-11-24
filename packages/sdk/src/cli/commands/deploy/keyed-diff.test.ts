import { describe, expect, test } from "vitest";
import { createChangeSet } from "./change-set";
import { diffKeyed, labeledResourceChecks, type KeyedDiffOwnership } from "./keyed-diff";
import { createOwnershipTracker } from "./owned-resource";
import type { MetadataLabelWrite } from "./label";

type Desired = { name: string; config: string; kind?: string };
type Existing = { config: string; kind?: string; owner?: string; version: string };

const currentVersion = "v2";
const ownership: KeyedDiffOwnership<Existing> = {
  ownsDesired: (_key, existing) => existing.owner === "app",
  ownsRemaining: (_key, existing) => existing.owner === "app",
};

async function plan(
  desired: Desired[],
  existing: Partial<Record<string, Existing>>,
  options: { owned?: boolean } = {},
) {
  const changeSet = createChangeSet<
    { name: string },
    { name: string },
    { name: string },
    { name: string },
    { name: string }
  >("Items");
  await diffKeyed({
    changeSet,
    desired,
    existing: Object.entries(existing),
    keyOf: (item) => item.name,
    ...(options.owned === false ? {} : { ownership }),
    versionMatches: (_item, remote) => remote.version === currentVersion,
    isConfigUnchanged: async (item, remote) => item.config === remote.config,
    replace: (item, remote) =>
      item.kind === remote.kind ? undefined : { name: `${item.name}:replace` },
    create: (item) => ({ name: `${item.name}:create` }),
    update: (item) => ({ name: `${item.name}:update` }),
    unchanged: (item) => ({ name: `${item.name}:unchanged` }),
    delete: (key, remote) => (remote.config === "keep" ? undefined : { name: `${key}:delete` }),
  });
  return changeSet;
}

describe("diffKeyed", () => {
  test.each([
    {
      case: "creates a desired item with no match",
      existing: {},
      expected: { creates: ["a:create"] },
    },
    {
      case: "keeps a match whose config and SDK version match",
      existing: { a: { config: "x", owner: "app", version: currentVersion } },
      expected: { unchanged: ["a:unchanged"] },
    },
    {
      case: "forces an update for a match applied by another SDK version",
      existing: { a: { config: "x", owner: "app", version: "v1" } },
      expected: { updates: [{ name: "a:update", forcedBySdkVersion: true }] },
    },
    {
      case: "updates a match whose config differs",
      existing: { a: { config: "y", owner: "app", version: currentVersion } },
      expected: { updates: [{ name: "a:update" }] },
    },
    {
      case: "updates a matching resource it takes over without marking it forced",
      existing: { a: { config: "x", owner: "other", version: currentVersion } },
      expected: { updates: [{ name: "a:update" }] },
    },
    {
      case: "replaces a match that cannot be updated in place",
      existing: { a: { config: "x", kind: "old", owner: "app", version: currentVersion } },
      expected: { replaces: ["a:replace"] },
    },
  ])("$case", async ({ existing, expected }) => {
    const changeSet = await plan([{ name: "a", config: "x" }], existing);

    expect({
      creates: changeSet.creates.map((item) => item.name),
      updates: changeSet.updates,
      unchanged: changeSet.unchanged.map((item) => item.name),
      replaces: changeSet.replaces.map((item) => item.name),
      deletes: changeSet.deletes.map((item) => item.name),
    }).toEqual({ creates: [], updates: [], unchanged: [], replaces: [], deletes: [], ...expected });
  });

  test("deletes owned leftovers and keeps others and those the builder skips", async () => {
    const changeSet = await plan([], {
      owned: { config: "x", owner: "app", version: currentVersion },
      foreign: { config: "x", owner: "other", version: currentVersion },
      skipped: { config: "keep", owner: "app", version: currentVersion },
    });

    expect(changeSet.deletes.map((item) => item.name)).toEqual(["owned:delete"]);
  });

  test("treats every match and leftover as owned without ownership checks", async () => {
    const changeSet = await plan(
      [{ name: "a", config: "x" }],
      {
        a: { config: "x", owner: "other", version: currentVersion },
        b: { config: "x", owner: "other", version: currentVersion },
      },
      { owned: false },
    );

    expect(changeSet.unchanged.map((item) => item.name)).toEqual(["a:unchanged"]);
    expect(changeSet.deletes.map((item) => item.name)).toEqual(["b:delete"]);
  });
});

describe("labeledResourceChecks", () => {
  type LabeledDesired = { name: string; metaRequest: MetadataLabelWrite };
  type LabeledExisting = { allLabels?: Record<string, string> | undefined };

  const desired: LabeledDesired = {
    name: "a",
    metaRequest: {
      trn: "trn:a",
      labels: { "sdk-name": "renamed", "sdk-version": "v2", "sdk-app-id": "app-id-1" },
    },
  };

  async function planLabeled(allLabels: Record<string, string>) {
    const changeSet = createChangeSet<{ name: string }, { name: string }, { name: string }>(
      "Items",
    );
    await diffKeyed({
      changeSet,
      desired: [desired],
      existing: [["a", { allLabels } satisfies LabeledExisting]],
      keyOf: (item) => item.name,
      ...labeledResourceChecks(
        createOwnershipTracker({ kind: "application", name: "renamed", id: "id-1" }),
        "executor",
      ),
      isConfigUnchanged: () => true,
      create: ({ name }) => ({ name }),
      update: ({ name }) => ({ name }),
      unchanged: ({ name }) => ({ name }),
      delete: (name) => ({ name }),
    });
    return changeSet;
  }

  test("refreshes the labels of an owned unchanged resource whose SDK labels differ", async () => {
    const changeSet = await planLabeled({
      "sdk-name": "old-name",
      "sdk-version": "v2",
      "sdk-app-id": "app-id-1",
    });

    expect(changeSet.updates).toEqual([]);
    expect(changeSet.unchanged).toEqual([{ name: "a", labelRefresh: desired.metaRequest }]);
  });

  test("leaves the labels of an unchanged resource that already carries them", async () => {
    const changeSet = await planLabeled({ ...desired.metaRequest.labels, owner: "team-a" });

    expect(changeSet.unchanged).toEqual([{ name: "a" }]);
  });

  test("takes over, for the workspace, a matching resource and a leftover an application deployed", async () => {
    const tracker = createOwnershipTracker({ kind: "workspace" });
    const changeSet = createChangeSet<{ name: string }, { name: string }, { name: string }>(
      "Items",
    );
    const legacy = { "sdk-name": "shop", "sdk-version": "v2", "sdk-app-id": "app-id-1" };

    await diffKeyed({
      changeSet,
      desired: [desired],
      existing: [
        ["a", { allLabels: legacy }],
        ["b", { allLabels: legacy }],
      ],
      keyOf: (item) => item.name,
      ...labeledResourceChecks(tracker, "executor"),
      isConfigUnchanged: () => true,
      create: ({ name }) => ({ name }),
      update: ({ name }) => ({ name }),
      unchanged: ({ name }) => ({ name }),
      delete: (name) => ({ name }),
    });

    expect(changeSet.updates).toEqual([{ name: "a" }]);
    expect(changeSet.deletes).toEqual([{ name: "b" }]);
    expect(tracker.result.takeovers).toEqual([
      {
        resourceType: "executor",
        resourceLabel: "Executor",
        resourceName: "a",
        action: "update",
        currentOwner: "shop",
        currentAppId: "id-1",
      },
      {
        resourceType: "executor",
        resourceLabel: "Executor",
        resourceName: "b",
        action: "delete",
        currentOwner: "shop",
        currentAppId: "id-1",
      },
    ]);
  });
});
