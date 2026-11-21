import * as fs from "node:fs";
import * as path from "pathe";
import { normalizeArg } from "./arg";

export interface FileChange {
  code?: string;
  arg?: string;
}

export interface SyncedFilesOptions {
  /** The function the run executes; the user and the page both edit it. */
  file: string;
  /** The argument as the user writes it, JSON or JSON5. */
  argFile: string;
  /** Plain JSON copy of the argument, the only form `--arg-file` reads. */
  runArgFile: string;
  /** Code to create `file` with when it is missing; without it a missing file is an error. */
  starter?: string;
  /** Text to create the argument file with when it is missing; empty by default. */
  starterArg?: string;
  formatCode: (code: string) => Promise<string | undefined>;
  /** How often to look for changes made from outside; 0 turns the polling off. */
  pollMs?: number;
  onInputsChanged?: () => void;
}

const ARG_NOT_READABLE =
  "The argument is not valid JSON or JSON5; the last valid one stays in use.";

function readIfExists(file: string): string | undefined {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

function writeAtomic(file: string, content: string): void {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, content);
  fs.renameSync(temporary, file);
}

/**
 * Keep the function and its argument in files that the page, the user's editor and an AI
 * agent can all change, and tell the page what changed from outside.
 * @param options - The files and how to format code
 * @returns The synchronized files
 */
export function createSyncedFiles(options: SyncedFilesOptions) {
  const listeners = new Set<(change: FileChange) => void>();
  let code = "";
  let formatted: string | undefined;
  let arg = "";
  let runArg = "{}";
  let argError: string | undefined;
  let changedAt = Date.now();
  let queue: Promise<unknown> = Promise.resolve();
  let timer: NodeJS.Timeout | undefined;

  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const result = queue.then(task);
    queue = result.catch(() => undefined);
    return result;
  };

  const touch = () => {
    changedAt = Date.now();
    options.onInputsChanged?.();
  };

  const emit = (change: FileChange) => {
    for (const listener of listeners) listener(change);
  };

  function applyArg(text: string): string | undefined {
    const normalized = normalizeArg(text);
    if (normalized === undefined) return ARG_NOT_READABLE;
    if (normalized !== runArg) {
      writeAtomic(options.runArgFile, normalized);
      runArg = normalized;
      touch();
    }
    return undefined;
  }

  return {
    async init(): Promise<void> {
      for (const file of [options.file, options.argFile, options.runArgFile]) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
      }
      let existing = readIfExists(options.file);
      if (existing === undefined) {
        if (options.starter === undefined) throw new Error(`${options.file} does not exist.`);
        writeAtomic(options.file, options.starter);
        existing = options.starter;
      }
      code = existing;
      formatted = await options.formatCode(code);
      const existingArg = readIfExists(options.argFile);
      const initialArg = options.starterArg ?? "";
      if (existingArg === undefined) writeAtomic(options.argFile, initialArg);
      arg = existingArg ?? initialArg;
      writeAtomic(options.runArgFile, "{}");
      argError = applyArg(arg);
      changedAt = Date.now();
    },

    read(): { code: string; arg: string } {
      return { code, arg };
    },

    status(): { changedAt: number; argError: string | undefined } {
      return { changedAt, argError };
    },

    write(change: FileChange): Promise<{ argError?: string }> {
      return serial(async () => {
        if (change.code !== undefined) {
          const next = await options.formatCode(change.code);
          const unchanged = next !== undefined && next === formatted;
          if (!unchanged) {
            writeAtomic(options.file, change.code);
            code = change.code;
            formatted = next;
            touch();
          }
        }
        if (change.arg === undefined) return {};
        if (normalizeArg(change.arg) === undefined) return { argError: ARG_NOT_READABLE };
        if (change.arg !== arg) {
          writeAtomic(options.argFile, change.arg);
          arg = change.arg;
        }
        argError = applyArg(arg);
        return {};
      });
    },

    refresh(): Promise<void> {
      return serial(async () => {
        const onDisk = readIfExists(options.file);
        if (onDisk !== undefined && onDisk !== code) {
          code = onDisk;
          formatted = await options.formatCode(onDisk);
          touch();
          emit({ code: onDisk });
        }
        const argOnDisk = readIfExists(options.argFile);
        if (argOnDisk !== undefined && argOnDisk !== arg) {
          arg = argOnDisk;
          argError = applyArg(arg);
          emit({ arg: argOnDisk });
        }
      });
    },

    subscribe(listener: (change: FileChange) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    start(): void {
      if (!options.pollMs || timer !== undefined) return;
      timer = setInterval(() => void this.refresh(), options.pollMs);
      timer.unref();
    },

    close(): void {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    },
  };
}
