/**
 * Command hints for migration remediation
 */

import { formatConfigArg, recoveryContextArgs, type RecoveryContext } from "#/cli/shared/args";
import { formatCommandHint } from "#/cli/shared/errors";
import { formatMigrationNumber } from "./migration-number";

export interface MigrationScriptCommandOptions {
  migrationNumber: number;
  namespace: string;
  /** Config path the current run used; omitted from the command when it resolves to the default */
  configPath?: string;
  /** Append `--no-script --reason` with a placeholder reason */
  noScript?: boolean;
}

/**
 * Render the `tailor tailordb migration script` command as a remediation
 * hint, reproducing the current run's invocation context.
 * @param {MigrationScriptCommandOptions} options - Target migration and invocation context
 * @returns {string} The command part of the hint, as rendered by `formatCommandHint`
 */
export function formatMigrationScriptHint(options: MigrationScriptCommandOptions): string {
  const { migrationNumber, namespace, configPath, noScript } = options;
  const args = namespaceMigrationArgs({
    subcommand: ["script", formatMigrationNumber(migrationNumber)],
    namespace,
    configPath,
  });
  if (noScript) {
    args.push("--no-script", "--reason", "<reason>");
  }
  return formatCommandHint({ command: "tailor", args });
}

export interface RebaselineCommandOptions {
  namespace: string;
  /** Config path the current run used; omitted from the command when it resolves to the default */
  configPath?: string;
}

/**
 * Render the `tailor tailordb migration rebaseline` command as a remediation
 * hint, reproducing the current run's invocation context.
 * @param {RebaselineCommandOptions} options - Target namespace and invocation context
 * @returns {string} The command part of the hint, as rendered by `formatCommandHint`
 */
export function formatRebaselineHint(options: RebaselineCommandOptions): string {
  return formatNamespaceMigrationHint({ ...options, subcommand: ["rebaseline"] });
}

/** How the current run selected its config and workspace, kept in the migration commands it suggests. */
export interface MigrationCommandContext {
  /** Config path the current run used; omitted from the command when it resolves to the default */
  configPath?: string;
  /** Workspace, profile, and env-file selection to keep */
  contextArgs?: readonly string[];
}

/** Config, workspace, and profile the current run used. */
export interface MigrationRunContext extends RecoveryContext {
  configPath?: string;
  /** Further arguments of the run to keep, such as a deploy's env files and profile */
  extraArgs?: readonly string[];
}

/**
 * Build the context that makes a suggested migration command target what the current run targeted.
 * @param {MigrationRunContext} run - Config, workspace, and profile the current run used
 * @returns {MigrationCommandContext} Context for the suggested commands
 */
export function migrationCommandContext(run: MigrationRunContext): MigrationCommandContext {
  return {
    configPath: run.configPath,
    contextArgs: [...recoveryContextArgs(run), ...(run.extraArgs ?? [])],
  };
}

export interface NamespaceMigrationCommandOptions extends MigrationCommandContext {
  /** `tailor tailordb migration` subcommand, followed by its arguments */
  subcommand: readonly string[];
  namespace: string;
}

/**
 * Arguments that make a suggested command target what the current run targeted.
 * @param {MigrationCommandContext} context - Invocation context of the current run
 * @returns {string[]} The config argument, followed by the context arguments
 */
export function migrationContextArgs(context: MigrationCommandContext): string[] {
  const configArg = formatConfigArg(context.configPath);
  return [...(configArg === undefined ? [] : [configArg]), ...(context.contextArgs ?? [])];
}

/**
 * Arguments of a `tailor tailordb migration` command, reproducing the current
 * run's invocation context.
 * @param {readonly string[]} subcommand - Subcommand, followed by its arguments
 * @param {MigrationCommandContext} context - Invocation context of the current run
 * @returns {string[]} Arguments following the `tailor` executable
 */
export function migrationCommandArgs(
  subcommand: readonly string[],
  context: MigrationCommandContext,
): string[] {
  return ["tailordb", "migration", ...subcommand, ...migrationContextArgs(context)];
}

/**
 * Arguments of a `tailor tailordb migration` command for one namespace,
 * reproducing the current run's invocation context.
 * @param {NamespaceMigrationCommandOptions} options - Subcommand, target namespace, and invocation context
 * @returns {string[]} Arguments following the `tailor` executable
 */
export function namespaceMigrationArgs(options: NamespaceMigrationCommandOptions): string[] {
  const { subcommand, namespace, ...context } = options;
  return migrationCommandArgs([...subcommand, "--namespace", namespace], context);
}

/**
 * Render a `tailor tailordb migration` command for one namespace as a
 * remediation hint, reproducing the current run's invocation context.
 * @param {NamespaceMigrationCommandOptions} options - Subcommand, target namespace, and invocation context
 * @returns {string} The command part of the hint, as rendered by `formatCommandHint`
 */
export function formatNamespaceMigrationHint(options: NamespaceMigrationCommandOptions): string {
  return formatCommandHint({ command: "tailor", args: namespaceMigrationArgs(options) });
}

interface CheckpointSyncHintOptions extends MigrationCommandContext {
  namespace: string;
  migrationNumber: number;
  /** Whether the namespace records another migration history ID, which only `--force` replaces */
  replaceHistoryId: boolean;
}

/**
 * Render the `migration sync` command that moves a checkpoint to a local migration.
 * @param options - Target migration and invocation context
 * @returns The command, noting when it also replaces the migration history ID
 */
export function formatCheckpointSyncHint(options: CheckpointSyncHintOptions): string {
  const { migrationNumber, replaceHistoryId, ...commandOptions } = options;
  const command = formatNamespaceMigrationHint({
    ...commandOptions,
    subcommand: [
      "sync",
      formatMigrationNumber(migrationNumber),
      ...(replaceHistoryId ? ["--force"] : []),
    ],
  });
  return replaceHistoryId ? `${command} (replaces the migration history ID)` : command;
}
