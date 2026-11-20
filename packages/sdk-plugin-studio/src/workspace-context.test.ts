import { describe, expect, test } from "vitest";
import { createWorkspaceContext, selectionArgs } from "./workspace-context";

const PROFILES = [
  { name: "test", workspaceId: "7390c4cc-914f-4791-89ee-f4a4ab4699fc" },
  { name: "dev-example", workspaceId: "7582c1a4-51c7-483f-a59a-19bfde8659ae" },
];

async function context(profile?: string) {
  const ctx = createWorkspaceContext({
    ...(profile === undefined ? {} : { initialProfile: profile }),
    listProfiles: async () => PROFILES,
  });
  await ctx.restore();
  return ctx;
}

describe("createWorkspaceContext", () => {
  test("starts with the profile given at startup and its workspace ID", async () => {
    expect((await context("test")).selection()).toEqual({
      profile: "test",
      workspaceId: PROFILES[0]!.workspaceId,
    });
  });

  test("starts empty when nothing was given", async () => {
    expect((await context()).selection()).toEqual({});
  });

  test("rejects a startup profile that is not in the profile list", async () => {
    await expect(context("nope")).rejects.toThrow('Profile "nope" not found');
  });

  test("selecting a profile records its name and workspace ID", async () => {
    const ctx = await context("test");
    await ctx.select("dev-example");
    expect(ctx.selection()).toEqual({
      profile: "dev-example",
      workspaceId: "7582c1a4-51c7-483f-a59a-19bfde8659ae",
    });
  });

  test("selecting null clears the selection", async () => {
    const ctx = await context("test");
    await ctx.select(null);
    expect(ctx.selection()).toEqual({});
  });

  test("rejects a profile that is not in the profile list and keeps the current selection", async () => {
    const ctx = await context("test");
    await expect(ctx.select("nope")).rejects.toThrow('Profile "nope" not found');
    expect(ctx.selection().profile).toBe("test");
  });

  test("describe lists the profiles with the current selection", async () => {
    expect(await (await context("test")).describe()).toEqual({
      profiles: PROFILES,
      selected: { profile: "test", workspaceId: PROFILES[0]!.workspaceId },
    });
  });
});

describe("remembering the selection", () => {
  function remembering(saved: string | undefined, initialProfile?: string) {
    const writes: (string | null)[] = [];
    const ctx = createWorkspaceContext({
      ...(initialProfile === undefined ? {} : { initialProfile }),
      listProfiles: async () => PROFILES,
      store: { load: () => saved, save: (profile) => void writes.push(profile) },
    });
    return { ctx, writes };
  }

  test("restores the remembered profile with its workspace ID", async () => {
    const { ctx } = remembering("dev-example");
    await ctx.restore();
    expect(ctx.selection()).toEqual({
      profile: "dev-example",
      workspaceId: "7582c1a4-51c7-483f-a59a-19bfde8659ae",
    });
  });

  test("ignores a remembered profile that no longer exists", async () => {
    const { ctx } = remembering("deleted");
    await ctx.restore();
    expect(ctx.selection()).toEqual({});
  });

  test("keeps the startup selection instead of the remembered one", async () => {
    const { ctx } = remembering("dev-example", "test");
    await ctx.restore();
    expect(ctx.selection().profile).toBe("test");
  });

  test("remembers each selection and the clearing of it", async () => {
    const { ctx, writes } = remembering(undefined);
    await ctx.select("test");
    await ctx.select(null);
    expect(writes).toEqual(["test", null]);
  });

  test("does not remember a rejected profile", async () => {
    const { ctx, writes } = remembering(undefined);
    await expect(ctx.select("nope")).rejects.toThrow("not found");
    expect(writes).toEqual([]);
  });
});

describe("selectionArgs", () => {
  test("passes the profile and its workspace ID, so an environment workspace ID cannot override the profile", () => {
    expect(selectionArgs({ profile: "test", workspaceId: "w" })).toEqual([
      "--profile=test",
      "--workspace-id=w",
    ]);
  });

  test("passes only the workspace ID when no profile is selected", () => {
    expect(selectionArgs({ workspaceId: "w" })).toEqual(["--workspace-id=w"]);
  });

  test("binds a profile name that starts with a hyphen to its option", () => {
    expect(selectionArgs({ profile: "-x" })).toEqual(["--profile=-x"]);
  });

  test("is empty when nothing is selected", () => {
    expect(selectionArgs({})).toEqual([]);
  });
});
