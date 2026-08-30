import { Code, ConnectError } from "@connectrpc/connect";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { logger } from "#/cli/shared/logger";
import { deployLockResourceName, withDeployLock } from "./deploy-lock";
import type { OperatorClient } from "#/cli/shared/client";

vi.mock("#/cli/shared/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
    newline: vi.fn(),
    log: vi.fn(),
  },
  styles: { bold: (s: string) => s },
}));

interface Entry {
  description: string;
}

interface StreamInfo {
  name: string;
  description: string;
}

async function readInfo(stream: AsyncIterable<unknown>): Promise<StreamInfo> {
  let info: StreamInfo | undefined;
  for await (const message of stream) {
    const payload = (message as { payload: { case: string; value: unknown } }).payload;
    if (payload.case === "info") info = payload.value as StreamInfo;
  }
  if (!info) throw new Error("stream carried no info header");
  return info;
}

function record(description: string) {
  return JSON.parse(description) as { token: string; heartbeat: number; application: string };
}

// In-memory function registry with the create-only semantics the lock relies on.
function createRegistry(initial: Record<string, Entry> = {}) {
  const entries = new Map<string, Entry>(Object.entries(initial));
  const calls: string[] = [];
  const client = {
    createFunctionRegistry: vi.fn(async (stream: AsyncIterable<unknown>) => {
      const info = await readInfo(stream);
      calls.push(`create:${info.name}`);
      if (entries.has(info.name)) {
        throw new ConnectError("function with the same name already exists", Code.AlreadyExists);
      }
      entries.set(info.name, { description: info.description });
      return {};
    }),
    updateFunctionRegistry: vi.fn(async (stream: AsyncIterable<unknown>) => {
      const info = await readInfo(stream);
      calls.push(`update:${info.name}`);
      if (!entries.has(info.name)) throw new ConnectError("not found", Code.NotFound);
      entries.set(info.name, { description: info.description });
      return {};
    }),
    getFunctionRegistry: vi.fn(async ({ name }: { name: string }) => {
      calls.push(`get:${name}`);
      const entry = entries.get(name);
      if (!entry) throw new ConnectError("not found", Code.NotFound);
      return { function: { name, description: entry.description } };
    }),
    deleteFunctionRegistry: vi.fn(async ({ name }: { name: string }) => {
      calls.push(`delete:${name}`);
      if (!entries.delete(name)) throw new ConnectError("not found", Code.NotFound);
      return {};
    }),
    setMetadata: vi.fn(),
  };
  return { client: client as unknown as OperatorClient, raw: client, entries, calls };
}

function holderDescription(overrides: Partial<{ token: string; heartbeat: number }> = {}) {
  return JSON.stringify({
    v: 1,
    token: overrides.token ?? "other-token",
    application: "my-app",
    holder: { host: "ci-runner", pid: 42, startedAt: "2026-08-29T00:00:00.000Z" },
    heartbeat: overrides.heartbeat ?? 0,
  });
}

const app = { name: "my-app", id: "app-1" };
const lockName = deployLockResourceName(app);
const timing = {
  pollIntervalMs: 1_000,
  waitTimeoutMs: 60_000,
  heartbeatIntervalMs: 5_000,
  leaseMs: 10_000,
};

function lock<T>(client: OperatorClient, fn: (lock: { assertHeld(): void }) => Promise<T>) {
  return withDeployLock({ client, workspaceId: "ws-1", applications: [app], timing }, fn);
}

describe("deployLockResourceName", () => {
  test("is keyed by the application id when one is declared", () => {
    expect(deployLockResourceName({ name: "old-name", id: "app-1" })).toBe(
      deployLockResourceName({ name: "new-name", id: "app-1" }),
    );
    expect(deployLockResourceName({ name: "my-app", id: "app-1" })).not.toBe(
      deployLockResourceName({ name: "my-app", id: "app-2" }),
    );
  });

  test("falls back to the name and stays a fixed-length identifier", () => {
    const name = deployLockResourceName({ name: "My App with spaces / and more characters" });
    expect(name).toMatch(/^sdk-deploy-lock--[0-9a-f]{16}$/);
    expect(name).not.toBe(deployLockResourceName({ name: "another" }));
  });
});

