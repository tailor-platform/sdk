import * as fs from "node:fs";
import * as os from "node:os";
import { watch } from "chokidar";
import { format } from "date-fns";
import { isEmptyObject } from "es-toolkit";
import * as path from "pathe";
import { getDistDir } from "#/cli/shared/dist-dir";
import { errorToJson, serializeError } from "#/cli/shared/error-json";
import { errorSummary, isCLIError, locatedMessage } from "#/cli/shared/errors";
import { logger, styles } from "#/cli/shared/logger";
import { beginUserModuleRun } from "#/cli/shared/user-modules";
import {
  argumentToSend,
  displayPath,
  executeFunction,
  executionRecord,
  type FunctionRunTarget,
  type PreparedFunction,
  prepareFunction,
  printExecutionDetails,
  readFunctionArgFile,
  warnStartedJobsSkipped,
} from "./run-function";
import type { ScriptExecutionResult } from "#/cli/shared/script-executor";
import type { Jsonifiable } from "type-fest";

const DEBOUNCE_MS = 100;
const STOP_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

/**
 * What a watch reports to `onEvent`, in the order it happens.
 *
 * **Beta:** This API may change in future releases.
 */
export type FunctionRunWatchEvent =
  /** The watch is set up; the first run follows */
  | { type: "ready"; argFile: string }
  /** A watched file changed; a run starts once the changes stop for a moment */
  | { type: "scheduled" }
  /** A change arrived while a run was in flight; one more run starts after it */
  | { type: "queued" }
  /** A run began: the function is being read, bundled, and sent */
  | { type: "started" }
  /** The run ended: the same record `--json` writes to stdout */
  | { type: "finished"; record: FunctionRunRecord }
  /** The run could not complete: the same error envelope `--json` writes to stderr */
  | { type: "failed"; error: unknown };

/**
 * One run's result as `--json` writes it.
 *
 * **Beta:** This API may change in future releases.
 */
export type FunctionRunRecord = ReturnType<typeof executionRecord> & { executionId: string };

export interface FunctionRunWatchOptions {
  /** Function to run and the context it runs in */
  target: FunctionRunTarget;
  /** Absolute path of the `--arg-file`; a temporary argument file is created when undefined */
  argFile: string | undefined;
  /** Initial content of the temporary argument file; `{}` when undefined */
  initialArg: Jsonifiable | undefined;
  /** Receives each event instead of the run lines and the Ready line being printed */
  onEvent?: ((event: FunctionRunWatchEvent) => void) | undefined;
  /** Run once as soon as the watch is set up; true when undefined, false waits for the first change */
  runOnStart?: boolean | undefined;
  /** Stop on SIGINT, SIGTERM, and SIGHUP by removing the temporary argument file and exiting; true when undefined */
  handleSignals?: boolean | undefined;
}

/** **Beta:** This API may change in future releases. */
export interface FunctionRunWatch {
  /** Settles once the watch is closed */
  readonly closed: Promise<void>;
  /** Stop watching and remove the temporary argument file */
  close(): Promise<void>;
}

function timestamp(): string {
  return styles.dim(format(new Date(), "yyyy-MM-dd HH:mm:ss"));
}

function realpathOrSelf(filePath: string): string {
  try {
    return fs.realpathSync(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return filePath;
    throw error;
  }
}

function createTempArgFile(initialArg: Jsonifiable | undefined): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "tailor-function-run-")));
  const file = path.join(dir, "arg.json");
  fs.writeFileSync(
    file,
    `${JSON.stringify(initialArg === undefined ? {} : initialArg, null, 2)}\n`,
  );
  return file;
}

