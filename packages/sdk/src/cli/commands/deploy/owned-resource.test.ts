import { describe, expect, test } from "vitest";
import { createOwnershipTracker } from "./owned-resource";

const resource = {
  resourceType: "executor",
  resourceLabel: "Executor",
  resourceName: "my-executor",
} as const;

describe("createOwnershipTracker", () => {
  describe("ownsDesired", () => {
    test("records nothing for a resource this app owns", () => {
      const ownership = createOwnershipTracker("my-app", "id-1");

      expect(ownership.ownsDesired({ "sdk-app-id": "app-id-1" }, resource)).toBe(true);
      expect(ownership.ownsDesired({ "sdk-name": "my-app" }, resource)).toBe(true);
      expect(ownership.result).toEqual({
        conflicts: [],
        unmanaged: [],
        resourceOwners: new Set(),
      });
    });

    test("records a conflict naming the sdk-name of another app's resource", () => {
      const ownership = createOwnershipTracker("my-app", "id-1");

      expect(ownership.ownsDesired({ "sdk-name": "other-app" }, resource)).toBe(false);
      expect(
        ownership.ownsDesired({ "sdk-name": "my-app", "sdk-app-id": "app-id-2" }, resource),
      ).toBe(false);
      expect(ownership.result).toEqual({
        conflicts: [
          { ...resource, currentOwner: "other-app" },
          { ...resource, currentOwner: "my-app" },
        ],
        unmanaged: [],
        resourceOwners: new Set(),
      });
    });

    test("records an unmanaged resource when it carries no sdk-name", () => {
      const ownership = createOwnershipTracker("my-app", "id-1");

      expect(ownership.ownsDesired(undefined, resource)).toBe(false);
      expect(ownership.ownsDesired({ "sdk-name": "" }, resource)).toBe(false);
      expect(ownership.result).toEqual({
        conflicts: [],
        unmanaged: [resource, resource],
        resourceOwners: new Set(),
      });
    });
  });

  describe("ownsRemaining", () => {
    test("records nothing for a resource this app owns", () => {
      const ownership = createOwnershipTracker("my-app", undefined);

      expect(ownership.ownsRemaining({ "sdk-name": "my-app" })).toBe(true);
      expect(ownership.result.resourceOwners).toEqual(new Set());
    });

    test("records the sdk-name of another app's resource as a resource owner", () => {
      const ownership = createOwnershipTracker("my-app", "id-1");

      expect(ownership.ownsRemaining({ "sdk-name": "other-app" })).toBe(false);
      expect(ownership.ownsRemaining({ "sdk-name": "my-app", "sdk-app-id": "app-id-2" })).toBe(
        false,
      );
      expect(ownership.result).toEqual({
        conflicts: [],
        unmanaged: [],
        resourceOwners: new Set(["other-app", "my-app"]),
      });
    });

    test("records nothing for a resource that carries no sdk-name", () => {
      const ownership = createOwnershipTracker("my-app", "id-1");

      expect(ownership.ownsRemaining(undefined)).toBe(false);
      expect(ownership.ownsRemaining({ "sdk-version": "v1-0-0" })).toBe(false);
      expect(ownership.result).toEqual({
        conflicts: [],
        unmanaged: [],
        resourceOwners: new Set(),
      });
    });
  });
});
