import { describe, expect, test } from "vitest";
import { createWorkspaceContext, selectionArgs } from "./workspace-context";

const PROFILES = [
  { name: "test", workspaceId: "7390c4cc-914f-4791-89ee-f4a4ab4699fc" },
  { name: "dev-example", workspaceId: "7582c1a4-51c7-483f-a59a-19bfde8659ae" },
];

function context(initial = {}) {
  return createWorkspaceContext({ initial, listProfiles: async () => PROFILES });
}

describe("createWorkspaceContext", () => {
  test("starts with the selection given at startup", () => {
    expect(context({ profile: "test" }).selection()).toEqual({ profile: "test" });
  });

  test("starts empty when nothing was given", () => {
    expect(context().selection()).toEqual({});
  });

  test("selecting a profile records its name and workspace ID", async () => {
    const ctx = context({ workspaceId: "ffffffff-0000-0000-0000-000000000000" });
    await ctx.select("dev-example");
    expect(ctx.selection()).toEqual({
      profile: "dev-example",
      workspaceId: "7582c1a4-51c7-483f-a59a-19bfde8659ae",
    });
  });

  test("selecting null clears the selection", async () => {
    const ctx = context({ profile: "test" });
    await ctx.select(null);
    expect(ctx.selection()).toEqual({});
  });

  test("rejects a profile that is not in the profile list and keeps the current selection", async () => {
    const ctx = context({ profile: "test" });
    await expect(ctx.select("nope")).rejects.toThrow('Profile "nope" not found');
    expect(ctx.selection()).toEqual({ profile: "test" });
  });

  test("describe resolves the workspace ID of a profile given at startup", async () => {
    expect(await context({ profile: "test" }).describe()).toEqual({
      profiles: PROFILES,
      selected: { profile: "test", workspaceId: PROFILES[0]!.workspaceId },
    });
  });

  test("describe keeps a startup workspace ID that has no profile", async () => {
    const workspaceId = "ffffffff-0000-0000-0000-000000000000";
    expect((await context({ workspaceId }).describe()).selected).toEqual({ workspaceId });
  });
});

describe("selectionArgs", () => {
  test("passes the profile and its workspace ID, so an environment workspace ID cannot override the profile", () => {
    expect(selectionArgs({ profile: "test", workspaceId: "w" })).toEqual(["-p", "test", "-w", "w"]);
  });

  test("passes only the workspace ID when no profile is selected", () => {
    expect(selectionArgs({ workspaceId: "w" })).toEqual(["-w", "w"]);
  });

  test("is empty when nothing is selected", () => {
    expect(selectionArgs({})).toEqual([]);
  });
});
