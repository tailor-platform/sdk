import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { buildResult, createResultWriter } from "./result";
import { createRunSession, type SessionSnapshot } from "./session";
import type { RunEvent, RunHandle } from "./run-types";
import type { RunRecord } from "./stream";

const paths = { file: ".tailor/studio/function.ts", argFile: ".tailor/studio/function.arg.json5" };

const entry = (seq: number, message: SessionSnapshot["entries"][number]["message"]) => ({
  seq,
  at: `2026-11-20T00:00:0${seq}.000Z`,
  message,
});

const runEntry = (seq: number, record: RunRecord) => ({
  ...entry(seq, { type: "run", record }),
  message: { type: "run" as const, record },
});

const snapshot = (overrides: Partial<SessionSnapshot> = {}): SessionSnapshot => ({
  status: "watching",
  running: false,
  workspace: { profile: "test", workspaceId: "ws-1" },
  entries: [],
  ...overrides,
});

const files = { changedAt: Date.parse("2026-11-20T00:00:09.000Z"), argError: undefined };

describe("buildResult", () => {
  test("names the state of the watch, the workspace and the files", () => {
    const result = buildResult({
      snapshot: snapshot({ status: "stopped", reason: "Stopped." }),
      files: { ...files, argError: "The argument is not valid JSON or JSON5." },
      paths,
      now: Date.parse("2026-11-20T00:01:00.000Z"),
    });

    expect(result).toMatchObject({
      status: "stopped",
      reason: "Stopped.",
      workspace: { profile: "test", workspaceId: "ws-1" },
      file: paths.file,
      argFile: paths.argFile,
      argError: "The argument is not valid JSON or JSON5.",
      inputsChangedAt: "2026-11-20T00:00:09.000Z",
      updatedAt: "2026-11-20T00:01:00.000Z",
    });
  });

  test("lists the entries newest first and keeps only the latest twenty", () => {
    const entries = Array.from({ length: 25 }, (_, i) =>
      entry(i + 1, { type: "note", text: `n${i + 1}` }),
    );

    const result = buildResult({ snapshot: snapshot({ entries }), files, paths, now: 0 });

    expect([result.entries.length, result.entries[0]?.seq, result.entries.at(-1)?.seq]).toEqual([
      20, 25, 6,
    ]);
  });

  test("puts the newest run at the top as latestRun, past the notes and failures that came after it", () => {
    const entries = [
      runEntry(1, { success: true, result: "3" }),
      runEntry(2, { success: true, result: "9" }),
      entry(3, { type: "note", text: "Ready!" }),
    ];

    const result = buildResult({
      snapshot: snapshot({ entries, latestRun: runEntry(2, { success: true, result: "9" }) }),
      files,
      paths,
      now: 0,
    });

    expect(result.latestRun).toMatchObject({ seq: 2, record: { result: "9" } });
  });

  test("serializes the snapshot's latestRun even when the bounded history no longer holds a run", () => {
    const latestRun = runEntry(1, { success: true, result: "3" });
    const entries = Array.from({ length: 25 }, (_, i) =>
      entry(i + 2, { type: "note", text: `n${i + 2}` }),
    );

    const result = buildResult({
      snapshot: snapshot({ entries, latestRun }),
      files,
      paths,
      now: 0,
    });

    expect(result.latestRun).toMatchObject({ seq: 1, type: "run", record: { result: "3" } });
  });

  test("has no latestRun before anything ran", () => {
    const result = buildResult({ snapshot: snapshot(), files, paths, now: 0 });

    expect(result.latestRun).toBeNull();
  });

  test("reads the TailorErrors of a failed run into argErrors with their paths", () => {
    const error = `rpc error: code = Aborted desc = TailorErrors: ${JSON.stringify({
      errors: [{ message: "Expected an integer: received x", path: ["a"] }],
    })}\n    at <eval>:1:1`;
    const failed = runEntry(1, { success: false, error });
    const entries = [failed];

    const result = buildResult({
      snapshot: snapshot({ entries, latestRun: failed }),
      files,
      paths,
      now: 0,
    });

    expect(result.latestRun?.argErrors).toEqual([
      { message: "Expected an integer: received x", path: ["a"] },
    ]);
  });
});

describe("createResultWriter", () => {
  let base: string;
  let dir: string;

  beforeAll(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "studio-result-")));
  });
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(base, "case-"));
  });
  afterAll(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  function setup() {
    const queue: RunEvent[] = [];
    let wake: (() => void) | undefined;
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
      stop: vi.fn(),
      exited: Promise.resolve(),
    };
    const push = (event: RunEvent) => {
      queue.push(event);
      wake?.();
    };
    const session = createRunSession({
      startRun: () => handle,
      file: "f",
      runArgFile: "a",
      getSelection: () => ({ workspaceId: "ws-1" }),
    });
    const target = path.join(dir, "out", "function.result.json");
    const writer = createResultWriter({
      file: target,
      session,
      files: { status: () => files },
      paths,
    });
    const read = () => JSON.parse(fs.readFileSync(target, "utf8"));
    return { session, push, writer, target, read };
  }

  test("writes the state when it starts, before anything has run", () => {
    const { writer, read } = setup();

    writer.start();

    expect(read()).toMatchObject({ status: "idle", entries: [], latestRun: null });
    writer.close();
  });

  test("rewrites the file as the run prints and leaves no temporary file behind", async () => {
    const { session, push, writer, target, read } = setup();
    writer.start();

    session.start();
    push({ type: "finished", record: { success: true, result: "3" } });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(read()).toMatchObject({ status: "watching", latestRun: { record: { result: "3" } } });
    expect(fs.readdirSync(path.dirname(target))).toEqual(["function.result.json"]);
    writer.close();
  });

  test("notes the failure when the watch could not start", () => {
    const { session, writer, read } = setup();
    writer.start();

    session.fail("Select a workspace in the bar at the top of the page.");

    expect(read()).toMatchObject({
      status: "stopped",
      reason: "Select a workspace in the bar at the top of the page.",
      entries: [{ type: "failure" }],
    });
    writer.close();
  });
});
