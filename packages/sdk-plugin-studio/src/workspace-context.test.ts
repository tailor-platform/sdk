import { describe, expect, test } from "vitest";
import { createWorkspaceContext, selectionArgs, selectionEnv } from "./workspace-context";

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

  test("keeps the later selection when an earlier profile lookup finishes last", async () => {
    let release!: () => void;
    const slowLookup = new Promise<void>((resolve) => (release = resolve));
    let first = true;
    const ctx = createWorkspaceContext({
      listProfiles: async () => {
        if (first) {
          first = false;
          await slowLookup;
        }
        return PROFILES;
      },
    });
    let notified = 0;
    ctx.subscribe(() => notified++);

    const earlier = ctx.select("test");
    await ctx.select(null);
    release();
    await earlier;

    expect(ctx.selection()).toEqual({});
    expect(notified).toBe(1);
  });

  test("rejects a profile that is not in the profile list and keeps the current selection", async () => {
    const ctx = await context("test");
    await expect(ctx.select("nope")).rejects.toThrow('Profile "nope" not found');
    expect(ctx.selection().profile).toBe("test");
  });

  test("describe reports the workspace a profile points to now, not the one it pointed to when selected", async () => {
    let profiles = PROFILES;
    const ctx = createWorkspaceContext({
      initialProfile: "test",
      listProfiles: async () => profiles,
    });
    await ctx.restore();
    profiles = [{ name: "test", workspaceId: "moved-workspace" }, PROFILES[1]!];

    expect((await ctx.describe()).selected).toEqual({
      profile: "test",
      workspaceId: "moved-workspace",
    });
  });

  test("describe also moves the shared selection to the workspace the profile points to now, and tells the listeners once", async () => {
    let profiles = PROFILES;
    const ctx = createWorkspaceContext({
      initialProfile: "test",
      listProfiles: async () => profiles,
    });
    await ctx.restore();
    let notified = 0;
    ctx.subscribe(() => notified++);
    profiles = [{ name: "test", workspaceId: "moved-workspace" }, PROFILES[1]!];

    await ctx.describe();
    await ctx.describe();

    expect(ctx.selection().workspaceId).toBe("moved-workspace");
    expect(notified).toBe(1);
  });

  test("describe lists the profiles with the current selection", async () => {
    expect(await (await context("test")).describe()).toEqual({
      profiles: PROFILES,
      selected: { profile: "test", workspaceId: PROFILES[0]!.workspaceId },
    });
  });
});

describe("subscribe", () => {
  test("calls the listener after a profile is selected and after it is cleared", async () => {
    const ctx = await context();
    let calls = 0;
    ctx.subscribe(() => calls++);
    await ctx.select("test");
    await ctx.select(null);
    expect(calls).toBe(2);
  });

  test("stops calling a listener once it unsubscribed", async () => {
    const ctx = await context();
    let calls = 0;
    const unsubscribe = ctx.subscribe(() => calls++);
    unsubscribe();
    await ctx.select("test");
    expect(calls).toBe(0);
  });

  test("keeps the selection and calls the other listeners when one listener throws", async () => {
    const errors: unknown[] = [];
    const ctx = createWorkspaceContext({
      listProfiles: async () => PROFILES,
      onListenerError: (error) => errors.push(error),
    });
    let calls = 0;
    ctx.subscribe(() => {
      throw new Error("tab crashed");
    });
    ctx.subscribe(() => calls++);

    await ctx.select("test");

    expect(ctx.selection().profile).toBe("test");
    expect(calls).toBe(1);
    expect(errors).toEqual([new Error("tab crashed")]);
  });

  test("does not call the listener when selecting an unknown profile fails", async () => {
    const ctx = await context();
    let calls = 0;
    ctx.subscribe(() => calls++);
    await expect(ctx.select("nope")).rejects.toThrow("not found");
    expect(calls).toBe(0);
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
  test("passes only the profile, so the workspace is read from the profile each time it runs", () => {
    expect(selectionArgs({ profile: "test", workspaceId: "w" })).toEqual(["--profile=test"]);
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

describe("selectionEnv", () => {
  const env = { TAILOR_PLATFORM_TOKEN: "startup-user-token", PATH: "/bin" };

  test("leaves out the inherited token while a profile is selected", () => {
    expect(selectionEnv({ profile: "test", workspaceId: "w" }, env)).toEqual({ PATH: "/bin" });
  });

  test("leaves out the platform the startup profile injected, so a profile without its own falls back to the default", () => {
    const injected = {
      TAILOR_PLATFORM_URL: "https://custom.example.com",
      TAILOR_PLATFORM_OAUTH2_CLIENT_ID: "custom-client",
      PATH: "/bin",
    };
    expect(selectionEnv({ profile: "test" }, injected)).toEqual({ PATH: "/bin" });
  });

  test("leaves out the startup workspace ID, which beats the workspace the selected profile points to", () => {
    const injected = { TAILOR_PLATFORM_WORKSPACE_ID: "startup-workspace", PATH: "/bin" };
    expect(selectionEnv({ profile: "test" }, injected)).toEqual({ PATH: "/bin" });
  });

  test("keeps the token when no profile is selected, so a token-only setup still works", () => {
    expect(selectionEnv({}, env)).toEqual(env);
  });

  test("does not change the environment it was given", () => {
    selectionEnv({ profile: "test" }, env);
    expect(env.TAILOR_PLATFORM_TOKEN).toBe("startup-user-token");
  });
});
