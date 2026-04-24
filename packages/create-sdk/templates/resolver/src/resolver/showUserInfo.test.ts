import { unauthenticatedTailorUser } from "@tailor-platform/sdk/test";
import { describe, expect, test } from "vitest";
import resolver from "./showUserInfo";

describe("showUserInfo resolver", () => {
  test("returns default user info", async () => {
    const result = await resolver.body({
      input: undefined as never,
      user: unauthenticatedTailorUser,
      invoker: null,
      env: { appName: "Resolver Template", version: 1 },
    });
    expect(result).toEqual({
      userId: unauthenticatedTailorUser.id,
      userType: unauthenticatedTailorUser.type,
      workspaceId: unauthenticatedTailorUser.workspaceId,
    });
  });

  test("returns custom user info", async () => {
    const customUser = {
      ...unauthenticatedTailorUser,
      id: "user-123",
      type: "machine_user" as const,
      workspaceId: "ws-456",
    };
    const result = await resolver.body({
      input: undefined as never,
      user: customUser,
      invoker: null,
      env: { appName: "Resolver Template", version: 1 },
    });
    expect(result).toEqual({
      userId: "user-123",
      userType: "machine_user",
      workspaceId: "ws-456",
    });
  });
});
