import { spawn } from "node:child_process";
import * as fs from "node:fs";
import { createInterface } from "node:readline";
import * as path from "pathe";
import { resolvePackageDir } from "../discover-tab";
import type { RunEvent, RunHandle, RunInput } from "./handler";

const SDK_PACKAGE = "@tailor-platform/sdk";

/**
 * Run a command and expose its output lines and exit as events.
 * @param command - Executable to run
 * @param args - Arguments of the command
 * @param options - Working directory
 * @param options.cwd - Directory the command runs in
 * @returns The event stream and a function that stops the process
 */
export function spawnRun(command: string, args: string[], options: { cwd: string }): RunHandle {
  const queue: RunEvent[] = [];
  let wake: (() => void) | undefined;
  let finished = false;
  const push = (event: RunEvent) => {
    queue.push(event);
    wake?.();
  };

  const child = spawn(command, args, { cwd: options.cwd, stdio: ["ignore", "pipe", "pipe"] });
  const streams = [
    { stream: child.stdout, type: "stdout" as const },
    { stream: child.stderr, type: "stderr" as const },
  ];
  const drained = streams.map(
    ({ stream, type }) =>
      new Promise<void>((resolve) => {
        const lines = createInterface({ input: stream });
        lines.on("line", (line) => push({ type, line }));
        lines.on("close", resolve);
      }),
  );
  child.on("error", (error) => {
    push({ type: "stderr", line: error.message });
    finished = true;
    push({ type: "exit", code: null });
  });
  child.on("close", (code) => {
    void Promise.all(drained).then(() => {
      if (finished) return;
      finished = true;
      push({ type: "exit", code });
    });
  });

  return {
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
    stop: () => {
      child.kill("SIGTERM");
    },
  };
}

/**
 * Build the arguments that run a function in watch mode with JSON output.
 * @param input - Path of the tailor CLI entry, the function file and the optional argument
 * @param input.tailorBin - Path of the tailor CLI entry
 * @param input.file - Function file
 * @param input.argFile - JSON file holding the argument; the watch runs again when it changes
 * @param input.workspaceArgs - Options that select the workspace (`-p` / `-w`)
 * @returns Arguments for `node`
 */
export function functionRunArgs(input: {
  tailorBin: string;
  file: string;
  argFile?: string;
  workspaceArgs?: string[];
}): string[] {
  return [
    input.tailorBin,
    "function",
    "run",
    input.file,
    "--watch",
    "--json",
    ...(input.workspaceArgs ?? []),
    ...(input.argFile === undefined ? [] : ["--arg-file", input.argFile]),
  ];
}

/**
 * Find the tailor CLI entry of the SDK installed in the project.
 * @param projectDir - Project directory the SDK is resolved from
 * @returns Absolute path of the entry
 */
export function resolveTailorBin(projectDir: string): string {
  const packageDir = resolvePackageDir(SDK_PACKAGE, projectDir);
  if (packageDir === undefined) {
    throw new Error(`${SDK_PACKAGE} is not installed in ${projectDir}.`);
  }
  const { bin } = JSON.parse(fs.readFileSync(path.join(packageDir, "package.json"), "utf8")) as {
    bin?: Record<string, string>;
  };
  const entry = bin?.tailor;
  if (entry === undefined) throw new Error(`${SDK_PACKAGE} does not provide a tailor command.`);
  return path.resolve(packageDir, entry);
}

/**
 * Start `tailor function run <file> --watch --json` in the project.
 * @param projectDir - Project directory the command runs in
 * @returns A function that starts a run for a function file and argument
 */
export function createFunctionRunStarter(projectDir: string): (input: RunInput) => RunHandle {
  return ({ file, argFile, workspaceArgs }) =>
    spawnRun(
      process.execPath,
      functionRunArgs({ tailorBin: resolveTailorBin(projectDir), file, argFile, workspaceArgs }),
      {
        cwd: projectDir,
      },
    );
}
