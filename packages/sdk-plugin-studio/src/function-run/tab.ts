import * as fs from "node:fs";
import { readFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "pathe";
import { createSyncedFiles } from "./files";
import { formatTypeScript } from "./format";
import {
  createFunctionRunHandler,
  type FunctionRunHandler,
  type FunctionRunPaths,
} from "./handler";
import { createFunctionRunStarter } from "./process";
import { createResultWriter } from "./result";
import { createRunSession } from "./session";
import { STARTER_ARG, STARTER_CODE } from "./starter";
import type { Tab } from "../shell-handler";
import type { WorkspaceSelection } from "../workspace-context";
import type { RunHandle, RunInput } from "./run-types";

const FILE_POLL_MS = 300;

export interface FunctionRunTabOptions {
  projectDir: string;
  /** Edit this existing file instead of the scratch function. */
  file?: string;
  /** Start watching as soon as the server is up. */
  watch: boolean;
  getSelection: () => WorkspaceSelection;
  onSelectionChange: (listener: () => void) => () => void;
  pageFile: string;
  startRun?: (input: RunInput) => RunHandle;
}

export interface FunctionRunTab {
  tab: Extract<Tab, { state: "mounted" }>;
  /** Where the function and its argument are, relative to the project. */
  paths: FunctionRunPaths & { resultFile: string };
  close: () => void;
}

/**
 * Set up the Function run tab: the files it edits, the watch it owns and its handler.
 * @param options - The project, which file to edit and whether to start watching
 * @returns The tab, where its files are and a function that shuts it down
 */
export async function createFunctionRunTab(
  options: FunctionRunTabOptions,
): Promise<FunctionRunTab> {
  const studioDir = path.join(options.projectDir, ".tailor", "studio");
  const editsScratch = options.file === undefined;
  const file = editsScratch
    ? path.join(studioDir, "function.ts")
    : path.resolve(options.projectDir, options.file!);
  const name = path.basename(file).replace(/\.[^.]+$/, "");
  const argFile = path.join(studioDir, `${name}.arg.json5`);
  const resultFile = path.join(studioDir, `${name}.result.json`);
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "tailor-studio-run-"));
  const runArgFile = path.join(runDir, "arg.json");

  let inputsChanged = (_editedAt: number) => {};
  const files = createSyncedFiles({
    file,
    argFile,
    runArgFile,
    starter: editsScratch ? STARTER_CODE : undefined,
    starterArg: editsScratch ? STARTER_ARG : undefined,
    formatCode: formatTypeScript,
    pollMs: FILE_POLL_MS,
    onInputsChanged: (editedAt) => inputsChanged(editedAt),
  });
  try {
    await files.init();
  } catch (error) {
    fs.rmSync(runDir, { recursive: true, force: true });
    throw error;
  }

  const session = createRunSession({
    startRun: options.startRun ?? createFunctionRunStarter(options.projectDir),
    file,
    runArgFile,
    getSelection: options.getSelection,
  });
  inputsChanged = (editedAt) => session.markInputsChanged(editedAt);
  const relative = (target: string) => path.relative(options.projectDir, target);
  const paths = {
    file: relative(file),
    argFile: relative(argFile),
    resultFile: relative(resultFile),
    absolute: { file, argFile, resultFile },
  };
  const handler: FunctionRunHandler = createFunctionRunHandler({
    loadPage: () => readFile(options.pageFile, "utf8"),
    files,
    session,
    paths,
  });
  const result = createResultWriter({ file: resultFile, session, files, paths });

  files.start();
  result.start();
  const stopWatchingSelection = session.watchSelection(options.onSelectionChange);
  if (options.watch) {
    const started = session.start();
    if (!started.ok) session.fail(started.reason);
  }

  return {
    tab: { id: "function-run", title: "Function run", state: "mounted", handler },
    paths,
    close: () => {
      stopWatchingSelection();
      handler.close();
      result.close();
      fs.rmSync(runDir, { recursive: true, force: true });
    },
  };
}
