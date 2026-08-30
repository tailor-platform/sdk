import { Code, ConnectError } from "@connectrpc/connect";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { bypassConcurrencyLimit } from "#/cli/shared/client";
import { logger } from "#/cli/shared/logger";
import { deployLockNamePrefix, deployLockResourceName, withDeployLock } from "./deploy-lock";
import { DeployLockLostError } from "./deploy-lock-error";
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

interface ListRequest {
  filter?: { condition?: { value?: { kind?: { value?: unknown } } } };
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
  return JSON.parse(description) as {
    state: "held" | "released";
    token?: string;
    heartbeat?: number;
    application: string;
  };
}

// In-memory function registry with the create-only semantics the lock relies
// on and the name filter it lists generations with.
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
    listFunctionRegistries: vi.fn(async (request: ListRequest) => {
      const needle = String(request.filter?.condition?.value?.kind?.value ?? "");
      calls.push(`list:${needle}`);
      return {
        functions: [...entries]
          .filter(([name]) => name.includes(needle))
          .map(([name, entry]) => ({ name, description: entry.description })),
        nextPageToken: "",
      };
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

function heldDescription(overrides: Partial<{ token: string; heartbeat: number }> = {}) {
  return JSON.stringify({
    v: 2,
    state: "held",
    token: overrides.token ?? "other-token",
    application: "my-app",
    holder: { host: "ci-runner", pid: 42, startedAt: "2026-08-29T00:00:00.000Z" },
    heartbeat: overrides.heartbeat ?? 0,
  });
}

const releasedDescription = JSON.stringify({ v: 2, state: "released", application: "my-app" });

const app = { name: "my-app" };
const prefix = deployLockNamePrefix(app);
const gen = (generation: number) => deployLockResourceName(app, generation);
const timing = {
  pollIntervalMs: 1_000,
  waitTimeoutMs: 60_000,
  heartbeatIntervalMs: 5_000,
  leaseMs: 10_000,
};

function lock<T>(client: OperatorClient, fn: (lock: { assertHeld(): void }) => Promise<T>) {
  return withDeployLock({ client, workspaceId: "ws-1", applications: [app], timing }, fn);
}

function generations(entries: Map<string, Entry>): string[] {
  return [...entries.keys()]
    .filter((name) => name.startsWith(prefix))
    .map((name) => `${name.slice(prefix.length)}:${record(entries.get(name)!.description).state}`)
    .toSorted();
}

describe("deployLockResourceName", () => {
  test("is keyed by the application id when one is declared", () => {
    expect(deployLockNamePrefix({ name: "old-name", id: "app-1" })).toBe(
      deployLockNamePrefix({ name: "new-name", id: "app-1" }),
    );
    expect(deployLockNamePrefix({ name: "my-app", id: "app-1" })).not.toBe(
      deployLockNamePrefix({ name: "my-app", id: "app-2" }),
    );
  });

  test("falls back to the name and appends a zero-padded generation", () => {
    const name = deployLockResourceName({ name: "My App with spaces / and more characters" }, 7);
    expect(name).toMatch(/^sdk-deploy-lock--[0-9a-f]{16}--000007$/);
    expect(name).not.toBe(deployLockResourceName({ name: "another" }, 7));
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

  test("creates the first generation around the critical section and leaves it released", async () => {
    const { client, raw, entries } = createRegistry();

    const result = await lock(client, async () => {
      expect(generations(entries)).toEqual(["000001:held"]);
      expect(record(entries.get(gen(1))!.description).application).toBe("my-app");
      return "done";
    });

    expect(result).toBe("done");
    expect(generations(entries)).toEqual(["000001:released"]);
    // The released record identifies nothing about the run that held it.
    expect(record(entries.get(gen(1))!.description).token).toBeUndefined();
    // The entries must stay unlabeled so a deploy does not plan its own lock for deletion.
    expect(raw.setMetadata).not.toHaveBeenCalled();
  });

  test("lock RPCs bypass the apply concurrency limiter", async () => {
    const { client, raw } = createRegistry();

    await lock(client, async () => "done");

    for (const call of raw.listFunctionRegistries.mock.calls) {
      const options = (call as unknown[])[1] as {
        contextValues: { get(key: typeof bypassConcurrencyLimit): boolean };
      };
      expect(options.contextValues.get(bypassConcurrencyLimit)).toBe(true);
    }
  });

  test("takes the next generation after a released one and removes the superseded entry", async () => {
    const { client, entries } = createRegistry({ [gen(1)]: { description: releasedDescription } });

    await lock(client, async () => {
      expect(generations(entries)).toEqual(["000002:held"]);
    });

    expect(generations(entries)).toEqual(["000002:released"]);
  });

  test("releases the lock and rethrows when the critical section fails", async () => {
    const { client, entries } = createRegistry();

    await expect(
      lock(client, async () => {
        throw new Error("apply failed");
      }),
    ).rejects.toThrow("apply failed");

    expect(generations(entries)).toEqual(["000001:released"]);
  });

  test("waits for a live holder and proceeds once it releases", async () => {
    const { client, entries } = createRegistry({ [gen(1)]: { description: heldDescription() } });
    const fn = vi.fn(async () => "done");
    const pending = lock(client, fn);

    await vi.advanceTimersByTimeAsync(timing.pollIntervalMs * 3);
    entries.set(gen(1), { description: heldDescription({ heartbeat: 1 }) });
    await vi.advanceTimersByTimeAsync(timing.pollIntervalMs * 3);
    expect(fn).not.toHaveBeenCalled();
    entries.set(gen(1), { description: releasedDescription });
    await vi.advanceTimersByTimeAsync(timing.pollIntervalMs);

    await expect(pending).resolves.toBe("done");
    expect(generations(entries)).toEqual(["000002:released"]);
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Another deploy of "my-app" is in progress'),
    );
  });

  test("reclaims a holder whose record stayed unchanged for a whole lease", async () => {
    const { client, entries, calls } = createRegistry({
      [gen(1)]: { description: heldDescription({ token: "dead" }) },
    });
    const fn = vi.fn(async () => "done");
    const pending = lock(client, fn);

    await vi.advanceTimersByTimeAsync(timing.leaseMs - timing.pollIntervalMs);
    expect(fn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(timing.pollIntervalMs * 2);

    await expect(pending).resolves.toBe("done");
    // The stale generation is never deleted before the next one exists.
    expect(calls.indexOf(`create:${gen(2)}`)).toBeLessThan(calls.indexOf(`delete:${gen(1)}`));
    expect(generations(entries)).toEqual(["000002:released"]);
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Reclaiming the deploy lock of "my-app"'),
    );
  });

  test("does not reclaim a holder whose heartbeat keeps changing", async () => {
    const { client, entries, calls } = createRegistry({
      [gen(1)]: { description: heldDescription() },
    });
    const pending = lock(client, async () => "done");

    for (let heartbeat = 1; heartbeat <= 4; heartbeat++) {
      await vi.advanceTimersByTimeAsync(timing.leaseMs / 2);
      entries.set(gen(1), { description: heldDescription({ heartbeat }) });
    }
    expect(calls).not.toContain(`create:${gen(2)}`);

    entries.set(gen(1), { description: releasedDescription });
    await vi.advanceTimersByTimeAsync(timing.pollIntervalMs);
    await expect(pending).resolves.toBe("done");
  });

  test("lets exactly one of two reclaimers take an abandoned lock", async () => {
    const { client, entries } = createRegistry({
      [gen(1)]: { description: heldDescription({ token: "dead" }) },
    });
    const events: string[] = [];
    const contender = (label: string) =>
      lock(client, async () => {
        events.push(`${label}:start ${generations(entries).join(",")}`);
        await vi.advanceTimersByTimeAsync(timing.pollIntervalMs * 2);
        events.push(`${label}:end`);
      });
    const a = contender("a");
    const b = contender("b");

    await vi.advanceTimersByTimeAsync(timing.leaseMs + timing.pollIntervalMs * 10);
    await Promise.all([a, b]);

    // One took generation 2 while the other waited for it and then took 3.
    expect(events.map((event) => event.split(" ")[0])).toEqual(
      expect.arrayContaining(["a:start", "a:end", "b:start", "b:end"]),
    );
    const starts = events.filter((event) => event.includes(":start"));
    expect(events.indexOf(events.find((e) => e.endsWith(":end"))!)).toBeLessThan(
      events.indexOf(starts[1]!),
    );
    expect(generations(entries)).toEqual(["000003:released"]);
  });

  test("serializes two contenders for a free lock", async () => {
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

    await vi.advanceTimersByTimeAsync(timing.pollIntervalMs * 6);
    await Promise.all([first, second]);

    expect(events).toEqual(["first:start", "first:end", "second:start"]);
  });

  test("treats an unreadable record as a holder and reclaims it once it stops changing", async () => {
    const { client, entries, calls } = createRegistry({
      [gen(1)]: { description: '{"v":3,"beat":0}' },
    });
    const pending = lock(client, async () => "done");

    await vi.advanceTimersByTimeAsync(timing.leaseMs / 2);
    entries.set(gen(1), { description: '{"v":3,"beat":1}' });
    await vi.advanceTimersByTimeAsync(timing.leaseMs / 2);
    expect(calls).not.toContain(`create:${gen(2)}`);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("holder record unreadable"));

    await vi.advanceTimersByTimeAsync(timing.leaseMs);
    await expect(pending).resolves.toBe("done");
    expect(generations(entries)).toEqual(["000002:released"]);
  });

  test("gives up with the holder's identity after the wait timeout", async () => {
    const { client, entries, calls } = createRegistry({
      [gen(1)]: { description: heldDescription() },
    });
    let heartbeat = 0;
    const outcome = lock(client, async () => "done").then(
      () => undefined,
      (error: unknown) => error,
    );

    for (let elapsed = 0; elapsed <= timing.waitTimeoutMs; elapsed += timing.pollIntervalMs) {
      heartbeat += 1;
      entries.set(gen(1), { description: heldDescription({ heartbeat }) });
      await vi.advanceTimersByTimeAsync(timing.pollIntervalMs);
    }

    const error = await outcome;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('Timed out waiting for another deploy of "my-app"');
    expect((error as Error).message).toContain("started 2026-08-29T00:00:00.000Z on ci-runner");
    expect(calls).not.toContain(`create:${gen(2)}`);
  });

  test("surfaces create failures other than a taken generation", async () => {
    const { client, raw } = createRegistry();
    raw.createFunctionRegistry.mockRejectedValueOnce(
      new ConnectError("permission denied", Code.PermissionDenied),
    );

    await expect(lock(client, async () => "done")).rejects.toThrow("permission denied");
  });

  test("refreshes the held record on every heartbeat", async () => {
    const { client, entries } = createRegistry();

    await lock(client, async () => {
      const token = record(entries.get(gen(1))!.description).token;
      await vi.advanceTimersByTimeAsync(timing.heartbeatIntervalMs * 2);
      const refreshed = record(entries.get(gen(1))!.description);
      expect(refreshed.token).toBe(token);
      expect(refreshed.heartbeat).toBe(2);
    });
  });

  test("stops once a higher generation appears and still releases its own", async () => {
    const { client, entries } = createRegistry();

    await lock(client, async (held) => {
      held.assertHeld();
      entries.set(gen(2), { description: heldDescription({ token: "new-holder" }) });
      await vi.advanceTimersByTimeAsync(timing.heartbeatIntervalMs);
      expect(() => held.assertHeld()).toThrow(DeployLockLostError);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('The deploy lock of "my-app" was taken over'),
      );
    });

    // Its own generation is marked released; the new holder's is untouched.
    expect(generations(entries)).toEqual(["000001:released", "000002:held"]);
    expect(record(entries.get(gen(2))!.description).token).toBe("new-holder");
  });

  test("stops when its lease ran out without a confirmed refresh, but still releases", async () => {
    const { client, raw, entries } = createRegistry();

    await lock(client, async (held) => {
      raw.listFunctionRegistries.mockRejectedValue(
        new ConnectError("unavailable", Code.Unavailable),
      );
      await vi.advanceTimersByTimeAsync(timing.leaseMs - timing.heartbeatIntervalMs);
      expect(() => held.assertHeld()).not.toThrow();
      await vi.advanceTimersByTimeAsync(timing.heartbeatIntervalMs * 2);
      expect(() => held.assertHeld()).toThrow(DeployLockLostError);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("could not be refreshed for over 10 seconds"),
      );
    });

    expect(generations(entries)).toEqual(["000001:released"]);
  });

  test("keeps the lock through a transient heartbeat failure", async () => {
    const { client, raw, entries } = createRegistry();

    await lock(client, async (held) => {
      raw.listFunctionRegistries.mockRejectedValueOnce(
        new ConnectError("unavailable", Code.Unavailable),
      );
      await vi.advanceTimersByTimeAsync(timing.heartbeatIntervalMs * 2);
      expect(() => held.assertHeld()).not.toThrow();
      expect(record(entries.get(gen(1))!.description).heartbeat).toBe(1);
    });

    expect(logger.warn).not.toHaveBeenCalled();
  });

  test("warns instead of failing when the lock cannot be released", async () => {
    const { client, raw } = createRegistry();
    raw.updateFunctionRegistry.mockRejectedValueOnce(
      new ConnectError("unavailable", Code.Unavailable),
    );

    await expect(lock(client, async () => "done")).resolves.toBe("done");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Could not release the deploy lock of "my-app"'),
    );
  });

  test("holds the name-based lock alongside the id-based one", async () => {
    const withId = { name: "my-app", id: "app-1" };
    const { client, entries } = createRegistry();

    await withDeployLock(
      { client, workspaceId: "ws-1", applications: [withId], timing },
      async () => {
        // A checkout whose config has no id yet locks by name only; it must
        // still contend with this deploy.
        expect(entries.has(deployLockResourceName({ name: "my-app" }, 1))).toBe(true);
        expect(entries.has(deployLockResourceName(withId, 1))).toBe(true);
      },
    );

    for (const entry of entries.values()) {
      expect(record(entry.description).state).toBe("released");
    }
  });

  test("locks every application once, in name order, and releases all of them", async () => {
    const { client, entries, calls } = createRegistry();
    const apps = [
      { name: "zeta", id: "id-z" },
      { name: "alpha", id: "id-a" },
      { name: "alpha-renamed", id: "id-a" },
    ];
    const expectedNames = [
      ...new Set(
        apps.flatMap((entry) => [
          deployLockResourceName({ name: entry.name }, 1),
          deployLockResourceName(entry, 1),
        ]),
      ),
    ].toSorted();

    await withDeployLock({ client, workspaceId: "ws-1", applications: apps, timing }, async () => {
      expect([...entries.keys()].toSorted()).toEqual(expectedNames);
    });

    expect(calls.filter((call) => call.startsWith("create:"))).toEqual(
      expectedNames.map((name) => `create:${name}`),
    );
    for (const entry of entries.values()) {
      expect(record(entry.description).state).toBe("released");
    }
  });

  test("releases the locks already held when a later acquisition fails", async () => {
    const apps = [
      { name: "alpha", id: "id-a" },
      { name: "beta", id: "id-b" },
    ];
    const [first, second] = [
      ...new Set(
        apps.flatMap((entry) => [
          deployLockNamePrefix({ name: entry.name }),
          deployLockNamePrefix(entry),
        ]),
      ),
    ].toSorted();
    const { client, entries } = createRegistry({
      [`${second!}000001`]: { description: heldDescription() },
    });
    const shortWait = { ...timing, waitTimeoutMs: timing.pollIntervalMs * 2 };
    const outcome = withDeployLock(
      { client, workspaceId: "ws-1", applications: apps, timing: shortWait },
      async () => "done",
    ).then(
      () => undefined,
      (error: unknown) => error,
    );

    await vi.advanceTimersByTimeAsync(timing.pollIntervalMs * 4);

    const error = await outcome;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("Timed out waiting");
    expect(record(entries.get(`${first!}000001`)!.description).state).toBe("released");
    expect(record(entries.get(`${second!}000001`)!.description).state).toBe("held");
  });
});
