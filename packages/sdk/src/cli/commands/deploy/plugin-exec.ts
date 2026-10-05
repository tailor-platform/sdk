import { spawn, type StdioOptions } from "node:child_process";
import { CLIError } from "#/cli/shared/errors";
import type { PluginExecOptions, PluginExecResult } from "#/plugin/types";

const STDERR_TAIL_LINES = 20;

function stdioFor(output: NonNullable<PluginExecOptions["output"]>): StdioOptions {
  if (output === "capture") return ["ignore", "pipe", "pipe"];
  if (output === "ignore") return "ignore";
  return ["ignore", process.stderr, process.stderr];
}

/**
 * Run a shell command for a plugin hook.
 * @param command - Shell command to run
 * @param options - Working directory, added environment variables, and output handling
 * @returns Captured stdout and stderr, empty unless output is captured
 */
export function execPluginCommand(
  command: string,
  options: PluginExecOptions,
): Promise<PluginExecResult> {
  const { workingDir, env, output = "stream" } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      cwd: workingDir,
      env: { ...process.env, ...env },
      stdio: stdioFor(output),
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      reject(
        CLIError({
          code: "PLUGIN_COMMAND_START_FAILED",
          message: `Failed to start command: ${command} (working directory: ${workingDir}): ${error.message}`,
          cause: error,
        }),
      );
    });
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const tail = stderr.trimEnd().split("\n").slice(-STDERR_TAIL_LINES).join("\n");
      reject(
        CLIError({
          code: "PLUGIN_COMMAND_FAILED",
          message: `Command failed: ${command} (working directory: ${workingDir}, exit code: ${code}${signal ? `, signal: ${signal}` : ""})${tail ? `\n${tail}` : ""}`,
        }),
      );
    });
  });
}
