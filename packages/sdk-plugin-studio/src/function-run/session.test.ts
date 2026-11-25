import { describe, expect, test, vi } from "vitest";
import { createRunSession, type SessionEvent } from "./session";
import type { RunEvent, RunHandle, RunInput } from "./run-types";

function controllableRun() {
  const queue: RunEvent[] = [];
  let wake: (() => void) | undefined;
  const stop = vi.fn(() => push({ type: "exit", code: null }));
  const push = (event: RunEvent) => {
    queue.push(event);
    wake?.();
  };
  const handle: RunHandle = {
    events: (async function* () {
      for (;;) {
        const event = queue.shift();
        if (event === undefined) {
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          continue;
        }
        yield event;
        if (event.type === "exit") return;
      }
    })(),
    stop,
  };
  return { handle, push, stop };
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function setup(
  selection: { profile?: string; workspaceId?: string } = { profile: "test", workspaceId: "ws-1" },
) {
  const run = controllableRun();
  const startRun = vi.fn((_input: RunInput) => run.handle);
  let current = selection;
  const session = createRunSession({
    startRun,
    file: "/p/function.ts",
    runArgFile: "/tmp/arg.json",
    getSelection: () => current,
  });
  const events: SessionEvent[] = [];
  session.subscribe((event) => events.push(event));
  return {
    session,
    run,
    startRun,
    events,
    select: (next: { profile?: string; workspaceId?: string }) => {
      current = next;
    },
  };
}

describe("start", () => {
  test("asks for a workspace and starts nothing while none is selected", () => {
    const { session, startRun } = setup({});

    expect([session.start(), startRun.mock.calls.length, session.snapshot().status]).toEqual([
      { ok: false, reason: "Select a workspace in the bar at the top of the page." },
      0,
      "idle",
    ]);
  });

  test("runs the file with its argument file against the selected workspace", () => {
    const { session, startRun } = setup();

    session.start();

    expect(startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        file: "/p/function.ts",
        argFile: "/tmp/arg.json",
        workspace: { profile: "test", workspaceId: "ws-1" },
      }),
    );
  });

  test("announces a reset and that it is watching", () => {
    const { session, events } = setup();

    session.start();

    expect(events).toEqual([
      { type: "reset" },
      { type: "status", status: "watching", running: true },
    ]);
  });

  test("does nothing when it is already watching", () => {
    const { session, startRun } = setup();
    session.start();

    expect([session.start(), startRun.mock.calls.length]).toEqual([{ ok: true }, 1]);
  });

  test("records the failure and stops when the run cannot be started", () => {
    const run = controllableRun();
    const session = createRunSession({
      startRun: () => {
        throw new Error("cannot find the tailor CLI");
      },
      file: "f",
      runArgFile: "a",
      getSelection: () => ({ workspaceId: "ws" }),
    });
    void run;

    const result = session.start();

    expect([result, session.snapshot().status, session.snapshot().entries[0]?.message]).toEqual([
      { ok: false, reason: "cannot find the tailor CLI" },
      "stopped",
      { type: "failure", text: "cannot find the tailor CLI" },
    ]);
  });

  test("clears what the previous watch showed", async () => {
    const { session, run } = setup();
    session.start();
    run.push({ type: "note", text: "old" });
    await settle();
    session.stop();

    session.start();

    expect(session.snapshot().entries).toEqual([]);
  });
});

describe("what the run reports", () => {
  test("turns a run, a failure and a note into entries with a sequence number and a time", async () => {
    const { session, run, events } = setup();
    session.start();

    run.push({ type: "started" });
    run.push({ type: "finished", record: { success: true, result: "3" } });
    run.push({ type: "failed", text: "boom" });
    run.push({ type: "note", text: "a warning" });
    await settle();

    const entries = session.snapshot().entries;
    expect(entries.map((entry) => [entry.seq, entry.message])).toEqual([
      [1, { type: "run", record: { success: true, result: "3" } }],
      [2, { type: "failure", text: "boom" }],
      [3, { type: "note", text: "a warning" }],
    ]);
    expect(entries.every((entry) => !Number.isNaN(Date.parse(entry.at)))).toBe(true);
    expect(events.filter((event) => event.type === "entry")).toHaveLength(3);
  });

  test("notes that the watch is ready", async () => {
    const { session, run } = setup();
    session.start();

    run.push({ type: "ready" });
    await settle();

    expect(session.snapshot().entries.map((entry) => entry.message)).toEqual([
      { type: "note", text: "Ready! Running function.ts on every save." },
    ]);
  });

  test("keeps only the newest entries", async () => {
    const run = controllableRun();
    const session = createRunSession({
      startRun: () => run.handle,
      file: "f",
      runArgFile: "a",
      getSelection: () => ({ workspaceId: "ws" }),
      maxEntries: 2,
    });
    session.start();

    for (const text of ["one", "two", "three"]) run.push({ type: "note", text });
    await settle();

    expect(session.snapshot().entries.map((entry) => entry.seq)).toEqual([2, 3]);
  });
});

