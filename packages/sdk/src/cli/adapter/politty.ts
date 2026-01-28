/**
 * Politty adapter implementation
 *
 * This adapter wraps politty's parseArgv function to provide a consistent
 * interface that can be used interchangeably with other CLI frameworks.
 */

import { parseArgv, type ParserOptions } from "politty";
import type { ArgsDefinition, CLIAdapter, ParseError, ParseResult, ParsedArgs } from "./types";

/**
 * Convert our unified argument definition to politty's ParserOptions
 * @param argsDef - Unified argument definitions to convert
 * @returns Politty-compatible parser options
 */
function convertToParserOptions(argsDef: ArgsDefinition): ParserOptions {
  const aliasMap = new Map<string, string>();
  const booleanFlags = new Set<string>();

  for (const [name, def] of Object.entries(argsDef)) {
    if (def.type === "boolean") {
      booleanFlags.add(name);
    }
    if ("alias" in def && def.alias) {
      aliasMap.set(def.alias, name);
    }
  }

  return { aliasMap, booleanFlags };
}

/**
 * Merge positional arguments into the result object
 *
 * Maps parsed positionals to their corresponding field names based on
 * the order of positional definitions in argsDef.
 * @param parsed - Parsed result from politty's parseArgv
 * @param parsed.options - Named options (--flag, -f)
 * @param parsed.positionals - Positional arguments
 * @param parsed.rest - Arguments after --
 * @param argsDef - Argument definitions
 * @returns Merged result with positionals mapped to field names
 */
function mergePositionals(
  parsed: { options: Record<string, unknown>; positionals: string[]; rest: string[] },
  argsDef: ArgsDefinition,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...parsed.options };

  // Get positional field names in definition order
  const positionalFields = Object.entries(argsDef)
    .filter(([, def]) => def.type === "positional")
    .map(([name]) => name);

  // Map parsed positionals to their field names
  for (let i = 0; i < positionalFields.length && i < parsed.positionals.length; i++) {
    result[positionalFields[i]] = parsed.positionals[i];
  }

  // Store rest arguments (after --) in _
  result._ = parsed.rest;

  return result;
}

/**
 * Apply default values to parsed arguments
 *
 * This ensures consistent behavior across different CLI frameworks
 * by explicitly applying defaults after parsing.
 * @param parsed - Parsed argument values
 * @param argsDef - Argument definitions with defaults
 * @returns Parsed arguments with defaults applied
 */
function applyDefaults<T extends ArgsDefinition>(
  parsed: Record<string, unknown>,
  argsDef: T,
): ParsedArgs<T> {
  const result: Record<string, unknown> = { ...parsed };

  for (const [name, def] of Object.entries(argsDef)) {
    // Apply default if value is undefined and default exists
    if (result[name] === undefined && def.default !== undefined) {
      result[name] = def.default;
    }

    // For boolean flags, ensure false is the default if not specified
    if (def.type === "boolean" && result[name] === undefined) {
      result[name] = false;
    }
  }

  // Ensure _ array exists
  if (!Array.isArray(result._)) {
    result._ = [];
  }

  return result as ParsedArgs<T>;
}

/**
 * Check for required arguments and return error if missing
 * @param parsed - Parsed argument values
 * @param argsDef - Argument definitions with required flags
 * @returns Parse error if a required argument is missing, undefined otherwise
 */
function checkRequiredArgs(
  parsed: Record<string, unknown>,
  argsDef: ArgsDefinition,
): ParseError | undefined {
  for (const [name, def] of Object.entries(argsDef)) {
    if (def.required && parsed[name] === undefined) {
      return { kind: "missing_required", name };
    }
  }
  return undefined;
}

/**
 * Politty adapter implementation
 */
export const polittyAdapter: CLIAdapter = {
  /**
   * Parse raw arguments according to argument definitions
   * @param rawArgs - Array of command line arguments
   * @param argsDef - Argument definitions
   * @returns Parse result with either parsed arguments or error
   */
  parseArgs: <T extends ArgsDefinition>(rawArgs: string[], argsDef: T): ParseResult<T> => {
    const options = convertToParserOptions(argsDef);
    const parsed = parseArgv(rawArgs, options);
    const merged = mergePositionals(parsed, argsDef);

    const requiredError = checkRequiredArgs(merged, argsDef);
    if (requiredError) {
      return { success: false, error: requiredError };
    }

    const args = applyDefaults(merged, argsDef);
    return { success: true, args };
  },
};
