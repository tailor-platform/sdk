import { selectionArgs, selectionEnv } from "../workspace-context";
import { interpret, type StreamMessage } from "./stream";
import type { WorkspaceSelection } from "../workspace-context";
import type { RunHandle, RunInput } from "./run-types";

export type SessionStatus = "idle" | "watching" | "stopped";

export type SessionMessage = Exclude<StreamMessage, { type: "exit" }>;

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
  now?: () => number;
}

const CLI_DEBOUNCE_MS = 150;
const READY_NOTE = /^(?:> )?Ready!/;
const NO_WORKSPACE = "Select a workspace in the bar at the top of the page.";

interface ActiveRun {
  handle: RunHandle;
  workspaceArgs: string[];
  workspace: WorkspaceSelection;
}

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
  const maxEntries = options.maxEntries ?? 100;
  const listeners = new Set<(event: SessionEvent) => void>();
  let entries: SessionEntry[] = [];
  let seq = 0;
  let status: SessionStatus = "idle";
  let running = false;
  let reason: string | undefined;
  let workspace: WorkspaceSelection | undefined;
  let active: ActiveRun | undefined;
  let latestRun: SessionSnapshot["latestRun"];
  let owedRuns = 0;
  let lastEditAt = 0;
  let awaitingReady = false;
  const now = options.now ?? Date.now;

  const emit = (event: SessionEvent) => {
    for (const listener of listeners) listener(event);
  };

  function setStatus(next: SessionStatus, why?: string, nowRunning = next === "watching") {
    status = next;
    if (next !== "watching") owedRuns = 0;
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

  function settleRun() {
    owedRuns = Math.max(0, owedRuns - 1);
    if (owedRuns === 0) setRunning(false);
  }

  async function consume(run: ActiveRun) {
    for await (const event of run.handle.events) {
      if (active !== run) return;
      const message = interpret(event.type, event.type === "exit" ? "" : event.line);
      if (message === undefined) continue;
      if (message.type !== "exit") {
        const entry = record(message);
        if (message.type === "note" && READY_NOTE.test(message.text)) awaitingReady = false;
        if (message.type === "run") {
          latestRun = { ...entry, message };
        }
        if (message.type === "run" || message.type === "failure") settleRun();
        continue;
      }
      const code = event.type === "exit" ? event.code : null;
      const why = `The watch ended (exit code ${code ?? "none"}).`;
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
          workspaceArgs,
          env: selectionEnv(selection),
        });
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        record({ type: "failure", text });
        setStatus("stopped", text);
        return { ok: false, reason: text };
      }
      const run: ActiveRun = { handle, workspaceArgs, workspace: { ...selection } };
      active = run;
      owedRuns = 1;
      awaitingReady = true;
      lastEditAt = now();
      setStatus("watching");
      void consume(run);
      return { ok: true };
    },

    stop(): void {
      stopRun("Stopped.");
    },

    markInputsChanged(): void {
      if (active === undefined) return;
      const at = now();
      const sameRun = awaitingReady || (owedRuns > 0 && at - lastEditAt < CLI_DEBOUNCE_MS);
      lastEditAt = at;
      if (owedRuns === 0) owedRuns = 1;
      else if (!sameRun) owedRuns = 2;
      setRunning(true);
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
