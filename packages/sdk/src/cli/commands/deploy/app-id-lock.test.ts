import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { aroundEach, describe, expect, test, vi } from "vitest";
import {
  appIdLockKey,
  appIdPlanModeForDeploy,
  findAppIdLock,
  parseAppIds,
  planAppIds,
  readAppIdLock,
  resolveLockedAppIds,
  TAILOR_LOCK_FILENAME,
  TAILOR_LOCK_VERSION,
  writeAppIds,
  type AppIdLock,
} from "./app-id-lock";

const env = vi.hoisted(() => ({ isCI: false, canPrompt: true }));

vi.mock("std-env", () => ({
  get isCI() {
    return env.isCI;
  },
}));

vi.mock("#/cli/shared/prompt", () => ({
  canPrompt: () => env.canPrompt,
  prompt: { confirm: vi.fn() },
}));

vi.mock("#/cli/shared/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), log: vi.fn() },
}));

import { logger } from "#/cli/shared/logger";
import { prompt } from "#/cli/shared/prompt";

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("app-id-lock", () => {
  let root: string;

  aroundEach(async (runTest) => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "app-id-lock-"));
    env.isCI = false;
    env.canPrompt = true;
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    await runTest();
    fs.rmSync(root, { recursive: true, force: true });
  });

  function writeLock(contents: unknown, dir = root): void {
    fs.mkdirSync(path.join(dir, ".github"), { recursive: true });
    const raw = typeof contents === "string" ? contents : `${JSON.stringify(contents, null, 2)}\n`;
    fs.writeFileSync(path.join(dir, TAILOR_LOCK_FILENAME), raw, "utf-8");
  }

  function readRawLock(): Record<string, unknown> {
    return JSON.parse(fs.readFileSync(path.join(root, TAILOR_LOCK_FILENAME), "utf-8"));
  }

  function writeConfig(relPath: string, body = `export default defineConfig({ name: "app" });\n`) {
    const abs = path.join(root, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body, "utf-8");
    return abs;
  }

  const lockWith = (appIds: Record<string, string>): AppIdLock => ({ root, appIds });

  describe("parseAppIds", () => {
    test("treats an absent section as empty", () => {
      expect(parseAppIds(undefined)).toEqual({});
    });

    test("accepts repository-relative keys with UUID values", () => {
      expect(parseAppIds({ "apps/a/tailor.config.ts": ID_A, "tailor.config.ts": ID_B })).toEqual({
        "apps/a/tailor.config.ts": ID_A,
        "tailor.config.ts": ID_B,
      });
    });

    test.each([
      { name: "a non-object section", value: [ID_A], error: /invalid 'appIds' section/ },
      {
        name: "an absolute key",
        value: { "/abs/tailor.config.ts": ID_A },
        error: /repository-relative/,
      },
      {
        name: "a traversing key",
        value: { "../tailor.config.ts": ID_A },
        error: /repository-relative/,
      },
      {
        name: "a backslash key",
        value: { "apps\\a\\tailor.config.ts": ID_A },
        error: /repository-relative/,
      },
      { name: "a non-UUID value", value: { "tailor.config.ts": "app-1" }, error: /must be a UUID/ },
      {
        name: "two keys sharing one id",
        value: { "a/tailor.config.ts": ID_A, "b/tailor.config.ts": ID_A.toUpperCase() },
        error: /same app id/,
      },
    ])("rejects $name", ({ value, error }) => {
      expect(() => parseAppIds(value)).toThrow(error);
    });
  });

  describe("readAppIdLock / findAppIdLock", () => {
    test("returns null when the repository has no lock", () => {
      const configPath = writeConfig("apps/a/tailor.config.ts");
      expect(readAppIdLock(root)).toBeNull();
      expect(findAppIdLock(configPath)).toBeNull();
    });

    test("finds the lock in an ancestor of the config directory", () => {
      writeLock({ version: 2, targets: [], appIds: { "apps/a/tailor.config.ts": ID_A } });
      const configPath = writeConfig("apps/a/tailor.config.ts");
      expect(findAppIdLock(configPath)).toEqual({
        root,
        appIds: { "apps/a/tailor.config.ts": ID_A },
      });
    });

    test("reads a version 1 lock as having no app ids", () => {
      writeLock({ version: 1, targets: [] });
      expect(readAppIdLock(root)).toEqual({ root, appIds: {} });
    });

    test.each([
      { name: "invalid JSON", contents: "{ not json", error: /not valid JSON/ },
      { name: "a missing version", contents: { targets: [] }, error: /no valid 'version'/ },
      {
        name: "a newer version",
        contents: { version: TAILOR_LOCK_VERSION + 1, targets: [] },
        error: /newer SDK/,
      },
      {
        name: "an invalid appIds section",
        contents: { version: 2, targets: [], appIds: { "tailor.config.ts": "nope" } },
        error: /must be a UUID/,
      },
    ])("throws on $name instead of recreating the lock", ({ contents, error }) => {
      writeLock(contents);
      expect(() => readAppIdLock(root)).toThrow(error);
    });

    test("refuses a lock reached through a symbolic link", () => {
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), "app-id-lock-outside-"));
      try {
        writeLock({ version: 2, targets: [] }, outside);
        fs.mkdirSync(path.join(root, ".github"));
        fs.symlinkSync(
          path.join(outside, TAILOR_LOCK_FILENAME),
          path.join(root, TAILOR_LOCK_FILENAME),
        );
        expect(() => readAppIdLock(root)).toThrow(/symbolic link/);
      } finally {
        fs.rmSync(outside, { recursive: true, force: true });
      }
    });
  });

  describe("appIdLockKey", () => {
    test("is the posix path relative to the lock root", () => {
      expect(appIdLockKey(root, path.join(root, "apps", "a", "tailor.config.ts"))).toBe(
        "apps/a/tailor.config.ts",
      );
    });

    test("rejects a config outside the lock root", () => {
      expect(() => appIdLockKey(root, path.join(path.dirname(root), "tailor.config.ts"))).toThrow(
        /outside the repository/,
      );
    });
  });

  describe("planAppIds", () => {
    test("uses the recorded id when the config has none", async () => {
      const configPath = writeConfig("tailor.config.ts");
      const plan = await planAppIds({
        lock: lockWith({ "tailor.config.ts": ID_A }),
        entries: [{ configPath, configId: undefined }],
        mode: "require",
      });
      expect(plan.changed).toBe(false);
      expect(plan.entries).toEqual([
        { configPath, key: "tailor.config.ts", id: ID_A, source: "lock", removeConfigId: false },
      ]);
    });

    test("schedules removal of a config id that matches its lock entry in write mode", async () => {
      const configPath = writeConfig("tailor.config.ts");
      const plan = await planAppIds({
        lock: lockWith({ "tailor.config.ts": ID_A }),
        entries: [{ configPath, configId: ID_A }],
        mode: "write",
      });
      expect(plan.changed).toBe(false);
      expect(plan.entries[0]).toMatchObject({ id: ID_A, source: "lock", removeConfigId: true });
      expect(logger.warn).not.toHaveBeenCalled();
    });

    test("only warns about a matching config id outside write mode", async () => {
      const configPath = writeConfig("tailor.config.ts");
      const plan = await planAppIds({
        lock: lockWith({ "tailor.config.ts": ID_A }),
        entries: [{ configPath, configId: ID_A }],
        mode: "read",
      });
      expect(plan.entries[0]).toMatchObject({ id: ID_A, removeConfigId: false });
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("still carries an 'id'"));
    });

    test("stops when the config id disagrees with the lock entry", async () => {
      const configPath = writeConfig("tailor.config.ts");
      await expect(
        planAppIds({
          lock: lockWith({ "tailor.config.ts": ID_A }),
          entries: [{ configPath, configId: ID_B }],
          mode: "write",
        }),
      ).rejects.toThrow(new RegExp(`records app id "${ID_A}".*config's 'id' is "${ID_B}"`));
    });

    test("adopts an unrecorded config id in write mode", async () => {
      const configPath = writeConfig("apps/a/tailor.config.ts");
      const plan = await planAppIds({
        lock: lockWith({ "tailor.config.ts": ID_B }),
        entries: [{ configPath, configId: ID_A }],
        mode: "write",
      });
      expect(plan.changed).toBe(true);
      expect(plan.appIds).toEqual({ "tailor.config.ts": ID_B, "apps/a/tailor.config.ts": ID_A });
      expect(plan.entries[0]).toMatchObject({ id: ID_A, source: "config", removeConfigId: true });
    });

    test.each(["read", "require"] as const)(
      "uses an unrecorded config id provisionally in %s mode",
      async (mode) => {
        const configPath = writeConfig("tailor.config.ts");
        const plan = await planAppIds({
          lock: lockWith({}),
          entries: [{ configPath, configId: ID_A }],
          mode,
        });
        expect(plan.changed).toBe(false);
        expect(plan.appIds).toEqual({});
        expect(plan.entries[0]).toMatchObject({
          id: ID_A,
          source: "config",
          removeConfigId: false,
        });
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("not yet recorded"));
      },
    );

    test("rejects a config id that another config already owns", async () => {
      writeConfig("apps/original/tailor.config.ts");
      const configPath = writeConfig("apps/copy/tailor.config.ts");
      await expect(
        planAppIds({
          lock: lockWith({ "apps/original/tailor.config.ts": ID_A }),
          entries: [{ configPath, configId: ID_A }],
          mode: "write",
        }),
      ).rejects.toThrow(/already recorded for apps\/original\/tailor.config.ts/);
    });

    test.each(["read", "require"] as const)(
      "rejects two configs carrying the same unrecorded id in %s mode",
      async (mode) => {
        const first = writeConfig("apps/a/tailor.config.ts");
        const second = writeConfig("apps/b/tailor.config.ts");
        await expect(
          planAppIds({
            lock: lockWith({}),
            entries: [
              { configPath: first, configId: ID_A },
              { configPath: second, configId: ID_A.toUpperCase() },
            ],
            mode,
          }),
        ).rejects.toThrow(/already recorded for apps\/a\/tailor.config.ts/);
      },
    );

    test("re-keys an orphaned entry whose id the config still carries", async () => {
      const configPath = writeConfig("apps/new/tailor.config.ts");
      const plan = await planAppIds({
        lock: lockWith({ "apps/old/tailor.config.ts": ID_A }),
        entries: [{ configPath, configId: ID_A }],
        mode: "write",
      });
      expect(plan.appIds).toEqual({ "apps/new/tailor.config.ts": ID_A });
      expect(plan.entries[0]).toMatchObject({ id: ID_A, source: "config", removeConfigId: true });
      expect(prompt.confirm).not.toHaveBeenCalled();
    });

    test("uses the config id of a moved app provisionally outside write mode", async () => {
      const configPath = writeConfig("apps/new/tailor.config.ts");
      const plan = await planAppIds({
        lock: lockWith({ "apps/old/tailor.config.ts": ID_A }),
        entries: [{ configPath, configId: ID_A }],
        mode: "require",
      });
      expect(plan.changed).toBe(false);
      expect(plan.appIds).toEqual({ "apps/old/tailor.config.ts": ID_A });
      expect(plan.entries[0]).toMatchObject({ id: ID_A, source: "config" });
    });

    test("gives the same config listed twice one generated id", async () => {
      const configPath = writeConfig("tailor.config.ts");
      const plan = await planAppIds({
        lock: lockWith({}),
        entries: [
          { configPath, configId: undefined },
          { configPath, configId: undefined },
        ],
        mode: "write",
      });
      expect(Object.keys(plan.appIds)).toEqual(["tailor.config.ts"]);
      expect(plan.entries[0]?.id).toBe(plan.appIds["tailor.config.ts"]);
      expect(plan.entries[1]?.id).toBe(plan.appIds["tailor.config.ts"]);
    });

    test("rejects a config id that is not a UUID", async () => {
      const configPath = writeConfig("tailor.config.ts");
      await expect(
        planAppIds({
          lock: lockWith({}),
          entries: [{ configPath, configId: "not-a-uuid" }],
          mode: "write",
        }),
      ).rejects.toThrow(/must be a UUID/);
    });

    test("generates an id in write mode when nothing records one", async () => {
      const configPath = writeConfig("tailor.config.ts");
      const plan = await planAppIds({
        lock: lockWith({}),
        entries: [{ configPath, configId: undefined }],
        mode: "write",
      });
      expect(plan.changed).toBe(true);
      expect(plan.entries[0]).toMatchObject({ source: "generated", removeConfigId: false });
      expect(plan.entries[0]?.id).toMatch(UUID);
      expect(plan.appIds["tailor.config.ts"]).toBe(plan.entries[0]?.id);
    });

    test("leaves the id undefined with a warning in read mode", async () => {
      const configPath = writeConfig("tailor.config.ts");
      const plan = await planAppIds({
        lock: lockWith({}),
        entries: [{ configPath, configId: undefined }],
        mode: "read",
      });
      expect(plan.changed).toBe(false);
      expect(plan.entries[0]).toMatchObject({ id: undefined, source: "none" });
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("No app id is recorded"));
    });

    test("fails in require mode with re-keying guidance for orphaned entries", async () => {
      const configPath = writeConfig("apps/new/tailor.config.ts");
      await expect(
        planAppIds({
          lock: lockWith({ "apps/old/tailor.config.ts": ID_A }),
          entries: [{ configPath, configId: undefined }],
          mode: "require",
        }),
      ).rejects.toThrow(/Run 'tailor deploy' locally.*apps\/old\/tailor.config.ts.*re-key/s);
    });

    test("re-keys a single orphaned entry when the user confirms the move", async () => {
      vi.mocked(prompt.confirm).mockResolvedValue(true);
      writeConfig("tailor.config.ts");
      const configPath = writeConfig("apps/new/tailor.config.ts");
      const plan = await planAppIds({
        lock: lockWith({ "apps/old/tailor.config.ts": ID_A, "tailor.config.ts": ID_B }),
        entries: [{ configPath, configId: undefined }],
        mode: "write",
      });
      expect(prompt.confirm).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining(
            "apps/old/tailor.config.ts moved to apps/new/tailor.config.ts",
          ),
          default: false,
        }),
      );
      expect(plan.appIds).toEqual({ "tailor.config.ts": ID_B, "apps/new/tailor.config.ts": ID_A });
      expect(plan.entries[0]).toMatchObject({ id: ID_A, source: "lock" });
    });

    test("generates a fresh id and keeps the orphan when the user denies the move", async () => {
      vi.mocked(prompt.confirm).mockResolvedValue(false);
      const configPath = writeConfig("apps/new/tailor.config.ts");
      const plan = await planAppIds({
        lock: lockWith({ "apps/old/tailor.config.ts": ID_A }),
        entries: [{ configPath, configId: undefined }],
        mode: "write",
      });
      expect(plan.appIds["apps/old/tailor.config.ts"]).toBe(ID_A);
      expect(plan.entries[0]?.source).toBe("generated");
      expect(plan.appIds["apps/new/tailor.config.ts"]).not.toBe(ID_A);
    });

    test("fails instead of guessing when a move cannot be confirmed interactively", async () => {
      env.canPrompt = false;
      const configPath = writeConfig("apps/new/tailor.config.ts");
      await expect(
        planAppIds({
          lock: lockWith({ "apps/old/tailor.config.ts": ID_A }),
          entries: [{ configPath, configId: undefined }],
          mode: "write",
        }),
      ).rejects.toThrow(/re-key/);
      expect(prompt.confirm).not.toHaveBeenCalled();
    });

    test("fails when several orphaned entries make the move ambiguous", async () => {
      const configPath = writeConfig("apps/new/tailor.config.ts");
      await expect(
        planAppIds({
          lock: lockWith({
            "apps/old/tailor.config.ts": ID_A,
            "apps/older/tailor.config.ts": ID_B,
          }),
          entries: [{ configPath, configId: undefined }],
          mode: "write",
        }),
      ).rejects.toThrow(/apps\/old\/tailor.config.ts, apps\/older\/tailor.config.ts/);
      expect(prompt.confirm).not.toHaveBeenCalled();
    });

    test("returns entries in input order across every source", async () => {
      const generated = writeConfig("apps/new/tailor.config.ts");
      const recorded = writeConfig("apps/a/tailor.config.ts");
      const adopted = writeConfig("apps/b/tailor.config.ts");
      const plan = await planAppIds({
        lock: lockWith({ "apps/a/tailor.config.ts": ID_A }),
        entries: [
          { configPath: generated, configId: undefined },
          { configPath: recorded, configId: undefined },
          { configPath: adopted, configId: ID_B },
        ],
        mode: "write",
      });
      expect(plan.entries.map((entry) => [entry.configPath, entry.source])).toEqual([
        [generated, "generated"],
        [recorded, "lock"],
        [adopted, "config"],
      ]);
    });
  });

  describe("writeAppIds", () => {
    test("replaces the appIds section and bumps the version, keeping other fields", () => {
      writeLock({ version: 1, targets: [{ kind: "branch" }], extra: true });
      writeAppIds({ lock: lockWith({}), appIds: { "tailor.config.ts": ID_A } });
      const raw = fs.readFileSync(path.join(root, TAILOR_LOCK_FILENAME), "utf-8");
      expect(raw.endsWith("\n")).toBe(true);
      expect(Object.keys(readRawLock())).toEqual(["version", "targets", "extra", "appIds"]);
      expect(readRawLock()).toEqual({
        version: TAILOR_LOCK_VERSION,
        targets: [{ kind: "branch" }],
        extra: true,
        appIds: { "tailor.config.ts": ID_A },
      });
    });

    test("keeps entries another process recorded since the plan was made", () => {
      writeLock({ version: 2, targets: [], appIds: { "apps/old/tailor.config.ts": ID_A } });
      const planned = readAppIdLock(root) as AppIdLock;
      const other = "33333333-3333-4333-8333-333333333333";
      writeLock({
        version: 2,
        targets: [],
        appIds: { "apps/old/tailor.config.ts": ID_A, "apps/other/tailor.config.ts": other },
      });

      writeAppIds({ lock: planned, appIds: { "apps/new/tailor.config.ts": ID_A } });
      expect(readRawLock().appIds).toEqual({
        "apps/other/tailor.config.ts": other,
        "apps/new/tailor.config.ts": ID_A,
      });
    });

    test("never creates the lock file", () => {
      expect(() => writeAppIds({ lock: lockWith({}), appIds: {} })).toThrow(/does not exist/);
      expect(fs.existsSync(path.join(root, TAILOR_LOCK_FILENAME))).toBe(false);
    });
  });

  describe("resolveLockedAppIds", () => {
    test("in write mode records the adopted id and then removes it from the config", async () => {
      writeLock({ version: 1, targets: [] });
      const source = `import { defineConfig } from "@tailor-platform/sdk";
export default defineConfig({
  // SDK-managed app id — do not edit, except when copying this config to a separate app.
  id: "${ID_A}",
  name: "app",
});
`;
      const configPath = writeConfig("tailor.config.ts", source);
      const plan = await resolveLockedAppIds({
        lock: lockWith({}),
        entries: [{ configPath, configId: ID_A }],
        mode: "write",
      });
      expect(plan.entries[0]?.id).toBe(ID_A);
      expect(readRawLock()).toEqual({
        version: TAILOR_LOCK_VERSION,
        targets: [],
        appIds: { "tailor.config.ts": ID_A },
      });
      expect(fs.readFileSync(configPath, "utf-8")).toBe(
        `import { defineConfig } from "@tailor-platform/sdk";
export default defineConfig({
  name: "app",
});
`,
      );
    });

    test("edits a config listed twice only once", async () => {
      writeLock({ version: 2, targets: [] });
      const configPath = writeConfig(
        "tailor.config.ts",
        `export default defineConfig({ id: "${ID_A}", name: "app" });\n`,
      );
      await resolveLockedAppIds({
        lock: lockWith({}),
        entries: [
          { configPath, configId: ID_A },
          { configPath, configId: ID_A },
        ],
        mode: "write",
      });
      expect(fs.readFileSync(configPath, "utf-8")).toBe(
        `export default defineConfig({ name: "app" });\n`,
      );
      expect(logger.warn).not.toHaveBeenCalled();
    });

    test("warns instead of failing when the config shape cannot be edited", async () => {
      writeLock({ version: 2, targets: [] });
      const source = `export { default } from "./base.config";\n`;
      const configPath = writeConfig("tailor.config.ts", source);
      await resolveLockedAppIds({
        lock: lockWith({}),
        entries: [{ configPath, configId: ID_A }],
        mode: "write",
      });
      expect(fs.readFileSync(configPath, "utf-8")).toBe(source);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("by hand"));
    });

    test("writes nothing outside write mode", async () => {
      writeLock({ version: 1, targets: [] });
      const source = `export default defineConfig({ id: "${ID_A}" });\n`;
      const configPath = writeConfig("tailor.config.ts", source);
      await resolveLockedAppIds({
        lock: lockWith({}),
        entries: [{ configPath, configId: ID_A }],
        mode: "read",
      });
      expect(readRawLock()).toEqual({ version: 1, targets: [] });
      expect(fs.readFileSync(configPath, "utf-8")).toBe(source);
    });
  });

  describe("appIdPlanModeForDeploy", () => {
    test.each([
      { isCI: false, allow: undefined, dryRun: false, mode: "write" },
      { isCI: false, allow: undefined, dryRun: true, mode: "read" },
      { isCI: true, allow: undefined, dryRun: false, mode: "require" },
      { isCI: true, allow: undefined, dryRun: true, mode: "require" },
      { isCI: true, allow: "true", dryRun: false, mode: "write" },
      { isCI: true, allow: "true", dryRun: true, mode: "read" },
    ])(
      "isCI=$isCI TAILOR_CI_ALLOW_ID_INJECTION=$allow dryRun=$dryRun -> $mode",
      ({ isCI, allow, dryRun, mode }) => {
        env.isCI = isCI;
        if (allow !== undefined) vi.stubEnv("TAILOR_CI_ALLOW_ID_INJECTION", allow);
        expect(appIdPlanModeForDeploy(dryRun)).toBe(mode);
      },
    );
  });
});
