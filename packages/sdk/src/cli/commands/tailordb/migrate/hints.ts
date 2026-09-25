/**
 * Command hints for migration remediation
 */

import { formatConfigArg } from "#/cli/shared/args";
import { type CommandHintRenderers, formatCommandHint } from "#/cli/shared/errors";
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
 * @param {CommandHintRenderers} renderers - Wording for the shell and argv renderings
 * @returns {string} The hint produced by the renderer that matches the platform shell
 */
export function formatMigrationScriptHint(
  options: MigrationScriptCommandOptions,
  renderers: CommandHintRenderers,
): string {
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
  return formatCommandHint({ command: "tailor", args }, renderers);
}
