import * as fs from "node:fs";
import * as path from "pathe";
import { aroundEach, describe, expect, test } from "vitest";
import { findTarget, hashContent, LOCK_VERSION, readLock, writeLock, type LockFile } from "./lock";

function makeLock(): LockFile {
  return {
    version: LOCK_VERSION,
    setups: [],
    targets: [
      {
        kind: "branch",
        workspaceName: "my-app",
        file: ".github/workflows/tailor-my-app.yml",
        templateVersion: 1,
        inputs: {
          branch: "main",
          tagPattern: null,
          environment: "my-app",
          dir: ".",
          packageManager: "pnpm",
        },
        generatedIds: ["tailor-deploy", "tailor-deploy/tailor-apply"],
        ejectedIds: [],
        contentHash: hashContent("hello"),
      },
    ],
  };
}

describe("hashContent", () => {
  test("is a stable sha256 prefix", () => {
    expect(hashContent("hello")).toBe(hashContent("hello"));
    expect(hashContent("hello")).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(hashContent("a")).not.toBe(hashContent("b"));
  });
});

describe("readLock / writeLock", () => {
  const testDir = path.join(
    "/tmp",
    `lock-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );

  aroundEach(async (runTest) => {
    fs.mkdirSync(testDir, { recursive: true });
    await runTest();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  test("returns null when no lock exists", () => {
    expect(readLock(testDir)).toBeNull();
  });

  test("round-trips through disk with 2-space indent and trailing newline", () => {
    const lock = makeLock();
    writeLock(testDir, lock);
    const raw = fs.readFileSync(path.join(testDir, ".github/tailor.lock"), "utf-8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(raw).toContain('  "version": 2');
    expect(readLock(testDir)).toEqual(lock);
  });

  test("round-trips setup registrations separately from hash-guarded targets", () => {
    const lock: LockFile = {
      ...makeLock(),
      setups: [{ kind: "renovate", file: "renovate.json" }],
    };
    writeLock(testDir, lock);

    expect(readLock(testDir)).toEqual(lock);
    expect(readLock(testDir)!.setups[0]).not.toHaveProperty("contentHash");
  });

  test("throws on a forward-incompatible version", () => {
    const lock = makeLock();
    lock.version = LOCK_VERSION + 1;
    writeLock(testDir, lock);
    expect(() => readLock(testDir)).toThrow(/newer SDK/);
  });

  test("reads a version 1 lock as having no setup registrations", () => {
    const lock = makeLock();
    const legacyLock = { version: 1, targets: lock.targets };
    fs.mkdirSync(path.join(testDir, ".github"), { recursive: true });
    fs.writeFileSync(
      path.join(testDir, ".github/tailor.lock"),
      `${JSON.stringify(legacyLock, null, 2)}\n`,
    );

    expect(readLock(testDir)).toEqual({ ...legacyLock, setups: [] });
  });

  test.each([
    {
      title: "throws with restore guidance when the version field is missing",
      content: () => {
        const lock = makeLock() as unknown as Record<string, unknown>;
        delete lock.version;
        return `${JSON.stringify(lock, null, 2)}\n`;
      },
      error: /no valid 'version'/,
    },
    {
      title: "throws with restore guidance when targets is not an array",
      content: () => `${JSON.stringify({ version: LOCK_VERSION, setups: [] }, null, 2)}\n`,
      error: /no valid 'targets'/,
    },
    {
      title: "throws with restore guidance when setups is missing from a version 2 lock",
      content: () => `${JSON.stringify({ version: LOCK_VERSION, targets: [] }, null, 2)}\n`,
      error: /no valid 'setups'/,
    },
    {
      title: "throws with restore guidance when setups is not an array",
      content: () =>
        `${JSON.stringify({ version: LOCK_VERSION, targets: [], setups: {} }, null, 2)}\n`,
      error: /no valid 'setups'/,
    },
    {
      title: "throws with restore guidance when a setup registration is null",
      content: () =>
        `${JSON.stringify({ version: LOCK_VERSION, targets: [], setups: [null] }, null, 2)}\n`,
      error: /no valid 'setups'/,
    },
    {
      title: "throws with restore guidance when a setup registration has an unknown kind",
      content: () =>
        `${JSON.stringify(
          {
            version: LOCK_VERSION,
            targets: [],
            setups: [{ kind: "unknown", file: "renovate.json" }],
          },
          null,
          2,
        )}\n`,
      error: /no valid 'setups'/,
    },
    {
      title: "throws with restore guidance when a setup registration has an empty file",
      content: () =>
        `${JSON.stringify(
          {
            version: LOCK_VERSION,
            targets: [],
            setups: [{ kind: "renovate", file: "" }],
          },
          null,
          2,
        )}\n`,
      error: /no valid 'setups'/,
    },
    {
      title: "throws with restore guidance when a Renovate registration has another file",
      content: () =>
        `${JSON.stringify(
          {
            version: LOCK_VERSION,
            targets: [],
            setups: [{ kind: "renovate", file: "README.md" }],
          },
          null,
          2,
        )}\n`,
      error: /no valid 'setups'/,
    },
    {
      title: "throws on invalid JSON",
      content: () => "{ not json",
      error: /not valid JSON/,
    },
  ])("$title", ({ content, error }) => {
    fs.mkdirSync(path.join(testDir, ".github"), { recursive: true });
    fs.writeFileSync(path.join(testDir, ".github/tailor.lock"), content());
    expect(() => readLock(testDir)).toThrow(error);
  });
});

describe("findTarget", () => {
  test("matches by (kind, workspaceName)", () => {
    const lock = makeLock();
    expect(findTarget(lock, "branch", "my-app")?.workspaceName).toBe("my-app");
    expect(findTarget(lock, "tag", "my-app")).toBeUndefined();
    expect(findTarget(lock, "branch", "other")).toBeUndefined();
    expect(findTarget(null, "branch", "my-app")).toBeUndefined();
  });
});
