/**
 * CLI Adapter
 *
 * This module exports the current CLI adapter implementation.
 * During the citty → politty migration, switch the adapter here
 * to verify tests pass with both implementations.
 */

export type {
  ArgsDefinition,
  ArgDefinition,
  StringArgDefinition,
  BooleanArgDefinition,
  PositionalArgDefinition,
  ParsedArgs,
  ParseResult,
  ParseError,
  CLIAdapter,
} from "./types";

// Export the current adapter implementation
export { cittyAdapter as adapter } from "./citty";
