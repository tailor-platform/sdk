import { runCommand } from "@politty/zod";
import { z } from "zod";
import { commonArgs, loadEnvFilesFromArgv } from "#/cli/shared/args";
import { tailorArgv } from "./process-argv";

/**
 * Run a command with the global arguments, env-file loading, and `process.argv` of the CLI entry point.
 * @param command - Command to run
 * @param argv - Arguments after the command path
 * @returns Result of the run
 */
export async function runCliCommand(command: Parameters<typeof runCommand>[0], argv: string[]) {
  using _argv = tailorArgv(argv);
  return await runCommand(command, argv, {
    // strip unknown keys
    globalArgs: z.object(commonArgs),
    setup: () => loadEnvFilesFromArgv(argv),
  });
}
