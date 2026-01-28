/**
 * CLI adapter types for abstracting CLI frameworks (citty/politty)
 *
 * This module provides a common interface for CLI argument parsing
 * that allows switching between different CLI frameworks without
 * changing the tests or consuming code.
 */

// ============================================================================
// Argument Definition Types
// ============================================================================

/**
 * Supported argument types
 */
type ArgType = "string" | "boolean" | "positional";

/**
 * Base argument definition
 */
type BaseArgDefinition = {
  type: ArgType;
  description?: string;
  alias?: string;
  required?: boolean;
};

/**
 * String argument definition
 */
export type StringArgDefinition = BaseArgDefinition & {
  type: "string";
  default?: string;
};

/**
 * Boolean argument definition
 */
export type BooleanArgDefinition = BaseArgDefinition & {
  type: "boolean";
  default?: boolean;
};

/**
 * Positional argument definition (no alias allowed)
 */
export type PositionalArgDefinition = Omit<BaseArgDefinition, "alias"> & {
  type: "positional";
  default?: string;
};

/**
 * Union of all argument definition types
 */
export type ArgDefinition = StringArgDefinition | BooleanArgDefinition | PositionalArgDefinition;

/**
 * Record of argument definitions
 */
export type ArgsDefinition = Record<string, ArgDefinition>;

// ============================================================================
// Parsed Result Types
// ============================================================================

/**
 * Extract the value type for an argument definition
 */
type ArgValueType<T extends ArgDefinition> = T extends { type: "boolean" }
  ? boolean
  : T extends { type: "string" }
    ? T extends { required: true }
      ? string
      : T extends { default: string }
        ? string
        : string | undefined
    : T extends { type: "positional" }
      ? T extends { required: true }
        ? string
        : T extends { default: string }
          ? string
          : string | undefined
      : never;

/**
 * Parsed arguments type based on argument definitions
 *
 * IMPORTANT: Use kebab-case keys for accessing parsed arguments.
 * This ensures consistency across different CLI frameworks.
 */
export type ParsedArgs<T extends ArgsDefinition> = {
  [K in keyof T]: ArgValueType<T[K]>;
} & {
  /** Remaining unparsed arguments */
  _: string[];
};

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error when a required argument is missing
 */
type MissingRequiredError = {
  kind: "missing_required";
  name: string;
};

/**
 * Error when an unknown option is provided
 */
type UnknownOptionError = {
  kind: "unknown_option";
  name: string;
};

/**
 * Error when an invalid value is provided
 */
type InvalidValueError = {
  kind: "invalid_value";
  name: string;
  value: unknown;
};

/**
 * Union of all parse error types
 */
export type ParseError = MissingRequiredError | UnknownOptionError | InvalidValueError;

/**
 * Result of parsing arguments
 */
export type ParseResult<T extends ArgsDefinition> =
  | { success: true; args: ParsedArgs<T> }
  | { success: false; error: ParseError };

// ============================================================================
// Adapter Interface
// ============================================================================

/**
 * CLI adapter interface for argument parsing
 *
 * This interface abstracts the CLI framework's argument parsing functionality
 * to allow switching between frameworks (citty/politty) without changing tests.
 */
export type CLIAdapter = {
  /**
   * Parse raw arguments according to argument definitions
   * @param rawArgs - Array of command line arguments (e.g., ["--config", "custom.ts"])
   * @param argsDef - Argument definitions
   * @returns Parse result with either parsed arguments or error
   */
  parseArgs: <T extends ArgsDefinition>(rawArgs: string[], argsDef: T) => ParseResult<T>;
};
