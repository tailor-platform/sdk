import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { startWatchWorker } from "./watch-worker";
import type { RunEvent, RunInput } from "./run-types";

let dir: string;

beforeAll(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "studio-worker-")));
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const input: RunInput = {
  file: "/p/function.ts",
  argFile: "/tmp/arg.json",
  workspace: { profile: "dev", workspaceId: "ws-1" },
  env: { PATH: process.env.PATH, KEPT: "yes" },
};

function workerFile(name: string, code: string): string {
  const file = path.join(dir, `${name}.mjs`);
  fs.writeFileSync(file, code);
  return file;
}

async function collect(events: AsyncIterable<RunEvent>): Promise<RunEvent[]> {
  const all: RunEvent[] = [];
  for await (const event of events) all.push(event);
  return all;
}

describe("startWatchWorker", () => {
  test("turns what the watch reports into run events, then the exit code", async () => {
    const file = workerFile(
      "reports",
      `import { parentPort } from "node:worker_threads";
for (const message of [
  { type: "ready", argFile: "/tmp/arg.json" },
  { type: "scheduled" },
  { type: "queued" },
  { type: "started" },
  { type: "finished", record: { success: true, result: "3", executionId: "e1" } },
  { type: "failed", error: { error: { message: "boom", suggestion: "Retry." } } },
  { type: "start-failed", message: "no workspace" },
]) parentPort.postMessage(message);`,
    );

    const events = await collect(startWatchWorker(input, { workerFile: file }).events);

    expect(events).toEqual([
      { type: "ready" },
      { type: "scheduled" },
      { type: "queued" },
      { type: "started" },
      { type: "finished", record: { success: true, result: "3", executionId: "e1" } },
      { type: "failed", text: "boom\nRetry." },
      { type: "failed", text: "no workspace" },
      { type: "exit", code: 0 },
    ]);
  });

  test("hands the worker the function, the argument file and the workspace, and its own environment", async () => {
    const file = workerFile(
      "input",
      `import { workerData } from "node:worker_threads";
console.log(JSON.stringify({ workerData, kept: process.env.KEPT, home: process.env.HOME ?? null }));`,
    );

    const events = await collect(startWatchWorker(input, { workerFile: file }).events);

    const note = events.find((event) => event.type === "note");
    expect(JSON.parse(note && "text" in note ? note.text : "null")).toEqual({
      workerData: {
        file: "/p/function.ts",
        argFile: "/tmp/arg.json",
        profile: "dev",
        workspaceId: "ws-1",
      },
      kept: "yes",
      home: null,
    });
  });

  test("shows each line the worker prints, on stdout or stderr, as a note", async () => {
    const file = workerFile(
      "lines",
      `console.log("one\\ntwo");
console.error("warn");`,
    );

    const events = await collect(startWatchWorker(input, { workerFile: file }).events);

    expect(events).toEqual(
      expect.arrayContaining([
        { type: "note", text: "one" },
        { type: "note", text: "two" },
        { type: "note", text: "warn" },
      ]),
    );
  });

  test("ends only the watch when the code the worker loads calls process.exit", async () => {
    const file = workerFile("exits", "process.exit(3);");

    const events = await collect(startWatchWorker(input, { workerFile: file }).events);

    expect(events.at(-1)).toEqual({ type: "exit", code: 3 });
  });

  test("reports an uncaught error as a note, then the exit", async () => {
    const file = workerFile("throws", `throw new Error("cannot load config");`);

    const events = await collect(startWatchWorker(input, { workerFile: file }).events);

    expect(events).toEqual([
      { type: "note", text: "cannot load config" },
      { type: "exit", code: 1 },
    ]);
  });

  test("asks the worker to stop, and ends once it does", async () => {
    const file = workerFile(
      "stops",
      `import { parentPort } from "node:worker_threads";
parentPort.on("message", (message) => { if (message.type === "stop") process.exit(0); });
parentPort.postMessage({ type: "ready", argFile: "a" });`,
    );
    const run = startWatchWorker(input, { workerFile: file });
    const seen: RunEvent[] = [];
    const done = (async () => {
      for await (const event of run.events) {
        seen.push(event);
        if (event.type === "ready") run.stop();
      }
    })();

    await done;

    expect(seen).toEqual([{ type: "ready" }, { type: "exit", code: 0 }]);
  });

  test("terminates a worker that does not stop in time", async () => {
    const file = workerFile(
      "stuck",
      `import { parentPort } from "node:worker_threads";
parentPort.on("message", () => {});
parentPort.postMessage({ type: "ready", argFile: "a" });`,
    );
    const run = startWatchWorker(input, { workerFile: file, stopTimeoutMs: 50 });
    const seen: RunEvent[] = [];

    for await (const event of run.events) {
      seen.push(event);
      if (event.type === "ready") run.stop();
    }

    expect(seen.at(-1)).toEqual({ type: "exit", code: 1 });
  });

  test("moves the watch to a fresh thread after the given number of runs, without ending it", async () => {
    const file = workerFile(
      "recycles",
      `import { parentPort, threadId } from "node:worker_threads";
parentPort.on("message", (message) => { if (message.type === "stop") process.exit(0); });
parentPort.postMessage({ type: "ready", argFile: "a" });
parentPort.postMessage({ type: "started" });
parentPort.postMessage({ type: "finished", record: { success: true, executionId: String(threadId) } });`,
    );
    const run = startWatchWorker(input, { workerFile: file, recycleAfterRuns: 1 });
    const seen: RunEvent[] = [];
    let finished = 0;

    for await (const event of run.events) {
      seen.push(event);
      if (event.type === "finished" && ++finished === 3) run.stop();
    }

    expect(seen.map((event) => event.type)).toEqual([
      "ready",
      "started",
      "finished",
      "started",
      "finished",
      "started",
      "finished",
      "exit",
    ]);
    const threads = seen.flatMap((event) =>
      event.type === "finished" ? [event.record.executionId] : [],
    );
    expect(new Set(threads).size).toBe(3);
  });

  test("ends the watch when it is stopped while a thread is being replaced", async () => {
    const file = workerFile(
      "stops-while-recycling",
      `import { parentPort } from "node:worker_threads";
parentPort.on("message", (message) => { if (message.type === "stop") setTimeout(() => process.exit(0), 50); });
parentPort.postMessage({ type: "finished", record: { success: true } });`,
    );
    const run = startWatchWorker(input, { workerFile: file, recycleAfterRuns: 1 });
    const seen: RunEvent[] = [];

    for await (const event of run.events) {
      seen.push(event);
      if (event.type === "finished") run.stop();
    }

    expect(seen).toEqual([
      { type: "finished", record: { success: true } },
      { type: "exit", code: 0 },
    ]);
  });
});
