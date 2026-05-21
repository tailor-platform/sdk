import { describe, expect, test } from "vitest";
import { hasMatchingSdkVersion, isOwnedByApp } from "./label";

describe("isOwnedByApp", () => {
  test("returns false when labels are undefined", () => {
    expect(isOwnedByApp(undefined, "my-app", "id-1")).toBe(false);
  });

  test("returns true when sdk-app-id matches the provided id with app- prefix applied", () => {
    const labels = { "sdk-app-id": "app-id-1", "sdk-name": "different-name" };
    expect(isOwnedByApp(labels, "my-app", "id-1")).toBe(true);
  });

  test("returns false when sdk-app-id mismatches even if name matches", () => {
    const labels = { "sdk-app-id": "app-id-2", "sdk-name": "my-app" };
    expect(isOwnedByApp(labels, "my-app", "id-1")).toBe(false);
  });

  test("falls back to sdk-name when no app id is provided", () => {
    const labels = { "sdk-name": "my-app" };
    expect(isOwnedByApp(labels, "my-app", undefined)).toBe(true);
  });

  test("falls back to sdk-name when label has no sdk-app-id", () => {
    const labels = { "sdk-name": "my-app" };
    expect(isOwnedByApp(labels, "my-app", "id-1")).toBe(true);
  });

  test("returns false when neither id nor name matches", () => {
    const labels = { "sdk-name": "other-app", "sdk-app-id": "app-id-2" };
    expect(isOwnedByApp(labels, "my-app", "id-1")).toBe(false);
  });
});

describe("hasMatchingSdkVersion", () => {
  test("returns true when both labels carry the same sdk-version", () => {
    expect(hasMatchingSdkVersion({ "sdk-version": "v1-0-0" }, { "sdk-version": "v1-0-0" })).toBe(
      true,
    );
  });

  test("returns false when sdk-version differs", () => {
    expect(hasMatchingSdkVersion({ "sdk-version": "v1-0-0" }, { "sdk-version": "v1-1-0" })).toBe(
      false,
    );
  });

  test("returns false when one side is missing the label", () => {
    expect(hasMatchingSdkVersion(undefined, { "sdk-version": "v1-0-0" })).toBe(false);
    expect(hasMatchingSdkVersion({ "sdk-version": "v1-0-0" }, undefined)).toBe(false);
  });
});
