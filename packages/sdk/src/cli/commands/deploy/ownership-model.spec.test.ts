import * as c from "@toiroakr/chisel/full";
import { describe, expect, test } from "vitest";
import {
  ownsDesiredBehavior,
  ownsDesiredImplementation,
  ownsRemainingBehavior,
  ownsRemainingImplementation,
} from "./ownership-model";

// Answers come from what the SDK documents, not from its code: the deploy
// confirmations in docs/cli/application.md for an application, and the JSDoc of
// createOwnershipTracker for the workspace. A state they do not describe is todo.

const absent = { state: "absent" } as const;
const given = (value: string) => ({ state: "given", value }) as const;
const attached = (labels: { workspaceManaged?: boolean; sdkName?: string; sdkAppId?: string }) =>
  ({
    metadata: "attached",
    workspaceManaged: labels.workspaceManaged ?? false,
    sdkName: labels.sdkName === undefined ? absent : given(labels.sdkName),
    sdkAppId: labels.sdkAppId === undefined ? absent : given(labels.sdkAppId),
  }) as const;
const none = { metadata: "none" } as const;
type Label = typeof absent | ReturnType<typeof given>;
const shop = (
  labels: typeof none | ReturnType<typeof attached>,
  appIdLabel: Label = given("app-1"),
) => ({ owner: "application", name: "shop", appIdLabel, labels }) as const;
const workspace = (labels: typeof none | ReturnType<typeof attached>) =>
  ({ owner: "workspace", labels }) as const;
const answer = <Tag extends string>(tag: Tag) => ({ result: c.caseOf(tag), effects: [] });
const undocumented = c.todo(
  "the docs do not say how an application deploy treats a resource the workspace manages",
);

const desired = c.examples(ownsDesiredBehavior, {
  "no labels are a resource tailor does not manage yet": {
    given: shop(none),
    expect: answer("unmanaged"),
  },
  "labels of no SDK are a resource tailor does not manage yet": {
    given: shop(attached({})),
    expect: answer("unmanaged"),
  },
  "the application's name": { given: shop(attached({ sdkName: "shop" })), expect: answer("owned") },
  "another application's name": {
    given: shop(attached({ sdkName: "billing" })),
    expect: answer("conflict"),
  },
  "its id is recognized across a rename": {
    given: shop(attached({ sdkName: "old", sdkAppId: "app-1" })),
    expect: answer("owned"),
  },
  "a different id under its own name": {
    given: shop(attached({ sdkName: "shop", sdkAppId: "app-2" })),
    expect: answer("conflict"),
  },
  "a different id and no name": {
    given: shop(attached({ sdkAppId: "app-2" })),
    expect: answer("conflict"),
  },
  "an id while the application has none, under its name": {
    given: shop(attached({ sdkName: "shop", sdkAppId: "app-1" }), absent),
    expect: answer("conflict"),
  },
  "an id while the application has none, and no name": {
    given: shop(attached({ sdkAppId: "app-1" }), absent),
    expect: answer("conflict"),
  },
  "no labels, the application having no id": {
    given: shop(none, absent),
    expect: answer("unmanaged"),
  },
  "the application's name, the application having no id": {
    given: shop(attached({ sdkName: "shop" }), absent),
    expect: answer("owned"),
  },
  "a workspace mark": { given: shop(attached({ workspaceManaged: true })), expect: undocumented },
  "a workspace mark, the application having no id": {
    given: shop(attached({ workspaceManaged: true }), absent),
    expect: undocumented,
  },
  "a workspace mark beside the application's name": {
    given: shop(attached({ workspaceManaged: true, sdkName: "shop" })),
    expect: undocumented,
  },
  "a workspace mark beside an id": {
    given: shop(attached({ workspaceManaged: true, sdkAppId: "app-2" })),
    expect: undocumented,
  },
  "the workspace: no labels": { given: workspace(none), expect: answer("unmanaged") },
  "the workspace: labels of no SDK": {
    given: workspace(attached({})),
    expect: answer("unmanaged"),
  },
  "the workspace: its mark": {
    given: workspace(attached({ workspaceManaged: true })),
    expect: answer("owned"),
  },
  "the workspace: its mark beside a name": {
    given: workspace(attached({ workspaceManaged: true, sdkName: "shop" })),
    expect: answer("owned"),
  },
  "the workspace: its mark beside an id": {
    given: workspace(attached({ workspaceManaged: true, sdkAppId: "app-1" })),
    expect: answer("owned"),
  },
  "the workspace: an application's name": {
    given: workspace(attached({ sdkName: "shop" })),
    expect: answer("takeover"),
  },
  "the workspace: an application's id": {
    given: workspace(attached({ sdkAppId: "app-1" })),
    expect: answer("takeover"),
  },
  "the workspace: an application's name and id": {
    given: workspace(attached({ sdkName: "shop", sdkAppId: "app-1" })),
    expect: answer("takeover"),
  },
});

