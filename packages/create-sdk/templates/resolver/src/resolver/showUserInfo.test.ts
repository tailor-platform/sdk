import type { TailorPrincipal } from "@tailor-platform/sdk";
import { describe, expect, test } from "vitest";
import resolver from "./showUserInfo";

describe("showUserInfo resolver", () => {
  test("returns default user info", async () => {
    const result = await resolver.body({
      input: undefined as never,
      caller: null,
      invoker: null,
      env: { appName: "Resolver Template", version: 1 },
    });
    expect(result).toEqual({
      userId: "anonymous",
      userType: "anonymous",
      workspaceId: "",
    });
  });

  test("returns custom user info", async () => {
    const customCaller = {
      id: "123e4567-e89b-12d3-a456-426614174000",
      type: "machine_user" as const,
      workspaceId: "ws-456",
      attributes: { role: "admin" },
      attributeList: [],
    } satisfies TailorPrincipal;
    const result = await resolver.body({
      input: undefined as never,
      caller: customCaller,
      invoker: customCaller,
      env: { appName: "Resolver Template", version: 1 },
    });
    expect(result).toEqual({
      userId: "123e4567-e89b-12d3-a456-426614174000",
      userType: "machine_user",
      workspaceId: "ws-456",
    });
  });
});
