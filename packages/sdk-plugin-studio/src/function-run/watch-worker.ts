import { createInterface } from "node:readline";
import { Worker } from "node:worker_threads";
import { describeFailure } from "./stream";
import type { RunEvent, RunHandle, RunInput } from "./run-types";
import type { FunctionRunWatchEvent } from "@tailor-platform/sdk/cli";

/** What the worker is told: the function to watch and the workspace to run against */
export interface WatchWorkerInput {
  file: string;
  argFile: string;
  profile?: string | undefined;
  workspaceId?: string | undefined;
}

/** What the worker posts to the thread that started it */
export type WatchWorkerMessage = FunctionRunWatchEvent | { type: "start-failed"; message: string };

/** What the thread that started the worker posts to it */
export type WatchWorkerCommand = { type: "stop" };

const STOP_TIMEOUT_MS = 3000;
const RECYCLE_AFTER_RUNS = 100;

function createEventQueue() {
  const queue: RunEvent[] = [];
  let wake: (() => void) | undefined;
  return {
    push: (event: RunEvent) => {
      queue.push(event);
      wake?.();
    },
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
  };
}

function toRunEvent(message: WatchWorkerMessage): RunEvent {
  switch (message.type) {
    case "finished":
      return { type: "finished", record: message.record };
    case "failed":
      return { type: "failed", text: describeFailure(message.error) };
    case "start-failed":
      return { type: "failed", text: message.message };
    case "ready":
      return { type: "ready" };
    default:
      return { type: message.type };
  }
}

/**
 * Run the function watch in a worker thread. Anything the project's code does while it is
 * loaded, such as calling `process.exit()`, ends the thread and not the process that hosts it.
 * Every run loads the project's modules again and the thread keeps the ones it loaded, so after
 * a number of runs the watch moves to a fresh thread, which frees them; its first run reads the
 * files as they are then, so a save made meanwhile is not lost.
 * @param input - The function, its argument file, the workspace and the worker's environment
 * @param options - Where the worker's code is, how long a stop may take and when to replace it
 * @param options.workerFile - Module the worker runs
 * @param options.stopTimeoutMs - How long to wait for a worker to stop before ending it
 * @param options.recycleAfterRuns - Runs after which the watch moves to a fresh thread
 * @returns The watch's events and a function that stops it
 */
export function startWatchWorker(
  input: RunInput,
  options: { workerFile: string | URL; stopTimeoutMs?: number; recycleAfterRuns?: number },
): RunHandle {
  const { push, events } = createEventQueue();
  const stopTimeoutMs = options.stopTimeoutMs ?? STOP_TIMEOUT_MS;
  const recycleAfterRuns = options.recycleAfterRuns ?? RECYCLE_AFTER_RUNS;
  const workerData: WatchWorkerInput = {
    file: input.file,
    argFile: input.argFile,
    ...(input.workspace.profile === undefined ? {} : { profile: input.workspace.profile }),
    ...(input.workspace.workspaceId === undefined
      ? {}
      : { workspaceId: input.workspace.workspaceId }),
  };
  let stopped = false;
  let announcedReady = false;
  let current: WatchThread;

  interface WatchThread {
    worker: Worker;
    leaving: boolean;
    stopTimer: NodeJS.Timeout | undefined;
  }

  function ask(thread: WatchThread) {
    thread.worker.postMessage({ type: "stop" } satisfies WatchWorkerCommand);
    thread.stopTimer ??= setTimeout(() => void thread.worker.terminate(), stopTimeoutMs);
  }

  function launch() {
    const worker = new Worker(options.workerFile, {
      workerData,
      env: input.env,
      stdout: true,
      stderr: true,
    });
    const thread: WatchThread = { worker, leaving: false, stopTimer: undefined };
    current = thread;
    let runs = 0;
    const drained = [worker.stdout, worker.stderr].map(
      (stream) =>
        new Promise<void>((resolve) => {
          const lines = createInterface({ input: stream });
          lines.on("line", (text) => push({ type: "note", text }));
          lines.on("close", resolve);
        }),
    );
    worker.on("message", (message: WatchWorkerMessage) => {
      if (thread.leaving) return;
      if (message.type === "ready") {
        if (announcedReady) return;
        announcedReady = true;
      }
      push(toRunEvent(message));
      if (
        (message.type === "finished" || message.type === "failed") &&
        ++runs >= recycleAfterRuns
      ) {
        thread.leaving = true;
        ask(thread);
      }
    });
    worker.on("error", (error: Error) => push({ type: "note", text: error.message }));
    worker.on("exit", (code) => {
      clearTimeout(thread.stopTimer);
      void Promise.all(drained).then(() => {
        if (thread.leaving && !stopped) launch();
        else push({ type: "exit", code });
      });
    });
  }

  launch();
  return {
    events,
    stop: () => {
      stopped = true;
      ask(current);
    },
  };
}
