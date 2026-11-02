import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, test } from "vitest";
import {
  assertNoMigrationInProgress,
  fetchRemoteMigrationState,
  isStaleMigrationInProgress,
  matchesLocalMigrationHistory,
  type RemoteMigrationState,
} from "./remote-state";
import type { OperatorClient } from "#/cli/shared/client";
import type { MigrationInProgress } from "./types";

function clientWithLabels(labels: Record<string, string> | undefined): OperatorClient {
  return {
    getMetadata: async () => {
      if (!labels) throw new ConnectError("not found", Code.NotFound);
      return { metadata: { labels } };
    },
  } as unknown as OperatorClient;
}

describe("fetchRemoteMigrationState", () => {
  test("reports no migration in progress when the labels are absent", async () => {
    const state = await fetchRemoteMigrationState(
      clientWithLabels({ "sdk-migration": "m0002" }),
      "trn",
    );
    expect(state).toMatchObject({ number: 2, inProgress: null, inProgressInvalid: false });
  });

  test("reads the in-progress migration and its execution", async () => {
    const state = await fetchRemoteMigrationState(
      clientWithLabels({
        "sdk-migration": "m0002",
        "sdk-migration-in-progress": "m0003",
        "sdk-migration-execution": "e0190f3a27c1e7d4b9a6f1b2c3d4e5f60",
      }),
      "trn",
    );
    expect(state.inProgress).toEqual({
      number: 3,
      executionId: "0190f3a2-7c1e-7d4b-9a6f-1b2c3d4e5f60",
      kind: "steps",
    });
    expect(state.inProgressInvalid).toBe(false);
  });

  test("reads an in-progress migration whose execution was never recorded", async () => {
    const state = await fetchRemoteMigrationState(
      clientWithLabels({ "sdk-migration": "m0002", "sdk-migration-in-progress": "m0003" }),
      "trn",
    );
    expect(state.inProgress).toEqual({ number: 3, kind: "steps" });
  });

  test("reads an in-progress record of a `main` run", async () => {
    const state = await fetchRemoteMigrationState(
      clientWithLabels({
        "sdk-migration": "m0002",
        "sdk-migration-in-progress": "m0003-main",
        "sdk-migration-execution": "e0190f3a27c1e7d4b9a6f1b2c3d4e5f60",
      }),
      "trn",
    );
    expect(state.inProgress).toEqual({
      number: 3,
      executionId: "0190f3a2-7c1e-7d4b-9a6f-1b2c3d4e5f60",
      kind: "main",
    });
  });

  test.each([
    [{ "sdk-migration-in-progress": "three" }],
    [{ "sdk-migration-in-progress": "m0003-steps" }],
    [{ "sdk-migration-in-progress": "m0003", "sdk-migration-execution": "e123" }],
    [{ "sdk-migration-execution": "e0190f3a27c1e7d4b9a6f1b2c3d4e5f60" }],
  ])("flags unreadable in-progress labels %o", async (labels) => {
    const state = await fetchRemoteMigrationState(
      clientWithLabels({ "sdk-migration": "m0002", ...labels }),
      "trn",
    );
    expect(state).toMatchObject({ inProgress: null, inProgressInvalid: true });
  });

  test.each([
    ["m0002", 2],
    ["two", null],
  ])("reads the maintenance-mode checkpoint %s", async (label, checkpoint) => {
    const state = await fetchRemoteMigrationState(
      clientWithLabels({ "sdk-migration": "m0002", "sdk-maintenance-mode": label }),
      "trn",
    );
    expect(state.maintenanceModeCheckpoint).toBe(checkpoint);
  });

  test.each([
    ["m0002", 2],
    ["two", null],
  ])("reads the checkpoint of unfinished table deletions %s", async (label, checkpoint) => {
    const state = await fetchRemoteMigrationState(
      clientWithLabels({ "sdk-migration": "m0002", "sdk-migration-cleanup": label }),
      "trn",
    );
    expect(state.cleanupCheckpoint).toBe(checkpoint);
  });

  test("reports nothing in progress for a namespace that was never deployed", async () => {
    const state = await fetchRemoteMigrationState(clientWithLabels(undefined), "trn");
    expect(state).toMatchObject({
      metadataExists: false,
      inProgress: null,
      inProgressInvalid: false,
      maintenanceModeCheckpoint: null,
      cleanupCheckpoint: null,
    });
  });
});

