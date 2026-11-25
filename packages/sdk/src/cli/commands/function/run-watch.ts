import * as fs from "node:fs";
import * as path from "pathe";
import { CLIError } from "#/cli/shared/errors";
import { resolveFunctionRunTarget } from "./run";
import type { FunctionRunWatch, FunctionRunWatchEvent } from "./watch";

/** **Beta:** This API may change in future releases. */
export interface RunFunctionWatchOptions {
  /** Path of the function file */
  file: string;
  /** Path of the JSON file holding the argument, read on every run */
  argFile: string;
  /** Receives what happens in the watch instead of it printing run lines */
  onEvent: (event: FunctionRunWatchEvent) => void;
  /** Run once as soon as the watch is set up; true when undefined, false waits for the first change */
  runOnStart?: boolean | undefined;
  /** Profile that selects the workspace */
  profile?: string | undefined;
  /** Workspace to run in */
  workspaceId?: string | undefined;
  /** Machine user name; the profile's default when undefined */
  machineUser?: string | undefined;
  /** Path of the config file; the default lookup when undefined */
  config?: string | undefined;
}

/**
 * Run a function on the Platform now and again each time the function file, a project file it
 * imports, or the argument file changes, like `tailor function run --watch`. The watch reports
 * through `onEvent` and neither prints run lines nor handles termination signals, so a program
 * that hosts it decides how to stop it.
 *
 * **Beta:** This API may change in future releases.
 * @param options - Function file, argument file, workspace selection, and the event receiver
 * @returns Handle that stops the watch
 */
export async function runFunctionWatch(
  options: RunFunctionWatchOptions,
): Promise<FunctionRunWatch> {
  const filePath = path.resolve(options.file);
  if (!fs.existsSync(filePath)) {
    throw CLIError({ code: "FILE_NOT_FOUND", message: `File not found: ${filePath}` });
  }
  const target = await resolveFunctionRunTarget({
    filePath,
    file: options.file,
    config: options.config,
    profile: options.profile,
    workspaceId: options.workspaceId,
    machineUser: options.machineUser,
    allowSchemaDrift: false,
  });
  const { startFunctionRunWatch } = await import("./watch");
  return startFunctionRunWatch({
    target,
    argFile: path.resolve(options.argFile),
    initialArg: undefined,
    onEvent: options.onEvent,
    runOnStart: options.runOnStart,
    handleSignals: false,
  });
}
