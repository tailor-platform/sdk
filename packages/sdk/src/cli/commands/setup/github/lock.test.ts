import * as fs from "node:fs";
import * as path from "pathe";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { findTarget, hashContent, LOCK_VERSION, readLock, writeLock, type LockFile } from "./lock";

function makeLock(): LockFile {
  return {
    version: LOCK_VERSION,
    targets: [
      {
        kind: "branch",
        workspaceName: "my-app",
        file: ".github/workflows/tailor-my-app.yml",
        templateVersion: 1,
        inputs: {
          workspaceRegion: "asia-northeast",
          organizationId: "org-1",
          folderId: null,
          branch: "main",
          tagPattern: null,
          environment: null,
          dir: ".",
          packageManager: "pnpm",
          plan: true,
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

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  test("returns null when no lock exists", () => {
    expect(readLock(testDir)).toBeNull();
  });

  test("round-trips through disk with 2-space indent and trailing newline", () => {
    const lock = makeLock();
    writeLock(testDir, lock);
    const raw = fs.readFileSync(path.join(testDir, ".github/tailor-sdk.lock"), "utf-8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(raw).toContain('  "version": 1');
    expect(readLock(testDir)).toEqual(lock);
  });

  test("throws on a forward-incompatible version", () => {
    const lock = makeLock();
    lock.version = LOCK_VERSION + 1;
    writeLock(testDir, lock);
    expect(() => readLock(testDir)).toThrow(/newer SDK/);
  });

  test("throws with restore guidance when the version field is missing", () => {
    const lock = makeLock() as unknown as Record<string, unknown>;
    delete lock.version;
    fs.mkdirSync(path.join(testDir, ".github"), { recursive: true });
    fs.writeFileSync(
      path.join(testDir, ".github/tailor-sdk.lock"),
      `${JSON.stringify(lock, null, 2)}\n`,
    );
    expect(() => readLock(testDir)).toThrow(/no valid 'version'/);
  });

  test("throws with restore guidance when targets is not an array", () => {
    fs.mkdirSync(path.join(testDir, ".github"), { recursive: true });
    fs.writeFileSync(
      path.join(testDir, ".github/tailor-sdk.lock"),
      `${JSON.stringify({ version: LOCK_VERSION }, null, 2)}\n`,
    );
    expect(() => readLock(testDir)).toThrow(/no valid 'targets'/);
  });

  test("throws on invalid JSON", () => {
    fs.mkdirSync(path.join(testDir, ".github"), { recursive: true });
    fs.writeFileSync(path.join(testDir, ".github/tailor-sdk.lock"), "{ not json");
    expect(() => readLock(testDir)).toThrow(/not valid JSON/);
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
