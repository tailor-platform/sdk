import { extractFields } from "@politty/zod";
import { z } from "zod";
import {
  commonArgs,
  flagTokensOf,
  globalBooleanAliases,
  splitOptionToken,
} from "#/cli/shared/args";

/**
 * Global option tokens that consume the following argv token as their value.
 * politty accepts both the kebab-case and camelCase spelling of every name.
 */
const valueTakingGlobalFlags: ReadonlySet<string> = new Set(
  extractFields(z.strictObject(commonArgs))
    .fields.filter((field) => field.type !== "boolean")
    .flatMap(flagTokensOf),
);

const booleanAliases = globalBooleanAliases({});

/**
 * Detect whether a command was invoked under a given subcommand name.
 * politty resolves aliases before dispatch, so the invoked name is only
 * observable from the raw argv. Global options may sit anywhere before the
 * subcommand (`tailor function --json test-run`), so option tokens and any
 * values they consume are skipped; an option value is never read as a command
 * name.
 * @param argv - Process argv tokens
 * @param parent - Name of the command group the subcommand belongs to
 * @param name - Subcommand name to look for
 * @returns true when `name` was the subcommand name under `parent`
 */
export function invokedViaSubcommand(
  argv: readonly string[],
  parent: string,
  name: string,
): boolean {
  const names: string[] = [];
  // argv[0] is the node binary and argv[1] the CLI entry point.
  for (let i = 2; i < argv.length && names.length < 2; i++) {
    const token = argv[i];
    if (token === undefined || token === "--") break;
    if (!token.startsWith("-")) {
      names.push(token);
      continue;
    }
    const { flag, value } = splitOptionToken(token, booleanAliases);
    if (value === undefined && valueTakingGlobalFlags.has(flag)) i++;
  }
  return names[0] === parent && names[1] === name;
}
