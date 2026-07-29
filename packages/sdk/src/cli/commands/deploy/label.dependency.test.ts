import { describe, expect, test } from "vitest";
import { buildMetaRequest, dependedByAppLabelKey, recordedDependencies } from "./label";

const appId = "0191b0f4-1c4e-7d3a-9f2b-8c5a4e6d7b81";

describe("dependedByAppLabelKey", () => {
  test("builds a key within the platform's 63-character limit", () => {
    const key = dependedByAppLabelKey(appId);

    expect(key).toBe(`sdk-depended-by-app-${appId}`);
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
    expect(
      recordedDependencies({
        "sdk-name": "buyer",
        [`sdk-depended-by-app-${appId}`]: "publish-events",
      }),
    ).toEqual([{ appId, reason: "publish-events" }]);
  });

  test("ignores labels that are not dependency records", () => {
    expect(recordedDependencies({ "sdk-name": "buyer", "sdk-version": "v1-0-0" })).toEqual([]);
    expect(recordedDependencies(undefined)).toEqual([]);
  });

  test("round-trips through the labels buildMetaRequest writes", async () => {
    const key = dependedByAppLabelKey(appId)!;
    const request = await buildMetaRequest({
      trn: "trn:v1:workspace:ws:application:buyer",
      appName: "buyer",
      extraLabels: { [key]: "publish-events" },
    });

    expect(recordedDependencies(request.labels)).toEqual([{ appId, reason: "publish-events" }]);
    expect(request.labels?.["sdk-name"]).toBe("buyer");
  });
});