describe("withDeployLock", () => {
  aroundEach(async (runTest) => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    try {
      await runTest();
    } finally {
      vi.useRealTimers();
    }
  });

  test("creates the lock entry around the critical section and deletes it afterwards", async () => {
    const { client, raw, entries, calls } = createRegistry();

    const result = await lock(client, async () => {
      const entry = entries.get(lockName);
      expect(entry).toBeDefined();
      expect(record(entry!.description).application).toBe("my-app");
      return "done";
    });

    expect(result).toBe("done");
    expect(entries.has(lockName)).toBe(false);
    expect(calls).toEqual([`create:${lockName}`, `get:${lockName}`, `delete:${lockName}`]);
    // The entry must stay unlabeled so a deploy does not plan its own lock for deletion.
    expect(raw.setMetadata).not.toHaveBeenCalled();
  });

  test("releases the lock and rethrows when the critical section fails", async () => {
    const { client, entries } = createRegistry();

    await expect(
      lock(client, async () => {
        throw new Error("apply failed");
      }),
    ).rejects.toThrow("apply failed");

    expect(entries.has(lockName)).toBe(false);
  });

  test("waits for a live holder and proceeds once it releases", async () => {
    const { client, entries } = createRegistry({
      [lockName]: { description: holderDescription() },
    });
    const fn = vi.fn(async () => "done");
    const pending = lock(client, fn);

    // The holder keeps heartbeating, then releases.
    await vi.advanceTimersByTimeAsync(timing.pollIntervalMs * 3);
    entries.set(lockName, { description: holderDescription({ heartbeat: 1 }) });
    await vi.advanceTimersByTimeAsync(timing.pollIntervalMs * 3);
    expect(fn).not.toHaveBeenCalled();
    entries.delete(lockName);
    await vi.advanceTimersByTimeAsync(timing.pollIntervalMs);

    await expect(pending).resolves.toBe("done");
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Another deploy of "my-app" is in progress'),
    );
  });

  test("reclaims a lock whose record stayed unchanged for a whole lease", async () => {
    const { client, entries, calls } = createRegistry({
      [lockName]: { description: holderDescription({ token: "dead" }) },
    });
    const fn = vi.fn(async () => "done");
    const pending = lock(client, fn);

    await vi.advanceTimersByTimeAsync(timing.leaseMs - timing.pollIntervalMs);
    expect(fn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(timing.pollIntervalMs * 2);

    await expect(pending).resolves.toBe("done");
    expect(calls).toContain(`delete:${lockName}`);
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Reclaiming the deploy lock of "my-app"'),
    );
    expect(entries.has(lockName)).toBe(false);
  });

  test("does not reclaim a lock whose heartbeat keeps changing", async () => {
    const { client, entries, calls } = createRegistry({
      [lockName]: { description: holderDescription() },
    });
    const pending = lock(client, async () => "done");

    for (let heartbeat = 1; heartbeat <= 4; heartbeat++) {
      await vi.advanceTimersByTimeAsync(timing.leaseMs / 2);
      entries.set(lockName, { description: holderDescription({ heartbeat }) });
    }
    expect(calls).not.toContain(`delete:${lockName}`);

    entries.delete(lockName);
    await vi.advanceTimersByTimeAsync(timing.pollIntervalMs);
    await expect(pending).resolves.toBe("done");
  });

  test("gives up with the holder's identity after the wait timeout", async () => {
    const { client, entries, calls } = createRegistry({
      [lockName]: { description: holderDescription() },
    });
    let heartbeat = 0;
    const pending = lock(client, async () => "done");
    // Collect the rejection immediately so the timer loop cannot leave it unhandled.
    const outcome = pending.then(
      () => undefined,
      (error: unknown) => error,
    );

    for (let elapsed = 0; elapsed <= timing.waitTimeoutMs; elapsed += timing.pollIntervalMs) {
      heartbeat += 1;
      entries.set(lockName, { description: holderDescription({ heartbeat }) });
      await vi.advanceTimersByTimeAsync(timing.pollIntervalMs);
    }

    const error = await outcome;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('Timed out waiting for another deploy of "my-app"');
    expect((error as Error).message).toContain("started 2026-08-29T00:00:00.000Z on ci-runner");
    expect(calls).not.toContain(`delete:${lockName}`);
  });

  test("treats an unreadable record as a holder and reclaims it once it stops changing", async () => {
    // A newer SDK may write a record this version cannot parse; it is still a
    // live holder as long as its description keeps changing.
    const { client, entries, calls } = createRegistry({
      [lockName]: { description: '{"v":2,"beat":0}' },
    });
    const pending = lock(client, async () => "done");

    await vi.advanceTimersByTimeAsync(timing.leaseMs / 2);
    entries.set(lockName, { description: '{"v":2,"beat":1}' });
    await vi.advanceTimersByTimeAsync(timing.leaseMs / 2);
    expect(calls).not.toContain(`delete:${lockName}`);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("holder record unreadable"));

    await vi.advanceTimersByTimeAsync(timing.leaseMs);
    await expect(pending).resolves.toBe("done");
    expect(calls).toContain(`delete:${lockName}`);
  });

  test("serializes two contenders for the same lock", async () => {
    const { client } = createRegistry();
    const events: string[] = [];
    const first = lock(client, async () => {
      events.push("first:start");
      await vi.advanceTimersByTimeAsync(timing.pollIntervalMs * 3);
      events.push("first:end");
    });
    const second = lock(client, async () => {
      events.push("second:start");
    });

    await vi.advanceTimersByTimeAsync(timing.pollIntervalMs * 5);
    await Promise.all([first, second]);

    expect(events).toEqual(["first:start", "first:end", "second:start"]);
  });

  test("keeps the lock through a transient heartbeat failure", async () => {
    const { client, raw, entries } = createRegistry();
    raw.getFunctionRegistry.mockRejectedValueOnce(
      new ConnectError("unavailable", Code.Unavailable),
    );

    await lock(client, async (held) => {
      await vi.advanceTimersByTimeAsync(timing.heartbeatIntervalMs * 2);
      expect(() => held.assertHeld()).not.toThrow();
      expect(record(entries.get(lockName)!.description).heartbeat).toBe(1);
    });

    expect(logger.warn).not.toHaveBeenCalled();
  });

  test("refreshes a lock already held while waiting for another application's lock", async () => {
    const other = { name: "other-app", id: "app-2" };
    const [firstName] = [lockName, deployLockResourceName(other)].toSorted();
    const waitingOn = firstName === lockName ? other : app;
    const waitingOnName = deployLockResourceName(waitingOn);
    const { client, entries } = createRegistry({
      [waitingOnName]: { description: holderDescription() },
    });
    const pending = withDeployLock(
      { client, workspaceId: "ws-1", applications: [app, other], timing },
      async () => "done",
    );

    for (let beat = 1; beat <= 4; beat++) {
      await vi.advanceTimersByTimeAsync(timing.heartbeatIntervalMs);
      entries.set(waitingOnName, { description: holderDescription({ heartbeat: beat }) });
    }
    expect(record(entries.get(firstName!)!.description).heartbeat).toBeGreaterThan(0);

    entries.delete(waitingOnName);
    await vi.advanceTimersByTimeAsync(timing.pollIntervalMs);
    await expect(pending).resolves.toBe("done");
  });

  test("keeps polling and gives up when the entry is reported held but never readable", async () => {
    const { client, raw } = createRegistry();
    raw.createFunctionRegistry.mockRejectedValue(new ConnectError("exists", Code.AlreadyExists));
    raw.getFunctionRegistry.mockRejectedValue(new ConnectError("not found", Code.NotFound));
    const outcome = lock(client, async () => "done").then(
      () => undefined,
      (error: unknown) => error,
    );

    await vi.advanceTimersByTimeAsync(timing.waitTimeoutMs + timing.pollIntervalMs);

    const error = await outcome;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("Timed out waiting");
    // One create and one read per poll interval, not a hot loop.
    expect(raw.getFunctionRegistry.mock.calls.length).toBeLessThanOrEqual(
      timing.waitTimeoutMs / timing.pollIntervalMs + 2,
    );
  });

  test("surfaces create failures other than a held lock", async () => {
    const { client, raw } = createRegistry();
    raw.createFunctionRegistry.mockRejectedValueOnce(
      new ConnectError("permission denied", Code.PermissionDenied),
    );

    await expect(lock(client, async () => "done")).rejects.toThrow("permission denied");
  });

  test("refreshes the held record on every heartbeat", async () => {
    const { client, entries } = createRegistry();

    await lock(client, async () => {
      const token = record(entries.get(lockName)!.description).token;
      await vi.advanceTimersByTimeAsync(timing.heartbeatIntervalMs * 2);
      const refreshed = record(entries.get(lockName)!.description);
      expect(refreshed.token).toBe(token);
      expect(refreshed.heartbeat).toBe(2);
    });
  });

  test("reports a takeover through assertHeld and leaves the new holder's entry alone", async () => {
    const { client, entries } = createRegistry();

    await lock(client, async (held) => {
      held.assertHeld();
      entries.set(lockName, { description: holderDescription({ token: "new-holder" }) });
      await vi.advanceTimersByTimeAsync(timing.heartbeatIntervalMs);
      expect(() => held.assertHeld()).toThrow(
        'Another deploy of "my-app" took over the deploy lock while this one was running',
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('The deploy lock of "my-app" was taken over by another deploy'),
      );
    });

    expect(record(entries.get(lockName)!.description).token).toBe("new-holder");
  });

  test("warns instead of failing when the lock cannot be released", async () => {
    const { client, raw } = createRegistry();
    raw.deleteFunctionRegistry.mockRejectedValueOnce(
      new ConnectError("unavailable", Code.Unavailable),
    );

    await expect(lock(client, async () => "done")).resolves.toBe("done");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Could not release the deploy lock of "my-app"'),
    );
  });

  test("locks every application once, in resource-name order, and releases all of them", async () => {
    const { client, entries, calls } = createRegistry();
    const apps = [
      { name: "zeta", id: "id-z" },
      { name: "alpha", id: "id-a" },
      { name: "alpha-renamed", id: "id-a" },
    ];
    const expectedNames = [...new Set(apps.map(deployLockResourceName))].toSorted();

    await withDeployLock({ client, workspaceId: "ws-1", applications: apps, timing }, async () => {
      expect([...entries.keys()].toSorted()).toEqual(expectedNames);
    });

    expect(calls.filter((call) => call.startsWith("create:"))).toEqual(
      expectedNames.map((name) => `create:${name}`),
    );
    expect(entries.size).toBe(0);
  });

  test("releases the locks already held when a later acquisition fails", async () => {
    const apps = [
      { name: "alpha", id: "id-a" },
      { name: "beta", id: "id-b" },
    ];
    const [first, second] = [...new Set(apps.map(deployLockResourceName))].toSorted();
    const { client, entries } = createRegistry({
      [second!]: { description: holderDescription() },
    });
    const shortWait = { ...timing, waitTimeoutMs: timing.pollIntervalMs * 2 };
    const pending = withDeployLock(
      { client, workspaceId: "ws-1", applications: apps, timing: shortWait },
      async () => "done",
    );
    const outcome = pending.then(
      () => undefined,
      (error: unknown) => error,
    );

    await vi.advanceTimersByTimeAsync(timing.pollIntervalMs * 4);

    const error = await outcome;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("Timed out waiting");
    expect(entries.has(first!)).toBe(false);
    expect(entries.has(second!)).toBe(true);
  });
});
