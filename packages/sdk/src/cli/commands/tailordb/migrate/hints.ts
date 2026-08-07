/**
 * Copyable command hints for migration remediation
 */

import { formatConfigArg } from "#/cli/shared/args";
import { formatCopyableCommand } from "#/cli/shared/errors";
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
 * Build the copyable `tailor tailordb migration script` command for
 * remediation hints, reproducing the current run's invocation context.
 * @param {MigrationScriptCommandOptions} options - Target migration and invocation context
 * @returns {string} Command line quoted for the current platform's shell
 */
export function formatMigrationScriptCommand(options: MigrationScriptCommandOptions): string {
  const { migrationNumber, namespace, configPath, noScript } = options;
  const argv = [
    "tailor",
    "tailordb",
    "migration",
    "script",
    formatMigrationNumber(migrationNumber),
    "--namespace",
    namespace,
  ];
  const configArg = formatConfigArg(configPath);
  if (configArg !== undefined) {
    argv.push(configArg);
  }
  if (noScript) {
    argv.push("--no-script", "--reason", "<reason>");
  }
  return formatCopyableCommand(argv);
}
