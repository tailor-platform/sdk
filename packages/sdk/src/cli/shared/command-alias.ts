import { extractFields } from "politty";
import { z } from "zod";
import { commonArgs } from "./args";

/** Global option tokens that consume the following argv token as their value. */
const valueTakingGlobalFlags: ReadonlySet<string> = new Set(
  extractFields(z.strictObject(commonArgs))
    .fields.filter((field) => field.type !== "boolean")
    .flatMap((field) => [`--${field.cliName}`, ...(field.alias ?? []).map(toFlagToken)]),
);

function toFlagToken(alias: string): string {
  return alias.length === 1 ? `-${alias}` : `--${alias}`;
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
 * observable from the raw argv. Global options may sit between the parent and
 * the subcommand (`tailor setup --json renovate`), so option tokens and any
 * values they consume are skipped when looking for the invoked name.
 * @param options - Alias detection options
 * @returns true when the alias was the subcommand name following the parent
 */
export function invokedViaAlias(options: InvokedViaAliasOptions): boolean {
  const parentIndex = options.argv.indexOf(options.parent);
  if (parentIndex === -1) return false;
  for (let i = parentIndex + 1; i < options.argv.length; i++) {
    const token = options.argv[i];
    if (token === undefined || token === "--") return false;
    if (!token.startsWith("-")) return token === options.alias;
    if (!token.includes("=") && valueTakingGlobalFlags.has(token)) i++;
  }
  return false;
}
