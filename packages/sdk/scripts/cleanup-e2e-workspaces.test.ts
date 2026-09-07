import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { describe, expect, test } from "vitest";
import { selectWorkspacesToDelete, type CleanupWorkspace } from "./cleanup-e2e-workspaces";

const NOW = new Date("2026-09-07T12:00:00Z");

function workspace(name: string, createdHoursAgo: number | null = 48): CleanupWorkspace {
  return {
    id: `id-${name}`,
    name,
    ...(createdHoursAgo === null
      ? {}
      : { createTime: timestampFromDate(new Date(NOW.getTime() - createdHoursAgo * 3_600_000)) }),
  };
}

describe("selectWorkspacesToDelete", () => {
  test("keeps only the recognized e2e prefixes", () => {
    const mine = [
      workspace("e2e-ws-abc"),
      workspace("template-e2e-1"),
      workspace("sdk-ci-1-slug"),
      workspace("sdk-ci-migration-1"),
    ];
    const theirs = [workspace("production"), workspace("my-app-pr-42"), workspace("old-e2e-ws-1")];

    expect(selectWorkspacesToDelete([...mine, ...theirs], {}, NOW)).toEqual(mine);
  });

  test("scopes to the exact run-id segment, not a substring of it", () => {
    const target = workspace("e2e-ws-123-sdk-mabc");
    const longerRunId = workspace("e2e-ws-1234-sdk-mabc");
    const runIdElsewhere = workspace("e2e-ws-999-sdk-123");

    const selected = selectWorkspacesToDelete(
      [target, longerRunId, runIdElsewhere],
      { runId: "123-sdk" },
      NOW,
    );

    expect(selected).toEqual([target]);
  });

  test("matches every workspace a run creates, including the migration target", () => {
    const primary = workspace("e2e-ws-123-sdk-mabc");
    const migrationTarget = workspace("e2e-ws-123-sdk-mabc-migration-target");
    const template = workspace("template-e2e-123-template");

    const selected = selectWorkspacesToDelete(
      [primary, migrationTarget, template],
      { runId: "123-sdk" },
      NOW,
    );

    expect(selected).toEqual([primary, migrationTarget]);
  });

  test("matches a run id that ends the name with no trailing segment", () => {
    const template = workspace("template-e2e-123-template");

    expect(selectWorkspacesToDelete([template], { runId: "123-template" }, NOW)).toEqual([
      template,
    ]);
  });

  test("selects only run-id-less workspaces old enough in local-orphan mode", () => {
    const orphan = workspace("e2e-ws-mabc");
    const fresh = workspace("e2e-ws-mdef", 1);
    const fromCi = workspace("e2e-ws-123-sdk-mabc");
    const unknownAge = workspace("e2e-ws-mghi", null);

    const selected = selectWorkspacesToDelete(
      [orphan, fresh, fromCi, unknownAge],
      { localOrphans: true, minAgeHours: 24 },
      NOW,
    );

    expect(selected).toEqual([orphan]);
  });

  test("selects every recognized workspace when unscoped", () => {
    const all = [workspace("e2e-ws-mabc"), workspace("e2e-ws-123-sdk-mabc")];

    expect(selectWorkspacesToDelete(all, {}, NOW)).toEqual(all);
  });
});