describe("running", () => {
  const finished = { type: "finished", record: { success: true, result: "1" } } as const;

  test("is true from the start until the first run reports back", async () => {
    const { session, run } = setup();

    session.start();
    const before = session.snapshot().running;
    run.push({ type: "ready" });
    run.push({ type: "started" });
    await settle();
    const during = session.snapshot().running;
    run.push(finished);
    await settle();

    expect([before, during, session.snapshot().running]).toEqual([true, true, false]);
  });

  test("turns true when a file change is scheduled, and false when the run it starts reports back", async () => {
    const { session, run } = setup();
    session.start();
    run.push({ type: "started" });
    run.push(finished);
    await settle();

    run.push({ type: "scheduled" });
    await settle();
    const scheduled = session.snapshot().running;
    run.push({ type: "started" });
    await settle();
    const started = session.snapshot().running;
    run.push(finished);
    await settle();

    expect([scheduled, started, session.snapshot().running]).toEqual([true, true, false]);
  });

  test("stays true through the run a change queues behind a run in flight, until that run reports back", async () => {
    const { session, run } = setup();
    session.start();
    run.push({ type: "started" });
    run.push({ type: "scheduled" });
    run.push({ type: "queued" });
    run.push(finished);
    await settle();
    const betweenRuns = session.snapshot().running;
    run.push({ type: "started" });
    await settle();
    run.push(finished);
    await settle();

    expect([betweenRuns, session.snapshot().running]).toEqual([true, false]);
  });

  test("counts any number of changes during a run as one more run", async () => {
    const { session, run } = setup();
    session.start();
    run.push({ type: "started" });
    run.push({ type: "scheduled" });
    run.push({ type: "queued" });
    run.push({ type: "scheduled" });
    run.push(finished);
    run.push({ type: "started" });
    run.push(finished);
    await settle();

    expect(session.snapshot().running).toBe(false);
  });

  test("is true again for a change that arrives while the queued run is the one in flight", async () => {
    const { session, run } = setup();
    session.start();
    run.push({ type: "started" });
    run.push(finished);
    run.push({ type: "scheduled" });
    run.push({ type: "started" });
    run.push({ type: "scheduled" });
    run.push({ type: "queued" });
    run.push(finished);
    await settle();

    expect(session.snapshot().running).toBe(true);
  });

  test("is false after a run fails, since a failure ends the run like a result does", async () => {
    const { session, run } = setup();
    session.start();
    run.push({ type: "started" });
    run.push({ type: "failed", text: "boom" });
    await settle();

    expect(session.snapshot().running).toBe(false);
  });

  test("announces each change of running once", async () => {
    const { session, run, events } = setup();
    session.start();
    events.length = 0;

    run.push({ type: "started" });
    run.push({ type: "scheduled" });
    run.push(finished);
    run.push({ type: "started" });
    run.push(finished);
    await settle();

    expect(events.filter((event) => event.type === "status")).toEqual([
      { type: "status", status: "watching", running: false },
    ]);
  });

  test("is false once the watch is stopped", () => {
    const { session } = setup();
    session.start();

    session.stop();

    expect(session.snapshot().running).toBe(false);
  });
});

