/**
 * Command hints for migration remediation
 */

import { formatConfigArg } from "#/cli/shared/args";
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
  const args = [
    "tailordb",
    "migration",
    "script",
    formatMigrationNumber(migrationNumber),
    "--namespace",
    namespace,
  ];
  const configArg = formatConfigArg(configPath);
  if (configArg !== undefined) {
    args.push(configArg);
  }
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

export interface NamespaceMigrationCommandOptions {
  /** `tailor tailordb migration` subcommand, followed by its positional arguments */
  subcommand: readonly string[];
  namespace: string;
  /** Config path the current run used; omitted from the command when it resolves to the default */
  configPath?: string;
}

/**
 * Render a `tailor tailordb migration` command for one namespace as a
 * remediation hint, reproducing the current run's invocation context.
 * @param {NamespaceMigrationCommandOptions} options - Subcommand, target namespace, and invocation context
 * @returns {string} The command part of the hint, as rendered by `formatCommandHint`
 */
export function formatNamespaceMigrationHint(options: NamespaceMigrationCommandOptions): string {
  const { subcommand, namespace, configPath } = options;
  const args = ["tailordb", "migration", ...subcommand, "--namespace", namespace];
  const configArg = formatConfigArg(configPath);
  if (configArg !== undefined) {
    args.push(configArg);
  }
  return formatCommandHint({ command: "tailor", args });
}
