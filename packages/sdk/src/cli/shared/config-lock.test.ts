import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { describe, expect, test, vi } from "vitest";
import { isConfigLockTimeout, withConfigLock } from "./config-lock";
import { errorToJson } from "./error-json";
import { logger } from "./logger";
import { createConcurrencyProbe } from "./test-helpers/concurrency-probe";
import { writeHeldConfigLock } from "./test-helpers/config-lock";
import { tempCwd } from "./test-helpers/temp-cwd";

const THREE_MINUTES_MS = 3 * 60 * 1000;
const otherHost = `${os.hostname()}-other`;

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

type LockSetup = (lockPath: string) => void | Promise<void>;

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

  test.each<{ lock: string; setup: LockSetup }>([
    { lock: "another live process on this host holds", setup: (p) => writeHeldConfigLock(p) },
    {
      lock: "another thread of this process holds",
      setup: (p) => writeHeldConfigLock(p, { pid: process.pid, instanceId: "other-thread" }),
    },
    {
      lock: "a live process on this host has held for a minute",
      setup: (p) => writeHeldConfigLock(p, { createdAt: Date.now() - 60 * 1000 }),
    },
    {
      lock: "a process on another host took recently",
      setup: (p) => writeHeldConfigLock(p, { hostname: otherHost, pid: exitedPid() }),
    },
    { lock: "has no content yet", setup: (p) => fs.writeFileSync(p, "") },
    {
      lock: "another process is reclaiming",
      setup: (p) => {
        writeHeldConfigLock(p, { pid: exitedPid() });
        fs.writeFileSync(`${p}.reclaim`, "");
      },
    },
  ])("times out on a lock $lock and leaves it in place", async ({ setup }) => {
    using tempDir = tempCwd("tailor-config-lock-");
    const lockPath = path.join(tempDir.dir, "config.yaml.lock");
    await setup(lockPath);
    const before = fs.readFileSync(lockPath, "utf-8");

    const error = await withConfigLock(lockPath, async () => "entered", { timeoutMs: 100 }).catch(
      (error: unknown) => error,
    );

    expect(isConfigLockTimeout(error)).toBe(true);
    expect(errorToJson(error).error).toMatchObject({
      code: "CONFIG_LOCK_TIMEOUT",
      context: { lockPath },
    });
    expect(fs.readFileSync(lockPath, "utf-8")).toBe(before);
  });

  test.each<{ lock: string; setup: LockSetup }>([
    {
      lock: "whose process has exited",
      setup: (p) => writeHeldConfigLock(p, { pid: exitedPid() }),
    },
    {
      lock: "this module left behind",
      setup: async (p) => {
        const ownLock = await withConfigLock(p, async () => fs.readFileSync(p, "utf-8"));
        fs.writeFileSync(p, ownLock);
      },
    },
    {
      lock: "a live process on this host has held for over two minutes",
      setup: (p) => writeHeldConfigLock(p, { createdAt: Date.now() - THREE_MINUTES_MS }),
    },
    {
      lock: "another thread of this process has held for over two minutes",
      setup: (p) =>
        writeHeldConfigLock(p, {
          pid: process.pid,
          instanceId: "other-thread",
          createdAt: Date.now() - THREE_MINUTES_MS,
        }),
    },
    {
      lock: "a process on another host took over two minutes ago",
      setup: (p) =>
        writeHeldConfigLock(p, { hostname: otherHost, createdAt: Date.now() - THREE_MINUTES_MS }),
    },
    {
      lock: "that never got content",
      setup: (p) => {
        fs.writeFileSync(p, "");
        backdate(p, 60 * 1000);
      },
    },
    {
      lock: "whose reclaiming process left its guard behind",
      setup: (p) => {
        writeHeldConfigLock(p, { pid: exitedPid() });
        fs.writeFileSync(`${p}.reclaim`, "");
        backdate(`${p}.reclaim`, 60 * 1000);
      },
    },
  ])("reclaims a lock $lock", async ({ setup }) => {
    using tempDir = tempCwd("tailor-config-lock-");
    const lockPath = path.join(tempDir.dir, "config.yaml.lock");
    await setup(lockPath);

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
