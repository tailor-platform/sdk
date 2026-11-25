import { createInterface } from "node:readline";
import { Worker } from "node:worker_threads";
import { describeFailure } from "./stream";
import type { RunEvent, RunHandle, RunInput } from "./run-types";
import type { FunctionRunWatchEvent } from "@tailor-platform/sdk/cli";

/** What the worker is told: the function to watch and the workspace to run against */
export interface WatchWorkerInput {
  file: string;
  argFile: string;
  /** Run once as soon as the watch is set up; true when undefined */
  runOnStart?: boolean | undefined;
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
 * Every run loads the project's modules again and the thread keeps them, so once the watch is
 * idle after a number of runs it moves to a fresh thread, which frees them. The fresh thread
 * does not run the function on start, so moving never executes it; the move is given up when a
 * change arrives before the fresh thread is ready, since the old thread is the one to run it.
 * @param input - The function, its argument file, the workspace and the worker's environment
 * @param options - Where the worker's code is, how long a stop may take and when to replace it
 * @param options.workerFile - Module the worker runs
 * @param options.stopTimeoutMs - How long to wait for a worker to stop before ending it
 * @param options.recycleAfterRuns - Runs after which an idle watch moves to a fresh thread
 * @returns The watch's events, a function that stops it, and a promise for every thread being gone
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
  let resolveExited: () => void = () => {};
  const exited = new Promise<void>((resolve) => {
    resolveExited = resolve;
  });
  const live = new Set<Worker>();
  let stopped = false;
  let finished = false;
  let announcedReady = false;
  let current: WatchThread;
  let successor: WatchThread | undefined;

  interface WatchThread {
    worker: Worker;
    role: "active" | "successor" | "leaving";
    armed: boolean;
    queued: boolean;
    inRun: boolean;
    runs: number;
    stopTimer: NodeJS.Timeout | undefined;
  }

  const idle = (thread: WatchThread) => !thread.armed && !thread.queued && !thread.inRun;

  function ask(thread: WatchThread) {
    thread.worker.postMessage({ type: "stop" } satisfies WatchWorkerCommand);
    thread.stopTimer ??= setTimeout(() => void thread.worker.terminate(), stopTimeoutMs);
  }

  function abandonSuccessor() {
    if (successor === undefined) return;
    const gone = successor;
    successor = undefined;
    gone.role = "leaving";
    void gone.worker.terminate();
  }

  function track(thread: WatchThread, message: WatchWorkerMessage) {
    switch (message.type) {
      case "scheduled":
        thread.armed = true;
        break;
      case "queued":
        thread.armed = false;
        thread.queued = true;
        break;
      case "started":
        thread.armed = false;
        thread.queued = false;
        thread.inRun = true;
        break;
      case "finished":
      case "failed":
        thread.inRun = false;
        thread.runs += 1;
        break;
      default:
        break;
    }
  }

  function onMessage(thread: WatchThread, message: WatchWorkerMessage) {
    if (thread.role === "leaving") return;
    if (thread.role === "successor") {
      if (message.type !== "ready") return;
      const old = current;
      old.role = "leaving";
      ask(old);
      thread.role = "active";
      current = thread;
      successor = undefined;
      return;
    }
    if (message.type === "ready") {
      if (announcedReady) return;
      announcedReady = true;
    }
    track(thread, message);
    push(toRunEvent(message));
    if (message.type === "scheduled" || message.type === "queued" || message.type === "started") {
      abandonSuccessor();
    }
    if (
      (message.type === "finished" || message.type === "failed") &&
      thread.runs >= recycleAfterRuns &&
      idle(thread) &&
      successor === undefined &&
      !stopped
    ) {
      successor = launch(false, "successor");
    }
  }

  function launch(runOnStart: boolean, role: WatchThread["role"]): WatchThread {
    const worker = new Worker(options.workerFile, {
      workerData: { ...workerData, runOnStart },
      env: input.env,
      stdout: true,
      stderr: true,
    });
    live.add(worker);
    const thread: WatchThread = {
      worker,
      role,
      armed: false,
      queued: false,
      inRun: false,
      runs: 0,
      stopTimer: undefined,
    };
    const drained = [worker.stdout, worker.stderr].map(
      (stream) =>
        new Promise<void>((resolve) => {
          const lines = createInterface({ input: stream });
          lines.on("line", (text) => push({ type: "note", text }));
          lines.on("close", resolve);
        }),
    );
    worker.on("message", (message: WatchWorkerMessage) => onMessage(thread, message));
    worker.on("error", (error: Error) => push({ type: "note", text: error.message }));
    worker.on("exit", (code) => {
      clearTimeout(thread.stopTimer);
      void Promise.all(drained).then(() => {
        live.delete(worker);
        if (thread === successor) successor = undefined;
        if (thread.role === "active") {
          finished = true;
          push({ type: "exit", code });
        }
        if (finished && live.size === 0) resolveExited();
      });
    });
    return thread;
  }

  current = launch(true, "active");
  return {
    events,
    exited,
    stop: () => {
      stopped = true;
      abandonSuccessor();
      ask(current);
    },
  };
}
