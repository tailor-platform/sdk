import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { describe, expect, test, vi } from "vitest";
import { isConfigLockTimeout, withConfigLock } from "./config-lock";
import { errorToJson } from "./error-json";
import { logger } from "./logger";
import { createConcurrencyProbe } from "./test-helpers/concurrency-probe";
import { processStartedAt, writeHeldConfigLock } from "./test-helpers/config-lock";
import { tempCwd } from "./test-helpers/temp-cwd";

const THREE_MINUTES_MS = 3 * 60 * 1000;
const ELEVEN_MINUTES_MS = 11 * 60 * 1000;

function exitedPid(): number {
  return spawnSync(process.execPath, ["-e", ""]).pid;
}

function backdate(filePath: string, ageMs: number) {
  const time = new Date(Date.now() - ageMs);
  fs.utimesSync(filePath, time, time);
}

function readNonce(lockPath: string): unknown {
  return (JSON.parse(fs.readFileSync(lockPath, "utf-8")) as { nonce: unknown }).nonce;
}

describe("withConfigLock", () => {
  test("runs callers in the same process one at a time", async () => {
    using tempDir = tempCwd("tailor-config-lock-");
    const lockPath = path.join(tempDir.dir, "config.yaml.lock");
    const probe = createConcurrencyProbe();

    await Promise.all([1, 2, 3].map(() => withConfigLock(lockPath, probe.run)));

    expect(probe.maxInFlight()).toBe(1);
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
    writeHeldConfigLock(lockPath);
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
    writeHeldConfigLock(lockPath);

    const error = await withConfigLock(lockPath, async () => "entered", { timeoutMs: 100 }).catch(
      (error: unknown) => error,
    );

    expect(isConfigLockTimeout(error)).toBe(true);
    expect(errorToJson(error).error).toMatchObject({
      code: "CONFIG_LOCK_TIMEOUT",
      context: { lockPath },
    });
    expect(readNonce(lockPath)).toBe("other-process");
  });

  test("reclaims a lock whose process has exited", async () => {
    using tempDir = tempCwd("tailor-config-lock-");
    const lockPath = path.join(tempDir.dir, "config.yaml.lock");
    writeHeldConfigLock(lockPath, { pid: exitedPid() });

    await expect(
      withConfigLock(lockPath, async () => "entered", { timeoutMs: 1000 }),
    ).resolves.toBe("entered");
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  test("reclaims a lock an earlier process with this process's pid left behind", async () => {
    using tempDir = tempCwd("tailor-config-lock-");
    const lockPath = path.join(tempDir.dir, "config.yaml.lock");
    writeHeldConfigLock(lockPath, {
      pid: process.pid,
      processStartedAt: processStartedAt() - 60 * 60 * 1000,
    });

    await expect(
      withConfigLock(lockPath, async () => "entered", { timeoutMs: 1000 }),
    ).resolves.toBe("entered");
  });

  test("waits for a lock another thread of this process holds", async () => {
    using tempDir = tempCwd("tailor-config-lock-");
    const lockPath = path.join(tempDir.dir, "config.yaml.lock");
    writeHeldConfigLock(lockPath, {
      pid: process.pid,
      processStartedAt: processStartedAt(),
      instanceId: "other-thread",
    });

    await expect(
      withConfigLock(lockPath, async () => "entered", { timeoutMs: 100 }),
    ).rejects.toMatchObject({ code: "CONFIG_LOCK_TIMEOUT" });
  });

  test("keeps a lock a live process on this host has held for minutes", async () => {
    using tempDir = tempCwd("tailor-config-lock-");
    const lockPath = path.join(tempDir.dir, "config.yaml.lock");
    writeHeldConfigLock(lockPath, { createdAt: Date.now() - THREE_MINUTES_MS });

    await expect(
      withConfigLock(lockPath, async () => "entered", { timeoutMs: 100 }),
    ).rejects.toMatchObject({ code: "CONFIG_LOCK_TIMEOUT" });
  });

  test("reclaims a lock a live process on this host has held for over ten minutes", async () => {
    using tempDir = tempCwd("tailor-config-lock-");
    const lockPath = path.join(tempDir.dir, "config.yaml.lock");
    writeHeldConfigLock(lockPath, { createdAt: Date.now() - ELEVEN_MINUTES_MS });

    await expect(
      withConfigLock(lockPath, async () => "entered", { timeoutMs: 1000 }),
    ).resolves.toBe("entered");
  });

  test("keeps a recent lock from another host", async () => {
    using tempDir = tempCwd("tailor-config-lock-");
    const lockPath = path.join(tempDir.dir, "config.yaml.lock");
    writeHeldConfigLock(lockPath, { hostname: `${os.hostname()}-other`, pid: exitedPid() });

    await expect(
      withConfigLock(lockPath, async () => "entered", { timeoutMs: 100 }),
    ).rejects.toMatchObject({ code: "CONFIG_LOCK_TIMEOUT" });
  });

  test("reclaims an old lock from another host", async () => {
    using tempDir = tempCwd("tailor-config-lock-");
    const lockPath = path.join(tempDir.dir, "config.yaml.lock");
    writeHeldConfigLock(lockPath, {
      hostname: `${os.hostname()}-other`,
      createdAt: Date.now() - THREE_MINUTES_MS,
    });

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

  test("leaves a stale lock to the process that is reclaiming it", async () => {
    using tempDir = tempCwd("tailor-config-lock-");
    const lockPath = path.join(tempDir.dir, "config.yaml.lock");
    writeHeldConfigLock(lockPath, { pid: exitedPid() });
    fs.writeFileSync(`${lockPath}.reclaim`, "");

    await expect(
      withConfigLock(lockPath, async () => "entered", { timeoutMs: 100 }),
    ).rejects.toMatchObject({ code: "CONFIG_LOCK_TIMEOUT" });
    expect(readNonce(lockPath)).toBe("other-process");
  });

  test("reclaims a stale lock when the reclaiming process left its guard behind", async () => {
    using tempDir = tempCwd("tailor-config-lock-");
    const lockPath = path.join(tempDir.dir, "config.yaml.lock");
    writeHeldConfigLock(lockPath, { pid: exitedPid() });
    fs.writeFileSync(`${lockPath}.reclaim`, "");
    backdate(`${lockPath}.reclaim`, 60 * 1000);

    await expect(
      withConfigLock(lockPath, async () => "entered", { timeoutMs: 1000 }),
    ).resolves.toBe("entered");
    expect(fs.readdirSync(tempDir.dir)).toEqual([]);
  });

  test("stamps the lock with the time it was taken", async () => {
    using tempDir = tempCwd("tailor-config-lock-");
    const lockPath = path.join(tempDir.dir, "config.yaml.lock");
    writeHeldConfigLock(lockPath);
    setTimeout(() => fs.rmSync(lockPath), 200);
    const startedAt = Date.now();

    const createdAt = await withConfigLock(
      lockPath,
      async () =>
        (JSON.parse(fs.readFileSync(lockPath, "utf-8")) as { createdAt: number }).createdAt,
    );

    expect(createdAt - startedAt).toBeGreaterThanOrEqual(150);
  });

  test("says once that it is waiting for another command", async () => {
    using tempDir = tempCwd("tailor-config-lock-");
    const lockPath = path.join(tempDir.dir, "config.yaml.lock");
    writeHeldConfigLock(lockPath);
    using infoSpy = vi.spyOn(logger, "info").mockImplementation(() => {});
    vi.useFakeTimers();
    try {
      const entered = withConfigLock(lockPath, async () => "entered");
      await vi.advanceTimersByTimeAsync(6_000);
      fs.rmSync(lockPath);
      await vi.advanceTimersByTimeAsync(1_000);

      await expect(entered).resolves.toBe("entered");
    } finally {
      vi.useRealTimers();
    }
    expect(
      infoSpy.mock.calls.filter(([message]) => String(message).startsWith("Waiting for another")),
    ).toHaveLength(1);
  });

  test("leaves a lock that another process took over in place on release", async () => {
    using tempDir = tempCwd("tailor-config-lock-");
    const lockPath = path.join(tempDir.dir, "config.yaml.lock");

    await withConfigLock(lockPath, async () => {
      writeHeldConfigLock(lockPath);
    });

    expect(readNonce(lockPath)).toBe("other-process");
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
