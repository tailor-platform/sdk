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
});

describe("dependencyLabelWrite", () => {
  test("writes a record for every dependent found in the run", () => {
    expect(
      dependencyLabelWrite({
        existingLabels: undefined,
        dependentApps: dependents(buyer),
        runAppIds: new Set([buyer]),
      }),
    ).toEqual({ labels: { [buyerKey]: "publish-events" }, remove: [] });
  });

  test("drops a record for an app that took part and no longer depends", () => {
    expect(
      dependencyLabelWrite({
        existingLabels: { [buyerKey]: "publish-events" },
        dependentApps: dependents(),
        runAppIds: new Set([buyer]),
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
      }),
    ).toEqual({ labels: {}, remove: [] });
  });

  test("rewrites one record while dropping another in the same run", () => {
    expect(
      dependencyLabelWrite({
        existingLabels: { [buyerKey]: "publish-events", [shellKey]: "publish-events" },
        dependentApps: dependents(buyer),
        runAppIds: new Set([buyer, shell]),
      }),
    ).toEqual({ labels: { [buyerKey]: "publish-events" }, remove: [shellKey] });
  });

  test("writes nothing when the run found no dependents and none are recorded", () => {
    expect(
      dependencyLabelWrite({
        existingLabels: { "sdk-name": "buyer" },
        dependentApps: undefined,
        runAppIds: undefined,
      }),
    ).toEqual({ labels: {}, remove: [] });
  });
});
