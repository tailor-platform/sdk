import { extractFields, toCamelCase } from "politty";
import { z } from "zod";
import { commonArgs } from "./args";

/**
 * Global option tokens that consume the following argv token as their value.
 * politty accepts both the kebab-case and camelCase spelling of every name.
 */
const valueTakingGlobalFlags: ReadonlySet<string> = new Set(
  extractFields(z.strictObject(commonArgs))
    .fields.filter((field) => field.type !== "boolean")
    .flatMap((field) => [field.cliName, ...(field.alias ?? [])].flatMap(toFlagTokens)),
);

function toFlagTokens(name: string): string[] {
  if (name.length === 1) return [`-${name}`];
  return [`--${name}`, `--${toCamelCase(name)}`];
}

export type InvokedViaAliasOptions = {
  /** Parent subcommand name the alias sits under (e.g. `"setup"`). */
  parent: string;
  /** Deprecated alias name to detect (e.g. `"renovate"`). */
  alias: string;
  /** Process argv tokens. */
  argv: readonly string[];
};

/**
 * Detect whether a command was invoked through a deprecated subcommand alias.
 *
 * politty resolves aliases before dispatch, so the invoked name is only
 * observable from the raw argv. Global options may sit anywhere before the
 * subcommand (`tailor setup --json renovate`), so option tokens and any values
 * they consume are skipped; an option value is never read as a command name.
 * @param options - Alias detection options
 * @returns true when the alias was the subcommand name following the parent
 */
export function invokedViaAlias(options: InvokedViaAliasOptions): boolean {
  const [parent, subcommand] = readCommandPath(options.argv);
  return parent === options.parent && subcommand === options.alias;
}

/**
 * Read the first two command names from argv, skipping global option tokens
 * and the values they consume.
 * @param argv - Process argv tokens
 * @returns The parent and subcommand names, when present
 */
function readCommandPath(argv: readonly string[]): [string?, string?] {
  const names: string[] = [];
  // argv[0] is the node binary and argv[1] the CLI entry point.
  for (let i = 2; i < argv.length && names.length < 2; i++) {
    const token = argv[i];
    if (token === undefined || token === "--") break;
    if (!token.startsWith("-")) {
      names.push(token);
      continue;
    }
    if (!token.includes("=") && valueTakingGlobalFlags.has(token)) i++;
  }
  return [names[0], names[1]];
}
