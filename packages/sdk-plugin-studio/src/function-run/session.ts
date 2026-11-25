import * as path from "pathe";
import { selectionArgs, selectionEnv } from "../workspace-context";
import { HISTORY_LIMIT } from "./history";
import type { WorkspaceSelection } from "../workspace-context";
import type { RunEvent, RunHandle, RunInput } from "./run-types";
import type { SessionMessage } from "./stream";

export type SessionStatus = "idle" | "watching" | "stopped";

export type { SessionMessage };

interface SessionEntry {
  seq: number;
  at: string;
  message: SessionMessage;
}

export type SessionEvent =
  | { type: "reset" }
  | { type: "status"; status: SessionStatus; running: boolean; reason?: string }
  | { type: "entry"; entry: SessionEntry };

export interface SessionSnapshot {
  status: SessionStatus;
  running: boolean;
  latestRun?: SessionEntry & { message: Extract<SessionMessage, { type: "run" }> };
  reason?: string;
  workspace?: WorkspaceSelection;
  entries: SessionEntry[];
}

export interface SessionOptions {
  startRun: (input: RunInput) => RunHandle;
  file: string;
  runArgFile: string;
  getSelection: () => WorkspaceSelection;
  maxEntries?: number;
}

const NO_WORKSPACE = "Select a workspace in the bar at the top of the page.";

interface ActiveRun {
  handle: RunHandle;
  workspaceArgs: string[];
  workspace: WorkspaceSelection;
  phase: RunPhase;
}

/** What the watch has said that still leaves a run to report back */
interface RunPhase {
  /** The watch was started and has not begun its first run */
  booting: boolean;
  /** A file change is waiting for the watch's debounce to start a run */
  armed: boolean;
  /** A run began and has not reported back */
  inRun: boolean;
  /** A change arrived during a run, so one more run follows it */
  queued: boolean;
}

const isBusy = (phase: RunPhase) => phase.booting || phase.armed || phase.inRun || phase.queued;

function describeWorkspace(selection: WorkspaceSelection): string {
  return selection.profile ?? selection.workspaceId ?? "no workspace";
}

/**
 * Own the one `function run --watch` process of the Function run tab, keep what it printed,
 * and tell whoever listens. The watch goes on whether or not a page is open.
 * @param options - How to start a run and which workspace to run against
 * @returns The session
 */
export function createRunSession(options: SessionOptions) {
  const maxEntries = options.maxEntries ?? HISTORY_LIMIT;
  const listeners = new Set<(event: SessionEvent) => void>();
  let entries: SessionEntry[] = [];
  let seq = 0;
  let status: SessionStatus = "idle";
  let running = false;
  let reason: string | undefined;
  let workspace: WorkspaceSelection | undefined;
  let active: ActiveRun | undefined;
  let latestRun: SessionSnapshot["latestRun"];

  const emit = (event: SessionEvent) => {
    for (const listener of listeners) listener(event);
  };

  function setStatus(next: SessionStatus, why?: string, nowRunning = next === "watching") {
    status = next;
    running = nowRunning;
    reason = why;
    emit({ type: "status", status, running, ...(why === undefined ? {} : { reason: why }) });
  }

  function setRunning(next: boolean) {
    if (running === next) return;
    running = next;
    emit({ type: "status", status, running, ...(reason === undefined ? {} : { reason }) });
  }

  function record(message: SessionMessage): SessionEntry {
    const entry: SessionEntry = { seq: ++seq, at: new Date().toISOString(), message };
    entries = [...entries, entry].slice(-maxEntries);
    emit({ type: "entry", entry });
    return entry;
  }

  function applyEvent(run: ActiveRun, event: RunEvent) {
    const { phase } = run;
    switch (event.type) {
      case "ready":
        record({
          type: "note",
          text: `Ready! Running ${path.basename(options.file)} on every save.`,
        });
        return;
      case "scheduled":
        phase.armed = true;
        break;
      case "queued":
        phase.armed = false;
        phase.queued = true;
        break;
      case "started":
        phase.booting = false;
        phase.armed = false;
        phase.queued = false;
        phase.inRun = true;
        break;
      case "finished": {
        const message = { type: "run" as const, record: event.record };
        latestRun = { ...record(message), message };
        phase.booting = false;
        phase.inRun = false;
        break;
      }
      case "failed":
        record({ type: "failure", text: event.text });
        phase.booting = false;
        phase.inRun = false;
        break;
      case "note":
        record({ type: "note", text: event.text });
        return;
      case "exit":
        return;
    }
    setRunning(isBusy(phase));
  }

  async function consume(run: ActiveRun) {
    for await (const event of run.handle.events) {
      if (active !== run) return;
      if (event.type !== "exit") {
        applyEvent(run, event);
        continue;
      }
      const why = `The watch ended (exit code ${event.code ?? "none"}).`;
      active = undefined;
      record({ type: "note", text: why });
      setStatus("stopped", why);
      return;
    }
  }

  function stopRun(why: string) {
    const run = active;
    if (run === undefined) return;
    active = undefined;
    run.handle.stop();
    setStatus("stopped", why);
  }

  return {
    start(): { ok: true } | { ok: false; reason: string } {
      if (active !== undefined) return { ok: true };
      const selection = options.getSelection();
      const workspaceArgs = selectionArgs(selection);
      if (workspaceArgs.length === 0) return { ok: false, reason: NO_WORKSPACE };

      entries = [];
      latestRun = undefined;
      workspace = { ...selection };
      emit({ type: "reset" });
      let handle: RunHandle;
      try {
        handle = options.startRun({
          file: options.file,
          argFile: options.runArgFile,
          workspace: { ...selection },
          env: selectionEnv(selection),
        });
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        record({ type: "failure", text });
        setStatus("stopped", text);
        return { ok: false, reason: text };
      }
      const run: ActiveRun = {
        handle,
        workspaceArgs,
        workspace: { ...selection },
        phase: { booting: true, armed: false, inRun: false, queued: false },
      };
      active = run;
      setStatus("watching");
      void consume(run);
      return { ok: true };
    },

    stop(): void {
      stopRun("Stopped.");
    },

    fail(text: string): void {
      record({ type: "failure", text });
      setStatus("stopped", text);
    },

    checkSelection(): void {
      const run = active;
      if (run === undefined) return;
      const next = options.getSelection();
      if (selectionArgs(next).join(" ") === run.workspaceArgs.join(" ")) return;
      const change = `The selected workspace changed (${describeWorkspace(run.workspace)} to ${describeWorkspace(next)})`;
      stopRun(`${change}, so the watch was stopped.`);
      const restarted = this.start();
      if (restarted.ok) {
        record({
          type: "note",
          text: `${change}; the watch was restarted on ${describeWorkspace(next)}.`,
        });
        return;
      }
      const why = `${change}, so the watch was stopped. ${restarted.reason}`;
      record({ type: "note", text: why });
      setStatus("stopped", why);
    },

    watchSelection(subscribe: (listener: () => void) => () => void): () => void {
      return subscribe(() => this.checkSelection());
    },

    snapshot(): SessionSnapshot {
      return {
        status,
        running,
        ...(latestRun === undefined ? {} : { latestRun }),
        ...(reason === undefined ? {} : { reason }),
        ...(workspace === undefined ? {} : { workspace }),
        entries,
      };
    },

    subscribe(listener: (event: SessionEvent) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    close(): void {
      stopRun("The server was shut down.");
    },
  };
}