describe("latestRun", () => {
  test("is the newest run, kept after the bounded entries have moved past it", async () => {
    const run = controllableRun();
    const session = createRunSession({
      startRun: () => run.handle,
      file: "f",
      runArgFile: "a",
      getSelection: () => ({ workspaceId: "ws" }),
      maxEntries: 2,
    });
    session.start();

    run.push({ type: "finished", record: { success: true, result: "3" } });
    for (const text of ["one", "two", "three"]) run.push({ type: "note", text });
    await settle();

    expect([
      session.snapshot().entries.map((entry) => entry.seq),
      session.snapshot().latestRun?.message,
    ]).toEqual([[3, 4], { type: "run", record: { success: true, result: "3" } }]);
  });

  test("is cleared when a new watch starts", async () => {
    const { session, run } = setup();
    session.start();
    run.push({ type: "finished", record: { success: true, result: "3" } });
    await settle();
    session.stop();

    session.start();

    expect(session.snapshot().latestRun).toBeUndefined();
  });
});

describe("stop", () => {
  test("stops the process and ignores what it prints afterwards", async () => {
    const { session, run, events } = setup();
    session.start();

    session.stop();
    run.push({ type: "note", text: "late" });
    await settle();

    expect([
      run.stop.mock.calls.length,
      session.snapshot().status,
      session.snapshot().entries,
    ]).toEqual([1, "stopped", []]);
    expect(events.at(-1)).toEqual({
      type: "status",
      status: "stopped",
      running: false,
      reason: "Stopped.",
    });
  });

  test("lets the watch be started again", () => {
    const { session, startRun } = setup();
    session.start();
    session.stop();

    session.start();

    expect(startRun).toHaveBeenCalledTimes(2);
  });
});

describe("when the process ends by itself", () => {
  test("says so and stops watching", async () => {
    const { session, run } = setup();
    session.start();

    run.push({ type: "exit", code: 1 });
    await settle();

    expect([
      session.snapshot().status,
      session.snapshot().reason,
      session.snapshot().entries.at(-1)?.message,
    ]).toEqual([
      "stopped",
      "The watch ended (exit code 1).",
      { type: "note", text: "The watch ended (exit code 1)." },
    ]);
  });
});

describe("checkSelection", () => {
  test("restarts the watch on the newly selected workspace and notes the change", () => {
    const { session, run, select, startRun } = setup();
    session.start();

    select({ profile: "dev", workspaceId: "ws-2" });
    session.checkSelection();

    expect([
      run.stop.mock.calls.length,
      startRun.mock.calls.map(([input]) => input.workspace),
      session.snapshot().status,
      session.snapshot().entries.map((entry) => entry.message),
    ]).toEqual([
      1,
      [
        { profile: "test", workspaceId: "ws-1" },
        { profile: "dev", workspaceId: "ws-2" },
      ],
      "watching",
      [
        {
          type: "note",
          text: "The selected workspace changed (test to dev); the watch was restarted on dev.",
        },
      ],
    ]);
  });

  test("stops the watch and says why when the selection is cleared", () => {
    const { session, select, startRun } = setup();
    session.start();

    select({});
    session.checkSelection();

    expect([
      startRun.mock.calls.length,
      session.snapshot().status,
      session.snapshot().reason,
    ]).toEqual([
      1,
      "stopped",
      "The selected workspace changed (test to no workspace), so the watch was stopped. Select a workspace in the bar at the top of the page.",
    ]);
  });

  test("leaves the watch alone while the selection stays the same", () => {
    const { session, run } = setup();
    session.start();

    session.checkSelection();

    expect([run.stop.mock.calls.length, session.snapshot().status]).toEqual([0, "watching"]);
  });
});

describe("environment of the watch", () => {
  test("leaves out the inherited credentials while a profile is selected", () => {
    vi.stubEnv("TAILOR_PLATFORM_TOKEN", "startup-user-token");
    try {
      const { session, startRun } = setup();

      session.start();

      expect(startRun.mock.calls[0]![0].env.TAILOR_PLATFORM_TOKEN).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("fail", () => {
  test("records a failure and marks the session stopped", () => {
    const { session } = setup();

    session.fail("Select a workspace in the bar at the top of the page.");

    expect([session.snapshot().status, session.snapshot().entries[0]?.message]).toEqual([
      "stopped",
      { type: "failure", text: "Select a workspace in the bar at the top of the page." },
    ]);
  });
});

describe("snapshot", () => {
  test("names the workspace the watch runs against", () => {
    const { session } = setup();
    session.start();

    expect(session.snapshot().workspace).toEqual({ profile: "test", workspaceId: "ws-1" });
  });
});
