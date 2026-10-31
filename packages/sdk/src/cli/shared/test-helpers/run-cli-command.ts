import { runCommand } from "@politty/zod";
import { z } from "zod";
import { commonArgs, loadEnvFilesFromArgv } from "#/cli/shared/args";

/**
 * Run a command with the global arguments and env-file loading of the CLI entry point.
 * @param command - Command to run
 * @param argv - Arguments after the command path
 * @returns Result of the run
 */
export async function runCliCommand(command: Parameters<typeof runCommand>[0], argv: string[]) {
  return await runCommand(command, argv, {
    // strip unknown keys
    globalArgs: z.object(commonArgs),
    setup: () => loadEnvFilesFromArgv(argv),
  });
}
