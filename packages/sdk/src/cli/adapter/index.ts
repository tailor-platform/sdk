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

// Export both adapters for testing and migration purposes
export { cittyAdapter } from "./citty";
export { polittyAdapter } from "./politty";

// Export the current adapter implementation
// During migration, switch between citty and politty here:
// export { cittyAdapter as adapter } from "./citty";
export { polittyAdapter as adapter } from "./politty";
