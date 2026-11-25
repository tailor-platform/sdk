import { describe, expect, test } from "vitest";
import { createOwnershipTracker } from "./owned-resource";
import type { DeployOwner } from "./label";

const resource = { resourceType: "pipeline.service", resourceName: "my-service" } as const;
const recorded = { ...resource, resourceLabel: "Resolver namespace" };
const appOwner: DeployOwner = { kind: "application", name: "my-app", id: "id-1" };
const workspaceOwner: DeployOwner = { kind: "workspace" };

describe("createOwnershipTracker", () => {
  describe("ownsDesired", () => {
    test("records nothing for a resource this app owns", () => {
      const ownership = createOwnershipTracker(appOwner);

      expect(ownership.ownsDesired({ "sdk-app-id": "app-id-1" }, resource)).toBe(true);
      expect(ownership.ownsDesired({ "sdk-name": "my-app" }, resource)).toBe(true);
      expect(ownership.result).toEqual({
        conflicts: [],
        unmanaged: [],
        takeovers: [],
        resourceOwners: new Set(),
      });
    });

    test("records a conflict naming the sdk-name of another app's resource", () => {
      const ownership = createOwnershipTracker(appOwner);

      expect(ownership.ownsDesired({ "sdk-name": "other-app" }, resource)).toBe(false);
      expect(
        ownership.ownsDesired({ "sdk-name": "my-app", "sdk-app-id": "app-id-2" }, resource),
      ).toBe(false);
      expect(ownership.result).toEqual({
        conflicts: [
          { ...recorded, currentOwner: "other-app" },
          { ...recorded, currentOwner: "my-app" },
        ],
        unmanaged: [],
        takeovers: [],
        resourceOwners: new Set(),
      });
    });

    test("records an unmanaged resource when it carries no sdk-name", () => {
      const ownership = createOwnershipTracker(appOwner);

      expect(ownership.ownsDesired(undefined, resource)).toBe(false);
      expect(ownership.ownsDesired({ "sdk-name": "" }, resource)).toBe(false);
      expect(ownership.ownsDesired({ "sdk-managed": "workspace" }, resource)).toBe(false);
      expect(ownership.result).toEqual({
        conflicts: [],
        unmanaged: [recorded, recorded, { ...recorded, managedBy: "workspace" }],
        takeovers: [],
        resourceOwners: new Set(),
      });
    });

    test("for the workspace, owns a marked resource and takes over one an application deployed", () => {
      const ownership = createOwnershipTracker(workspaceOwner);

      expect(ownership.ownsDesired({ "sdk-managed": "workspace" }, resource)).toBe(true);
      expect(
        ownership.ownsDesired(
          { "sdk-managed": "workspace", "sdk-name": "shop", "sdk-app-id": "app-id-1" },
          resource,
        ),
      ).toBe(true);
      expect(
        ownership.ownsDesired({ "sdk-name": "shop", "sdk-app-id": "app-id-1" }, resource),
      ).toBe(false);
      expect(ownership.ownsDesired({ "sdk-name": "legacy" }, resource)).toBe(false);
      expect(ownership.ownsDesired({ "sdk-version": "v1-0-0" }, resource)).toBe(false);
      expect(ownership.result).toEqual({
        conflicts: [],
        unmanaged: [recorded],
        takeovers: [
          { ...recorded, action: "update", currentOwner: "shop", currentAppId: "id-1" },
          { ...recorded, action: "update", currentOwner: "legacy" },
        ],
        resourceOwners: new Set(),
      });
    });
  });

  describe("ownsRemaining", () => {
    test("records nothing for a resource this app owns", () => {
      const ownership = createOwnershipTracker({
        kind: "application",
        name: "my-app",
        id: undefined,
      });

      expect(ownership.ownsRemaining({ "sdk-name": "my-app" }, resource)).toBe(true);
      expect(ownership.result.resourceOwners).toEqual(new Set());
    });

    test("records the sdk-name of another app's resource as a resource owner", () => {
      const ownership = createOwnershipTracker(appOwner);

      expect(ownership.ownsRemaining({ "sdk-name": "other-app" }, resource)).toBe(false);
      expect(
        ownership.ownsRemaining({ "sdk-name": "my-app", "sdk-app-id": "app-id-2" }, resource),
      ).toBe(false);
      expect(ownership.result).toEqual({
        conflicts: [],
        unmanaged: [],
        takeovers: [],
        resourceOwners: new Set(["other-app", "my-app"]),
      });
    });

    test("records nothing for a resource that carries no sdk-name", () => {
      const ownership = createOwnershipTracker(appOwner);

      expect(ownership.ownsRemaining(undefined, resource)).toBe(false);
      expect(ownership.ownsRemaining({ "sdk-version": "v1-0-0" }, resource)).toBe(false);
      expect(ownership.ownsRemaining({ "sdk-managed": "workspace" }, resource)).toBe(false);
      expect(ownership.result).toEqual({
        conflicts: [],
        unmanaged: [],
        takeovers: [],
        resourceOwners: new Set(),
      });
    });

    test("for the workspace, deletes a marked resource and one an application deployed with an id", () => {
      const ownership = createOwnershipTracker(workspaceOwner);

      expect(ownership.ownsRemaining({ "sdk-managed": "workspace" }, resource)).toBe(true);
      expect(
        ownership.ownsRemaining({ "sdk-name": "shop", "sdk-app-id": "app-id-1" }, resource),
      ).toBe(true);
      expect(ownership.ownsRemaining({ "sdk-name": "legacy" }, resource)).toBe(false);
      expect(ownership.ownsRemaining(undefined, resource)).toBe(false);
      expect(ownership.result).toEqual({
        conflicts: [],
        unmanaged: [],
        takeovers: [{ ...recorded, action: "delete", currentOwner: "shop", currentAppId: "id-1" }],
        resourceOwners: new Set(),
      });
    });
  });
});
