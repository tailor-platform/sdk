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

    expect(startRun).toHaveBeenCalledWith({
      file: "/p/function.ts",
      argFile: "/tmp/arg.json",
      workspaceArgs: ["-p", "test", "-w", "ws-1"],
    });
  });

  test("announces a reset and that it is watching", () => {
    const { session, events } = setup();

    session.start();

    expect(events).toEqual([{ type: "reset" }, { type: "status", status: "watching" }]);
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
    run.push({ type: "stderr", line: "old" });
    await settle();
    session.stop();

    session.start();

    expect(session.snapshot().entries).toEqual([]);
  });
});

describe("what the run prints", () => {
  test("turns each line into an entry with a sequence number and a time", async () => {
    const { session, run, events } = setup();
    session.start();

    run.push({ type: "stdout", line: '{"success":true,"result":"3"}' });
    run.push({ type: "stderr", line: '{"error":{"message":"boom"}}' });
    run.push({ type: "stderr", line: "Ready! Running f.ts" });
    await settle();

    const entries = session.snapshot().entries;
    expect(entries.map((entry) => [entry.seq, entry.message])).toEqual([
      [1, { type: "run", record: { success: true, result: "3" } }],
      [2, { type: "failure", text: "boom" }],
      [3, { type: "note", text: "Ready! Running f.ts" }],
    ]);
    expect(entries.every((entry) => !Number.isNaN(Date.parse(entry.at)))).toBe(true);
    expect(events.filter((event) => event.type === "entry")).toHaveLength(3);
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

    for (const line of ["one", "two", "three"]) run.push({ type: "stderr", line });
    await settle();

    expect(session.snapshot().entries.map((entry) => entry.seq)).toEqual([2, 3]);
  });
});

describe("stop", () => {
  test("stops the process and ignores what it prints afterwards", async () => {
    const { session, run, events } = setup();
    session.start();

    session.stop();
    run.push({ type: "stderr", line: "late" });
    await settle();

    expect([
      run.stop.mock.calls.length,
      session.snapshot().status,
      session.snapshot().entries,
    ]).toEqual([1, "stopped", []]);
    expect(events.at(-1)).toEqual({ type: "status", status: "stopped", reason: "Stopped." });
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
  test("stops the watch when the selected workspace changes, and says which one it ran on", () => {
    const { session, run, select } = setup();
    session.start();

    select({ profile: "dev", workspaceId: "ws-2" });
    session.checkSelection();

    expect([
      run.stop.mock.calls.length,
      session.snapshot().status,
      session.snapshot().reason,
    ]).toEqual([
      1,
      "stopped",
      "The selected workspace changed (ws-1 to ws-2), so the watch was stopped. Press Run to run on ws-2.",
    ]);
  });

  test("leaves the watch alone while the selection stays the same", () => {
    const { session, run } = setup();
    session.start();

    session.checkSelection();

    expect([run.stop.mock.calls.length, session.snapshot().status]).toEqual([0, "watching"]);
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