const remaining = c.examples(ownsRemainingBehavior, {
  "no labels are kept": { given: shop(none), expect: answer("keep") },
  "labels of no SDK are kept": { given: shop(attached({})), expect: answer("keep") },
  "the application's name is deleted": {
    given: shop(attached({ sdkName: "shop" })),
    expect: answer("delete"),
  },
  "another application's name is kept": {
    given: shop(attached({ sdkName: "billing" })),
    expect: answer("keep"),
  },
  "its id is deleted across a rename": {
    given: shop(attached({ sdkName: "old", sdkAppId: "app-1" })),
    expect: answer("delete"),
  },
  "a different id is kept": {
    given: shop(attached({ sdkName: "shop", sdkAppId: "app-2" })),
    expect: answer("keep"),
  },
  "an id while the application has none is kept": {
    given: shop(attached({ sdkName: "shop", sdkAppId: "app-1" }), absent),
    expect: answer("keep"),
  },
  "a different id and no name is kept": {
    given: shop(attached({ sdkAppId: "app-2" })),
    expect: answer("keep"),
  },
  "an id and no name while the application has none is kept": {
    given: shop(attached({ sdkAppId: "app-1" }), absent),
    expect: answer("keep"),
  },
  "no labels are kept, the application having no id": {
    given: shop(none, absent),
    expect: answer("keep"),
  },
  "the application's name is deleted, the application having no id": {
    given: shop(attached({ sdkName: "shop" }), absent),
    expect: answer("delete"),
  },
  "a workspace mark is kept": {
    given: shop(attached({ workspaceManaged: true })),
    expect: answer("keep"),
  },
  "a workspace mark is kept, the application having no id": {
    given: shop(attached({ workspaceManaged: true }), absent),
    expect: answer("keep"),
  },
  "a workspace mark beside the application's name is kept": {
    given: shop(attached({ workspaceManaged: true, sdkName: "shop" })),
    expect: answer("keep"),
  },
  "a workspace mark beside its id is kept": {
    given: shop(attached({ workspaceManaged: true, sdkAppId: "app-1" })),
    expect: answer("keep"),
  },
  "the workspace: no labels are kept": { given: workspace(none), expect: answer("keep") },
  "the workspace: labels of no SDK are kept": {
    given: workspace(attached({})),
    expect: answer("keep"),
  },
  "the workspace: its mark is deleted": {
    given: workspace(attached({ workspaceManaged: true })),
    expect: answer("delete"),
  },
  "the workspace: its mark beside a name is deleted": {
    given: workspace(attached({ workspaceManaged: true, sdkName: "shop" })),
    expect: answer("delete"),
  },
  "the workspace: its mark beside an id is deleted": {
    given: workspace(attached({ workspaceManaged: true, sdkAppId: "app-1" })),
    expect: answer("delete"),
  },
  "the workspace: an application's name alone is kept": {
    given: workspace(attached({ sdkName: "shop" })),
    expect: answer("keep"),
  },
  "the workspace: an application's id is taken over and deleted": {
    given: workspace(attached({ sdkAppId: "app-1" })),
    expect: answer("takeoverDelete"),
  },
  "the workspace: an application's name and id are taken over and deleted": {
    given: workspace(attached({ sdkName: "shop", sdkAppId: "app-1" })),
    expect: answer("takeoverDelete"),
  },
});

// Every branch, way through the model and pair of classes is met by a row or owes none, so
// what check still reports is where the code and the docs disagree or the docs are silent.
function gaps(report: c.AdequacyReport): string[] {
  const { arms, rules, pairs } = report.measures;
  return [
    ...(arms.status === "complete" ? arms.arms : []),
    ...(rules.status === "complete" ? rules.rules : []),
    ...(pairs.status === "complete" ? pairs.obligations : []),
  ]
    .filter((item) => item.status === "gap")
    .map((item) => JSON.stringify(item));
}

describe("deploy ownership against what the SDK documents", () => {
  test("ownsDesired: an id label with no name reads as unmanaged, and a workspace mark is undocumented", async () => {
    const report = await c.check(
      c.spec("owns-desired", { implementation: ownsDesiredImplementation, examples: desired }),
    );
    expect(gaps(report)).toStrictEqual([]);
    expect(report.failures.map((failure) => failure.name)).toStrictEqual([
      "a different id and no name",
      "an id while the application has none, and no name",
    ]);
    expect(report.unanswered.map((row) => row.name)).toStrictEqual([
      "a workspace mark",
      "a workspace mark, the application having no id",
      "a workspace mark beside the application's name",
      "a workspace mark beside an id",
    ]);
  });

  test("ownsRemaining: an application deletes what the workspace marked when its own labels remain", async () => {
    const report = await c.check(
      c.spec("owns-remaining", {
        implementation: ownsRemainingImplementation,
        examples: remaining,
      }),
    );
    expect(gaps(report)).toStrictEqual([]);
    expect(report.failures.map((failure) => failure.name)).toStrictEqual([
      "a workspace mark beside the application's name is kept",
      "a workspace mark beside its id is kept",
    ]);
    expect(report.unanswered.map((row) => row.name)).toStrictEqual([]);
  });
});
