import * as fs from "node:fs";
import * as path from "pathe";
import { parseTailorErrors, type TailorErrorItem } from "./tailor-errors";
import type { createRunSession, SessionSnapshot } from "./session";
import type { RunRecord } from "./stream";

const MAX_ENTRIES = 20;
const POLL_MS = 500;

type ResultEntry =
  | { seq: number; at: string; type: "run"; record: RunRecord; argErrors: TailorErrorItem[] }
  | { seq: number; at: string; type: "failure" | "note"; text: string };

export interface RunResult {
  status: SessionSnapshot["status"];
  reason?: string;
  workspace?: SessionSnapshot["workspace"];
  file: string;
  argFile: string;
  argError?: string;
  /** When the server last saw the function or its argument change. */
  inputsChangedAt: string;
  updatedAt: string;
  /** The newest run, even when notes or failures came after it; null before anything ran. */
  latestRun: Extract<ResultEntry, { type: "run" }> | null;
  /** Newest first. */
  entries: ResultEntry[];
}

interface BuildOptions {
  snapshot: SessionSnapshot;
  files: { changedAt: number; argError: string | undefined };
  paths: { file: string; argFile: string };
  now: number;
}

/**
 * Describe the state of the watch for an agent that reads it from a file.
 * @param options - The session, the state of the files and where they are
 * @returns The content of the result file
 */
export function buildResult(options: BuildOptions): RunResult {
  const { snapshot, files, paths } = options;
  const entries: ResultEntry[] = snapshot.entries
    .toReversed()
    .slice(0, MAX_ENTRIES)
    .map(({ seq, at, message }) =>
      message.type === "run"
        ? {
            seq,
            at,
            type: "run",
            record: message.record,
            argErrors: parseTailorErrors(message.record.error),
          }
        : { seq, at, type: message.type, text: message.text },
    );
  const latestRun = entries.find((entry) => entry.type === "run") ?? null;
  return {
    status: snapshot.status,
    ...(snapshot.reason === undefined ? {} : { reason: snapshot.reason }),
    ...(snapshot.workspace === undefined ? {} : { workspace: snapshot.workspace }),
    file: paths.file,
    argFile: paths.argFile,
    ...(files.argError === undefined ? {} : { argError: files.argError }),
    inputsChangedAt: new Date(files.changedAt).toISOString(),
    updatedAt: new Date(options.now).toISOString(),
    latestRun,
    entries,
  };
}

function writeAtomic(file: string, content: string): void {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, content);
  fs.renameSync(temporary, file);
}

/**
 * Keep a file up to date with what the watch is doing, so an agent can read the outcome of
 * its last edit without a browser.
 * @param options - The file to write and what to describe in it
 * @returns The writer
 */
export function createResultWriter(options: {
  file: string;
  session: ReturnType<typeof createRunSession>;
  files: { status: () => { changedAt: number; argError: string | undefined } };
  paths: { file: string; argFile: string };
}) {
  let stopListening: (() => void) | undefined;
  let timer: NodeJS.Timeout | undefined;
  let last = "";

  function write() {
    const result = buildResult({
      snapshot: options.session.snapshot(),
      files: options.files.status(),
      paths: options.paths,
      now: Date.now(),
    });
    const { updatedAt: _updatedAt, ...stable } = result;
    const signature = JSON.stringify(stable);
    if (signature === last) return;
    last = signature;
    writeAtomic(options.file, `${JSON.stringify(result, null, 2)}\n`);
  }

  return {
    start(): void {
      fs.mkdirSync(path.dirname(options.file), { recursive: true });
      write();
      stopListening = options.session.subscribe(write);
      timer = setInterval(write, POLL_MS);
      timer.unref();
    },
    close(): void {
      stopListening?.();
      if (timer !== undefined) clearInterval(timer);
      stopListening = undefined;
      timer = undefined;
    },
  };
}
