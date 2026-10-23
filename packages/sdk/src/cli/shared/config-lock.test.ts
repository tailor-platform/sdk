import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { describe, expect, test } from "vitest";
import { withConfigLock } from "./config-lock";
import { errorToJson } from "./error-json";
import { tempCwd } from "./test-helpers/temp-cwd";

const ELEVEN_MINUTES_MS = 11 * 60 * 1000;

function writeForeignLock(lockPath: string, overrides: Record<string, unknown> = {}) {
  fs.writeFileSync(
    lockPath,
    JSON.stringify({
      pid: process.pid,
      hostname: os.hostname(),
      nonce: "foreign",
      createdAt: Date.now(),
      ...overrides,
    }),
  );
}

function exitedPid(): number {
  return spawnSync(process.execPath, ["-e", ""]).pid;
}

function backdate(filePath: string, ageMs: number) {
  const time = new Date(Date.now() - ageMs);
  fs.utimesSync(filePath, time, time);
}

describe("withConfigLock", () => {
  test("runs callers in the same process one at a time", async () => {
    using tempDir = tempCwd("tailor-config-lock-");
    const lockPath = path.join(tempDir.dir, "config.yaml.lock");
    let active = 0;
    let maxActive = 0;
    const task = () =>
      withConfigLock(lockPath, async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active--;
      });

    await Promise.all([task(), task(), task()]);

    expect(maxActive).toBe(1);
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  test("lets the holder take the lock again", async () => {
    using tempDir = tempCwd("tailor-config-lock-");
    const lockPath = path.join(tempDir.dir, "config.yaml.lock");

    const result = await withConfigLock(lockPath, () =>
      withConfigLock(lockPath, async () => "nested"),
    );

    expect(result).toBe("nested");
  });

  test("waits until another live process releases its lock", async () => {
    using tempDir = tempCwd("tailor-config-lock-");
    const lockPath = path.join(tempDir.dir, "config.yaml.lock");
    writeForeignLock(lockPath);
    let releasedAt = 0;
    setTimeout(() => {
      releasedAt = Date.now();
      fs.rmSync(lockPath);
    }, 100);

    const enteredAt = await withConfigLock(lockPath, async () => Date.now());

    expect(releasedAt).toBeGreaterThan(0);
    expect(enteredAt).toBeGreaterThanOrEqual(releasedAt);
  });

  test("times out on a lock another live process keeps", async () => {
    using tempDir = tempCwd("tailor-config-lock-");
    const lockPath = path.join(tempDir.dir, "config.yaml.lock");
    writeForeignLock(lockPath);

    const error = await withConfigLock(lockPath, async () => "entered", { timeoutMs: 100 }).catch(
      (error: unknown) => error,
    );

    expect(errorToJson(error).error).toMatchObject({
      code: "CONFIG_LOCK_TIMEOUT",
      context: { lockPath },
    });
    expect(JSON.parse(fs.readFileSync(lockPath, "utf-8"))).toMatchObject({ nonce: "foreign" });
  });

  test("reclaims a lock whose process has exited", async () => {
    using tempDir = tempCwd("tailor-config-lock-");
    const lockPath = path.join(tempDir.dir, "config.yaml.lock");
    writeForeignLock(lockPath, { pid: exitedPid() });

    await expect(
      withConfigLock(lockPath, async () => "entered", { timeoutMs: 1000 }),
    ).resolves.toBe("entered");
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  test("keeps a recent lock from another host", async () => {
    using tempDir = tempCwd("tailor-config-lock-");
    const lockPath = path.join(tempDir.dir, "config.yaml.lock");
    writeForeignLock(lockPath, { hostname: `${os.hostname()}-other`, pid: exitedPid() });

    await expect(
      withConfigLock(lockPath, async () => "entered", { timeoutMs: 100 }),
    ).rejects.toMatchObject({ code: "CONFIG_LOCK_TIMEOUT" });
  });

  test("reclaims an old lock from another host", async () => {
    using tempDir = tempCwd("tailor-config-lock-");
    const lockPath = path.join(tempDir.dir, "config.yaml.lock");
    writeForeignLock(lockPath, {
      hostname: `${os.hostname()}-other`,
      createdAt: Date.now() - ELEVEN_MINUTES_MS,
    });
    backdate(lockPath, ELEVEN_MINUTES_MS);

    await expect(
      withConfigLock(lockPath, async () => "entered", { timeoutMs: 1000 }),
    ).resolves.toBe("entered");
  });

  test("treats a lock file that has no content yet as held", async () => {
    using tempDir = tempCwd("tailor-config-lock-");
    const lockPath = path.join(tempDir.dir, "config.yaml.lock");
    fs.writeFileSync(lockPath, "");

    await expect(
      withConfigLock(lockPath, async () => "entered", { timeoutMs: 100 }),
    ).rejects.toMatchObject({ code: "CONFIG_LOCK_TIMEOUT" });
  });

  test("reclaims an old lock file that never got content", async () => {
    using tempDir = tempCwd("tailor-config-lock-");
    const lockPath = path.join(tempDir.dir, "config.yaml.lock");
    fs.writeFileSync(lockPath, "");
    backdate(lockPath, 60 * 1000);

    await expect(
      withConfigLock(lockPath, async () => "entered", { timeoutMs: 1000 }),
    ).resolves.toBe("entered");
  });

  test("leaves a lock that another process took over in place on release", async () => {
    using tempDir = tempCwd("tailor-config-lock-");
    const lockPath = path.join(tempDir.dir, "config.yaml.lock");

    await withConfigLock(lockPath, async () => {
      writeForeignLock(lockPath);
    });

    expect(JSON.parse(fs.readFileSync(lockPath, "utf-8"))).toMatchObject({ nonce: "foreign" });
  });

  test("releases the lock when the callback throws", async () => {
    using tempDir = tempCwd("tailor-config-lock-");
    const lockPath = path.join(tempDir.dir, "config.yaml.lock");

    await expect(
      withConfigLock(lockPath, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(fs.existsSync(lockPath)).toBe(false);
  });
});
