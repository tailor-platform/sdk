import { type AnyCommand, createDefineCommand, runCommand } from "@politty/zod";
import type { CommonArgsType } from "./args";

/**
 * defineCommand with global args type (CommonArgsType).
 * Use this for leaf commands with `run` to get type-safe access to global args.
 * Parent commands with only `subCommands` can use `defineCommand` from politty directly.
 */
// The explicit annotation keeps the emitted declaration expressible: the
// inferred overload type names politty internals that its package does not export.
export const defineAppCommand: ReturnType<typeof createDefineCommand<CommonArgsType>> =
  createDefineCommand<CommonArgsType>();

/**
 * Run a parent command's default subcommand, propagating its failure.
 * `runCommand` reports failures through its result instead of throwing, so
 * without this the parent shortcut exits 0 on a failed delegation.
 * @param command - Subcommand to delegate to
 * @param argv - Arguments forwarded to the subcommand
 */
export async function runDefaultSubCommand(
  command: AnyCommand,
  argv: string[] = [],
): Promise<void> {
  const result = await runCommand(command, argv);
  if (!result.success) {
    throw result.error;
  }
}
