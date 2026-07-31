import { describe, expect, test } from "vitest";
import {
  dependedByAppLabelKey,
  dependencyLabelWrite,
  recordedDependencies,
  type DeployDependencyReason,
} from "./label";

const buyer = "0191b0f4-1c4e-7d3a-9f2b-8c5a4e6d7b81";
const shell = "0191b0f4-1c4e-7d3a-9f2b-8c5a4e6d7b82";
const buyerKey = `sdk-depended-by-app-${buyer}`;
const shellKey = `sdk-depended-by-app-${shell}`;

function dependents(...appIds: string[]): ReadonlyMap<string, DeployDependencyReason> {
  return new Map(appIds.map((appId) => [appId, "publish-events" as const]));
}

describe("dependedByAppLabelKey", () => {
  test("builds a key within the platform's 63-character limit", () => {
    const key = dependedByAppLabelKey(buyer);

    expect(key).toBe(buyerKey);
    expect(key!.length).toBeLessThanOrEqual(63);
    expect(key).toMatch(/^[a-z][a-z0-9_-]{0,62}$/);
  });

  test.each([["APP-0191B0F4-1C4E-7D3A-9F2B-8C5A4E6D7B81"], ["not-a-uuid"], [""]])(
    "refuses an id that cannot form a valid key: %j",
    (invalid) => {
      expect(dependedByAppLabelKey(invalid)).toBeUndefined();
    },
  );
});

describe("recordedDependencies", () => {
  test("reads the dependent app id and reason back", () => {
    expect(recordedDependencies({ "sdk-name": "buyer", [buyerKey]: "publish-events" })).toEqual([
      { appId: buyer, reason: "publish-events" },
    ]);
  });

  test("sorts by label key so the order does not follow how the labels were read", () => {
    expect(
      recordedDependencies({ [shellKey]: "publish-events", [buyerKey]: "publish-events" }).map(
        (dependency) => dependency.appId,
      ),
    ).toEqual([buyer, shell]);
  });

  test("ignores labels that are not dependency records", () => {
    expect(recordedDependencies({ "sdk-name": "buyer", "sdk-version": "v1-0-0" })).toEqual([]);
    expect(recordedDependencies(undefined)).toEqual([]);
  });

  test("ignores a record whose id this SDK could not have written", () => {
    // Reading one back would prompt about a dependent that no config can supply,
    // leaving the deploy with a question the user cannot answer.
    expect(
      recordedDependencies({
        "sdk-depended-by-app-not-a-uuid": "publish-events",
        [buyerKey]: "publish-events",
      }),
    ).toEqual([{ appId: buyer, reason: "publish-events" }]);
  });
});

describe("dependencyLabelWrite", () => {
  test("writes a record for every dependent found in the run", () => {
    expect(
      dependencyLabelWrite({
        existingLabels: undefined,
        dependentApps: dependents(buyer),
        runAppIds: new Set([buyer]),
        pinned: false,
      }),
    ).toEqual({ labels: { [buyerKey]: "publish-events" }, remove: [] });
  });

  test("drops a record for an app that took part and no longer depends", () => {
    expect(
      dependencyLabelWrite({
        existingLabels: { [buyerKey]: "publish-events" },
        dependentApps: dependents(),
        runAppIds: new Set([buyer]),
        pinned: false,
      }),
    ).toEqual({ labels: {}, remove: [buyerKey] });
  });

  test("leaves a record for an app outside the run in neither list", () => {
    // Absent from both, so the write-time merge keeps it — it is the only signal
    // that this partial deploy is about to turn publishing off.
    expect(
      dependencyLabelWrite({
        existingLabels: { [buyerKey]: "publish-events" },
        dependentApps: dependents(),
        runAppIds: new Set([shell]),
        pinned: false,
      }),
    ).toEqual({ labels: {}, remove: [] });
  });

  test("rewrites one record while dropping another in the same run", () => {
    expect(
      dependencyLabelWrite({
        existingLabels: { [buyerKey]: "publish-events", [shellKey]: "publish-events" },
        dependentApps: dependents(buyer),
        runAppIds: new Set([buyer, shell]),
        pinned: false,
      }),
    ).toEqual({ labels: { [buyerKey]: "publish-events" }, remove: [shellKey] });
  });

  test("reports a dependent whose id cannot be recorded instead of skipping it", () => {
    // Skipping it would leave the dependency unrecorded, so the next deploy of the
    // owner alone would turn publishing off without asking — the failure this
    // whole mechanism exists to prevent.
    expect(() =>
      dependencyLabelWrite({
        existingLabels: undefined,
        dependentApps: new Map([["MY-APP-ID", "publish-events" as const]]),
        runAppIds: new Set(["MY-APP-ID"]),
        pinned: false,
      }),
    ).toThrow(/Application id "MY-APP-ID" cannot be recorded/);
  });

  test("writes nothing when the run found no dependents and none are recorded", () => {
    expect(
      dependencyLabelWrite({
        existingLabels: { "sdk-name": "buyer" },
        dependentApps: undefined,
        runAppIds: undefined,
        pinned: false,
      }),
    ).toEqual({ labels: {}, remove: [] });
  });
});

describe("dependencyLabelWrite and a declared publishEvents", () => {
  test("drops every record, including one for an app outside the run", () => {
    // The owner cannot clear such a record on its own — clearing needs the
    // dependent to take part — so leaving it would prompt on every solo deploy
    // about a change a declared value cannot undergo.
    expect(
      dependencyLabelWrite({
        existingLabels: { [buyerKey]: "publish-events", [shellKey]: "publish-events" },
        dependentApps: undefined,
        runAppIds: new Set([buyer]),
        pinned: true,
      }),
    ).toEqual({ labels: {}, remove: [buyerKey, shellKey] });
  });

  test("writes no record even while this run still sees a subscriber", () => {
    expect(
      dependencyLabelWrite({
        existingLabels: undefined,
        dependentApps: dependents(buyer),
        runAppIds: new Set([buyer]),
        pinned: true,
      }),
    ).toEqual({ labels: {}, remove: [] });
  });
});