describe("assertNoMigrationInProgress", () => {
  const state = (inProgress: MigrationInProgress, number = 2): RemoteMigrationState => ({
    metadataExists: true,
    number,
    historyId: null,
    historyIdInvalid: false,
    inProgress,
    inProgressInvalid: false,
    maintenanceModeCheckpoint: null,
    cleanupCheckpoint: null,
  });

  test("names a deploy and both ways to settle a migration whose steps partly committed", () => {
    expect(() =>
      assertNoMigrationInProgress(state({ number: 3, kind: "steps" }), "tailordb", {}),
    ).toThrow(
      expect.objectContaining({
        code: "MIGRATION_IN_PROGRESS",
        suggestion: expect.toSatisfy(
          (suggestion: string) =>
            suggestion.includes("`tailor deploy`") &&
            suggestion.includes(
              "`tailor tailordb migration resolve --rollback --namespace tailordb`",
            ) &&
            suggestion.includes(
              "`tailor tailordb migration resolve --complete --namespace tailordb`",
            ),
        ),
      }),
    );
  });

  test("names both ways to settle a `main` run whose outcome is not settled, keeping the run's config, workspace, and profile", () => {
    expect(() =>
      assertNoMigrationInProgress(state({ number: 3, kind: "main" }), "tailordb", {
        configPath: "custom.config.ts",
        contextArgs: ["--workspace-id=ws-1", "--profile=staging"],
      }),
    ).toThrow(
      expect.objectContaining({
        code: "MIGRATION_IN_PROGRESS",
        message: expect.stringContaining("tailordb/0003"),
        suggestion: expect.toSatisfy(
          (suggestion: string) =>
            !suggestion.includes("`tailor deploy") &&
            suggestion.includes(
              "`tailor tailordb migration resolve --rollback --namespace tailordb --config=custom.config.ts --workspace-id=ws-1 --profile=staging`",
            ) &&
            suggestion.includes(
              "`tailor tailordb migration resolve --complete --namespace tailordb --config=custom.config.ts --workspace-id=ws-1 --profile=staging`",
            ),
        ),
      }),
    );
  });

  test("does not name migration resolve for a record the checkpoint already covers", () => {
    expect(() =>
      assertNoMigrationInProgress(state({ number: 3, kind: "steps" }, 3), "tailordb", {}),
    ).toThrow(
      expect.objectContaining({
        code: "MIGRATION_IN_PROGRESS",
        suggestion: expect.not.stringContaining("migration resolve"),
      }),
    );
  });
});

describe("isStaleMigrationInProgress", () => {
  const state = (number: number | null, inProgress: number | null): RemoteMigrationState => ({
    metadataExists: true,
    number,
    historyId: null,
    historyIdInvalid: false,
    inProgress: inProgress === null ? null : { number: inProgress, kind: "steps" },
    inProgressInvalid: false,
    maintenanceModeCheckpoint: null,
    cleanupCheckpoint: null,
  });

  test.each([
    ["the checkpoint already covers the migration", state(3, 3), true],
    ["the checkpoint moved past the migration", state(4, 3), true],
    ["the migration is the next one", state(2, 3), false],
    ["no checkpoint was recorded", state(null, 3), false],
    ["nothing is in progress", state(3, null), false],
  ])("%s", (_label, input, expected) => {
    expect(isStaleMigrationInProgress(input)).toBe(expected);
  });
});

describe("matchesLocalMigrationHistory", () => {
  const state = (
    number: number | null,
    historyId: string | null,
    historyIdInvalid = false,
  ): RemoteMigrationState => ({
    metadataExists: true,
    number,
    historyId,
    historyIdInvalid,
    inProgress: null,
    inProgressInvalid: false,
    maintenanceModeCheckpoint: null,
    cleanupCheckpoint: null,
  });

  test.each([
    ["the namespace records no checkpoint or history yet", state(null, null), "hlocal", true],
    ["both histories are markerless", state(2, null), null, true],
    ["both record the same history", state(2, "hlocal"), "hlocal", true],
    [
      "only a history ID is recorded, and it is the local one",
      state(null, "hlocal"),
      "hlocal",
      true,
    ],
    ["the namespace records another history", state(2, "hother"), "hlocal", false],
    [
      "the namespace records a history the markerless local one lacks",
      state(2, "hother"),
      null,
      false,
    ],
    ["a markerless checkpoint meets a re-baselined local history", state(2, null), "hlocal", false],
    [
      "only a history ID is recorded, and it is another one",
      state(null, "hother"),
      "hlocal",
      false,
    ],
    ["the history label cannot be read", state(2, null, true), null, false],
    [
      "the history label cannot be read and no checkpoint is set",
      state(null, null, true),
      null,
      false,
    ],
  ])("%s", (_label, input, localHistoryId, expected) => {
    expect(matchesLocalMigrationHistory(input, localHistoryId)).toBe(expected);
  });
});
