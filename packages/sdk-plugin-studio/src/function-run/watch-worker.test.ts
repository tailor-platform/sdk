import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { startWatchWorker } from "./watch-worker";
import type { RunEvent, RunInput } from "./run-types";

let dir: string;
let buildRoot: string;

beforeAll(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "studio-worker-")));
  buildRoot = path.join(dir, "build");
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

    const events = await collect(startWatchWorker(input, { workerFile: file, buildRoot }).events);

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

    const events = await collect(startWatchWorker(input, { workerFile: file, buildRoot }).events);

    const note = events.find((event) => event.type === "note");
    expect(JSON.parse(note && "text" in note ? note.text : "null")).toEqual({
      workerData: {
        file: "/p/function.ts",
        argFile: "/tmp/arg.json",
        profile: "dev",
        workspaceId: "ws-1",
        runOnStart: true,
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

    const events = await collect(startWatchWorker(input, { workerFile: file, buildRoot }).events);

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

    const events = await collect(startWatchWorker(input, { workerFile: file, buildRoot }).events);

    expect(events.at(-1)).toEqual({ type: "exit", code: 3 });
  });

  test("reports an uncaught error as a note, then the exit", async () => {
    const file = workerFile("throws", `throw new Error("cannot load config");`);

    const events = await collect(startWatchWorker(input, { workerFile: file, buildRoot }).events);

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
    const run = startWatchWorker(input, { workerFile: file, buildRoot });
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
    const run = startWatchWorker(input, { workerFile: file, buildRoot, stopTimeoutMs: 50 });
    const seen: RunEvent[] = [];

    for await (const event of run.events) {
      seen.push(event);
      if (event.type === "ready") run.stop();
    }

    expect(seen.at(-1)).toEqual({ type: "exit", code: 1 });
  });

  test("moves an idle watch to a fresh thread after the given number of runs, which does not run on start", async () => {
    const file = workerFile(
      "recycles",
      `import { parentPort, workerData } from "node:worker_threads";
parentPort.on("message", (message) => { if (message.type === "stop") process.exit(0); });
parentPort.postMessage({ type: "ready", argFile: "a" });
if (workerData.runOnStart === false) {
  setTimeout(() => console.log("fresh thread, runOnStart=" + workerData.runOnStart), 100);
} else {
  parentPort.postMessage({ type: "started" });
  parentPort.postMessage({ type: "finished", record: { success: true } });
}`,
    );
    const run = startWatchWorker(input, { workerFile: file, buildRoot, recycleAfterRuns: 1 });
    const seen: RunEvent[] = [];

    for await (const event of run.events) {
      seen.push(event);
      if (event.type === "note") run.stop();
    }

    expect(seen).toEqual([
      { type: "ready" },
      { type: "started" },
      { type: "finished", record: { success: true } },
      { type: "note", text: "fresh thread, runOnStart=false" },
      { type: "exit", code: 0 },
    ]);
  });

  test("gives up the move when a change arrives before the fresh thread is ready", async () => {
    const file = workerFile(
      "gives-up",
      `import { parentPort, workerData } from "node:worker_threads";
parentPort.on("message", (message) => { if (message.type === "stop") process.exit(0); });
if (workerData.runOnStart === false) {
  setTimeout(() => {
    parentPort.postMessage({ type: "ready", argFile: "a" });
    console.log("fresh thread became ready");
  }, 300);
} else {
  parentPort.postMessage({ type: "ready", argFile: "a" });
  parentPort.postMessage({ type: "started" });
  parentPort.postMessage({ type: "finished", record: { success: true } });
  setTimeout(() => parentPort.postMessage({ type: "scheduled" }), 30);
}`,
    );
    const run = startWatchWorker(input, { workerFile: file, buildRoot, recycleAfterRuns: 1 });
    const seen: RunEvent[] = [];

    for await (const event of run.events) {
      seen.push(event);
      if (event.type === "scheduled") setTimeout(run.stop, 500);
    }
    await run.exited;

    expect(seen.map((event) => event.type)).toEqual([
      "ready",
      "started",
      "finished",
      "scheduled",
      "exit",
    ]);
  });

  test("settles exited once every thread is gone after a stop", async () => {
    const file = workerFile(
      "exits-after-stop",
      `import { parentPort } from "node:worker_threads";
parentPort.on("message", (message) => { if (message.type === "stop") setTimeout(() => process.exit(0), 80); });
parentPort.postMessage({ type: "ready", argFile: "a" });`,
    );
    const run = startWatchWorker(input, { workerFile: file, buildRoot });
    let settled = false;
    void run.exited.then(() => {
      settled = true;
    });
    const seen: RunEvent[] = [];
    let settledAtStop: boolean | undefined;

    for await (const event of run.events) {
      seen.push(event);
      if (event.type === "ready") {
        settledAtStop = settled;
        run.stop();
      }
    }
    await run.exited;

    expect([seen.at(-1), settledAtStop, settled]).toEqual([{ type: "exit", code: 0 }, false, true]);
  });

  test("gives the worker its own build output directory and removes it when the worker is gone", async () => {
    const file = workerFile(
      "build-dir",
      `import * as fs from "node:fs";
fs.writeFileSync(process.env.TAILOR_BUILD_OUTPUT_DIR + "/marker", "x");
console.log(process.env.TAILOR_BUILD_OUTPUT_DIR);`,
    );
    const run = startWatchWorker(
      { ...input, env: { ...input.env, TAILOR_BUILD_OUTPUT_DIR: "/shared/build" } },
      { workerFile: file, buildRoot },
    );

    const events = await collect(run.events);
    await run.exited;

    const note = events.find((event) => event.type === "note");
    const dir = note && "text" in note ? note.text : "";
    expect([dir.startsWith(buildRoot), dir === "/shared/build", fs.existsSync(dir)]).toEqual([
      true,
      false,
      false,
    ]);
  });

  test("gives the replacement thread a build output directory of its own", async () => {
    const file = workerFile(
      "build-dir-recycle",
      `import { parentPort, workerData } from "node:worker_threads";
parentPort.on("message", (message) => { if (message.type === "stop") process.exit(0); });
console.log(process.env.TAILOR_BUILD_OUTPUT_DIR);
parentPort.postMessage({ type: "ready", argFile: "a" });
if (workerData.runOnStart !== false) {
  parentPort.postMessage({ type: "started" });
  parentPort.postMessage({ type: "finished", record: { success: true } });
}`,
    );
    const run = startWatchWorker(input, { workerFile: file, buildRoot, recycleAfterRuns: 1 });
    const dirs: string[] = [];

    for await (const event of run.events) {
      if (event.type === "note") dirs.push(event.text);
      if (dirs.length === 2) run.stop();
    }

    expect([dirs.length, new Set(dirs).size]).toEqual([2, 2]);
  });
});
