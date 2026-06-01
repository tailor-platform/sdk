import { spawn } from "node:child_process";

export type CommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
};

export async function runCommand(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    input?: string;
    env?: NodeJS.ProcessEnv;
    /** Resolve with the captured result on a non-zero exit instead of rejecting. */
    rejectOnNonZero?: boolean;
  } = {},
): Promise<CommandResult> {
  const rejectOnNonZero = options.rejectOnNonZero ?? true;
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env === undefined ? undefined : { ...process.env, ...options.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (exitCode) => {
      const result = {
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        exitCode,
      };
      if (exitCode === 0 || !rejectOnNonZero) {
        resolve(result);
        return;
      }
      const detail = result.stderr.trim() || result.stdout.trim();
      reject(
        new Error(
          `${command} ${args.join(" ")} exited with code ${exitCode}${detail ? `\n${detail}` : ""}`,
        ),
      );
    });

    if (options.input !== undefined) {
      child.stdin.end(options.input);
    } else {
      child.stdin.end();
    }
  });
}