function isInside(dir: string, file: string): boolean {
  const relative = path.relative(dir, file);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function functionLabel(prepared: PreparedFunction): string {
  return prepared.functionType === undefined
    ? prepared.scriptName
    : `${prepared.functionType} "${prepared.functionName}"`;
}

function printStarted(prepared: PreparedFunction, executionId: string): void {
  if (logger.jsonMode) return;
  logger.log(`${timestamp()}   --> ${styles.bold(functionLabel(prepared))} [${executionId}]`);
}

function printFinished(
  prepared: PreparedFunction,
  result: ScriptExecutionResult,
  executionId: string,
): void {
  if (logger.jsonMode) {
    logger.out({ ...executionRecord(prepared, result), executionId });
    return;
  }
  const status = result.success
    ? styles.bold(styles.success("OK"))
    : styles.bold(styles.error("FAILED"));
  logger.log(
    `${timestamp()}  <--  [${status}] ${styles.bold(functionLabel(prepared))} [${executionId}]`,
  );
  printExecutionDetails(prepared, result);
}

function failureLines(error: unknown): string[] {
  if (!isCLIError(error)) return errorSummary(error).split("\n");
  return [
    locatedMessage(error),
    error.details,
    error.suggestion && `${styles.info("Suggestion:")} ${error.suggestion}`,
  ]
    .filter((part): part is string => Boolean(part))
    .flatMap((part) => part.split("\n"));
}

function printFailure(error: unknown): void {
  if (logger.jsonMode) {
    logger.log(serializeError(error, { includeStack: logger.verbose }));
    return;
  }
  const [first, ...rest] = failureLines(error);
  logger.log(`${timestamp()}            [${styles.error("ERROR")}] ${first}`);
  for (const line of rest) {
    logger.log(`  ${line}`);
  }
  if (error instanceof Error && error.stack) {
    logger.debug(`Stack trace:\n${error.stack}`);
  }
}

/**
 * Run the function now and again whenever its file, a project file the bundle read, or the
 * argument file changes. After the function failed to build, a file added anywhere in the
 * project also runs it again. A change made while a run is in flight starts one more run after it.
 * @param options - Function to run and its argument file
 * @returns Handle that stops the watch
 */
export async function startFunctionRunWatch(
  options: FunctionRunWatchOptions,
): Promise<FunctionRunWatch> {
  const { target } = options;
  const argFile =
    options.argFile === undefined
      ? createTempArgFile(options.initialArg)
      : realpathOrSelf(options.argFile);
  const tempArgDir = options.argFile === undefined ? path.dirname(argFile) : undefined;
  const functionFile = realpathOrSelf(target.filePath);
  const projectDir = realpathOrSelf(path.dirname(target.config.path));
  const buildOutputDir = path.resolve(getDistDir());

  const removeTempArgFile = () => {
    if (tempArgDir) fs.rmSync(tempArgDir, { recursive: true, force: true });
  };
  const onStopSignal = () => {
    removeTempArgFile();
    process.exit(0);
  };
  const handleSignals = options.handleSignals ?? true;
  if (handleSignals)
    for (const signal of STOP_SIGNALS) process.prependListener(signal, onStopSignal);

  let watched = new Set([functionFile, argFile]);
  const ignored = (file: string): boolean =>
    !watched.has(file) &&
    isInside(projectDir, file) &&
    (isInside(buildOutputDir, file) ||
      path
        .relative(projectDir, file)
        .split("/")
        .some((segment) => segment === "node_modules" || segment.startsWith(".")));
  const watcher = watch([...watched, projectDir], { ignoreInitial: true, ignored });

  const updateWatched = (sourceFiles: string[]) => {
    const next = new Set([functionFile, argFile, ...sourceFiles.map(realpathOrSelf)]);
    const removed = [...watched].filter((file) => !next.has(file));
    const added = [...next].filter((file) => !watched.has(file));
    if (removed.length > 0) watcher.unwatch(removed);
    if (added.length > 0) watcher.add(added);
    watched = next;
  };

  let preparationFailed = false;
  let startedJobsWarned = false;
  const { onEvent } = options;
  const runOnce = async () => {
    preparationFailed = true;
    onEvent?.({ type: "started" });
    try {
      const arg = readFunctionArgFile(argFile);
      beginUserModuleRun();
      const prepared = await prepareFunction({
        target,
        progress: (message) => logger.debug(message),
      });
      preparationFailed = false;
      if (!startedJobsWarned) startedJobsWarned = warnStartedJobsSkipped(target, prepared);
      updateWatched(prepared.sourceFiles);
      let executionId = "";
      const result = await executeFunction({
        target,
        prepared,
        arg: argumentToSend(prepared, isEmptyObject(arg.value) ? undefined : arg),
        onStart: (id) => {
          executionId = id;
          if (!onEvent) printStarted(prepared, id);
        },
      });
      if (onEvent)
        onEvent({
          type: "finished",
          record: { ...executionRecord(prepared, result), executionId },
        });
      else printFinished(prepared, result, executionId);
    } catch (error) {
      if (onEvent)
        onEvent({ type: "failed", error: errorToJson(error, { includeStack: logger.verbose }) });
      else printFailure(error);
    }
  };

  let running = false;
  let pending = false;
  let closing = false;
  const cycle = async (): Promise<void> => {
    if (running) {
      if (!pending) onEvent?.({ type: "queued" });
      pending = true;
      return;
    }
    running = true;
    try {
      await runOnce();
    } finally {
      running = false;
      if (pending && !closing) {
        pending = false;
        void cycle();
      }
    }
  };

  let debounceTimer: NodeJS.Timeout | undefined;
  const schedule = () => {
    onEvent?.({ type: "scheduled" });
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => void cycle(), DEBOUNCE_MS);
  };
  watcher.on("add", (file) => {
    if (watched.has(file) || preparationFailed) schedule();
  });
  watcher.on("change", (file) => {
    if (watched.has(file)) schedule();
  });
  watcher.on("unlink", (file) => {
    if (watched.has(file)) schedule();
  });
  watcher.on("error", (error) =>
    onEvent
      ? onEvent({ type: "failed", error: errorToJson(error, { includeStack: logger.verbose }) })
      : printFailure(error),
  );
  await new Promise<void>((resolve) => watcher.once("ready", () => resolve()));

  const runOnStart = options.runOnStart ?? true;
  if (!runOnStart) {
    try {
      beginUserModuleRun();
      const prepared = await prepareFunction({
        target,
        progress: (message) => logger.debug(message),
      });
      updateWatched(prepared.sourceFiles);
    } catch {
      preparationFailed = true;
    }
  }
  if (onEvent) {
    onEvent({ type: "ready", argFile });
  } else {
    const tty = process.stderr.isTTY ? "> " : "";
    logger.log(
      `${tty}Ready! Running ${styles.path(displayPath(target.filePath))} on every save. Edit ${styles.path(displayPath(options.argFile ?? argFile))} to change its argument (^C to quit)`,
    );
  }
  if (runOnStart) void cycle();

  let resolveClosed: () => void = () => {};
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  return {
    closed,
    async close() {
      if (closing) return;
      closing = true;
      clearTimeout(debounceTimer);
      if (handleSignals) for (const signal of STOP_SIGNALS) process.off(signal, onStopSignal);
      await watcher.close();
      removeTempArgFile();
      resolveClosed();
    },
  };
}
