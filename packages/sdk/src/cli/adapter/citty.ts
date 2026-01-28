/**
 * Citty adapter implementation
 *
 * This adapter wraps citty's parseArgs function to provide a consistent
 * interface that can be used interchangeably with other CLI frameworks.
 */

import { parseArgs as cittyParseArgs, type ArgsDef as CittyArgsDef } from "citty";
import type { ArgsDefinition, CLIAdapter, ParseError, ParseResult, ParsedArgs } from "./types";

/**
 * Convert our unified argument definition to citty's format
 * @param argsDef - Unified argument definitions to convert
 * @returns Citty-compatible argument definitions
 */
function convertToCittyArgs(argsDef: ArgsDefinition): CittyArgsDef {
  const cittyArgs: CittyArgsDef = {};

  for (const [name, def] of Object.entries(argsDef)) {
    // Build citty definition based on arg type
    if (def.type === "positional") {
      cittyArgs[name] = {
        type: "positional",
        description: def.description,
        required: def.required,
        default: def.default,
      };
    } else if (def.type === "boolean") {
      cittyArgs[name] = {
        type: "boolean",
        description: def.description,
        required: def.required,
        default: def.default,
        alias: def.alias,
      };
    } else {
      // string type
      cittyArgs[name] = {
        type: "string",
        description: def.description,
        required: def.required,
        default: def.default,
        alias: def.alias,
      };
    }
  }

  return cittyArgs;
}

/**
 * Apply default values to parsed arguments
 *
 * This ensures consistent behavior across different CLI frameworks
 * by explicitly applying defaults after parsing.
 * @param parsed - Parsed argument values from citty
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
 * Convert citty error to our unified error type
 * @param error - Error thrown by citty
 * @returns Unified parse error
 */
function convertError(error: unknown): ParseError {
  if (error instanceof Error) {
    const message = error.message;

    // Check for missing required argument (citty format: "Missing required argument: --name")
    const missingArgMatch = message.match(/Missing required argument[:\s]*--?([\w-]+)/i);
    if (missingArgMatch) {
      return { kind: "missing_required", name: missingArgMatch[1] };
    }

    // Check for missing required positional (citty format: "Missing required positional argument: NAME")
    const missingPositionalMatch = message.match(
      /Missing required positional argument[:\s]*([\w-]+)/i,
    );
    if (missingPositionalMatch) {
      // citty uppercases positional names, convert back to camelCase
      const name = missingPositionalMatch[1].toLowerCase();
      return { kind: "missing_required", name };
    }

    // Check for unknown option
    const unknownMatch = message.match(
      /Unknown (?:option|argument)[:\s]*["`']?--?(\w[\w-]*)["`']?/i,
    );
    if (unknownMatch) {
      return { kind: "unknown_option", name: unknownMatch[1] };
    }
  }

  // Default to unknown option error
  return { kind: "unknown_option", name: "unknown" };
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
 * Citty adapter implementation
 */
export const cittyAdapter: CLIAdapter = {
  /**
   * Parse raw arguments according to argument definitions
   * @param rawArgs - Array of command line arguments
   * @param argsDef - Argument definitions
   * @returns Parse result with either parsed arguments or error
   */
  parseArgs: <T extends ArgsDefinition>(rawArgs: string[], argsDef: T): ParseResult<T> => {
    try {
      const cittyArgsDef = convertToCittyArgs(argsDef);
      const parsed = cittyParseArgs(rawArgs, cittyArgsDef);

      // citty throws for required args, but double-check for positional args
      // which may not trigger the built-in required check
      const requiredError = checkRequiredArgs(parsed, argsDef);
      if (requiredError) {
        return { success: false, error: requiredError };
      }

      const args = applyDefaults(parsed, argsDef);
      return { success: true, args };
    } catch (error) {
      return { success: false, error: convertError(error) };
    }
  },
};
