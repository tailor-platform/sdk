export type SaveField = "code" | "arg";

export interface SaverOptions {
  /** Write one field; reject when the server did not take it. */
  write: (field: SaveField, text: string) => Promise<void>;
  /** Called with why the newest write failed, and with undefined once nothing has failed. */
  onError?: (message: string | undefined) => void;
  /** How long to wait after the last edit before writing. */
  delayMs?: number;
}

const FIELDS: SaveField[] = ["code", "arg"];

/**
 * Keep what the editors hold on its way to the server: write an edit after a pause, remember
 * only what the server accepted, and let a caller write what is still waiting right now.
 * @param options - How to write and report
 * @returns The saver
 */
export function createSaver(options: SaverOptions) {
  const delayMs = options.delayMs ?? 400;
  const server: Record<SaveField, string | undefined> = { code: undefined, arg: undefined };
  const latest: Record<SaveField, string | undefined> = { code: undefined, arg: undefined };
  const failures: Record<SaveField, string | undefined> = { code: undefined, arg: undefined };
  const timers: Partial<Record<SaveField, ReturnType<typeof setTimeout>>> = {};
  let queue: Promise<unknown> = Promise.resolve();
  let reported: string | undefined;

  const failure = () => failures.code ?? failures.arg;
  const waiting = (field: SaveField) =>
    latest[field] !== undefined && latest[field] !== server[field];

  function report() {
    const next = failure();
    if (next === reported) return;
    reported = next;
    options.onError?.(next);
  }

  function cancelTimer(field: SaveField) {
    clearTimeout(timers[field]);
    delete timers[field];
  }

  function schedule(field: SaveField) {
    cancelTimer(field);
    if (!waiting(field)) {
      failures[field] = undefined;
      report();
      return;
    }
    timers[field] = setTimeout(() => void save(field), delayMs);
  }

  function save(field: SaveField): Promise<void> {
    cancelTimer(field);
    const result = queue.then(async () => {
      const text = latest[field];
      if (text === undefined || text === server[field]) return;
      try {
        await options.write(field, text);
      } catch (error) {
        failures[field] = error instanceof Error ? error.message : String(error);
        report();
        return;
      }
      server[field] = text;
      failures[field] = undefined;
      report();
      if (timers[field] === undefined && waiting(field)) schedule(field);
    });
    queue = result;
    return result;
  }

  return {
    /** The text the server holds now, from the first state or a change made from outside. */
    setServer(field: SaveField, text: string): void {
      server[field] = text;
      latest[field] = undefined;
      cancelTimer(field);
      failures[field] = undefined;
      report();
    },

    /** The editor now holds `text`; an invalid one is never written and replaces what waited. */
    edit(field: SaveField, text: string, valid = true): void {
      latest[field] = valid ? text : undefined;
      schedule(field);
    },

    /** Write what is waiting now and wait for it; resolves with why a write failed, if one did. */
    async flush(): Promise<string | undefined> {
      for (const field of FIELDS) {
        await save(field);
      }
      return failure();
    },
  };
}
