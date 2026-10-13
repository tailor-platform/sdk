import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, test } from "vitest";
import {
  fetchRemoteMigrationState,
  isStaleMigrationInProgress,
  type RemoteMigrationState,
} from "./remote-state";
import type { OperatorClient } from "#/cli/shared/client";

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
    });
    expect(state.inProgressInvalid).toBe(false);
  });

  test("reads an in-progress migration whose execution was never recorded", async () => {
    const state = await fetchRemoteMigrationState(
      clientWithLabels({ "sdk-migration": "m0002", "sdk-migration-in-progress": "m0003" }),
      "trn",
    );
    expect(state.inProgress).toEqual({ number: 3 });
  });

  test.each([
    [{ "sdk-migration-in-progress": "three" }],
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

  test("reports nothing in progress for a namespace that was never deployed", async () => {
    const state = await fetchRemoteMigrationState(clientWithLabels(undefined), "trn");
    expect(state).toMatchObject({
      metadataExists: false,
      inProgress: null,
      inProgressInvalid: false,
      maintenanceModeCheckpoint: null,
    });
  });
});

describe("isStaleMigrationInProgress", () => {
  const state = (number: number | null, inProgress: number | null): RemoteMigrationState => ({
    metadataExists: true,
    number,
    historyId: null,
    historyIdInvalid: false,
    inProgress: inProgress === null ? null : { number: inProgress },
    inProgressInvalid: false,
    maintenanceModeCheckpoint: null,
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
