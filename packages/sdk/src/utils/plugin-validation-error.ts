import type { Jsonifiable } from "type-fest";

const PLUGIN_VALIDATION_ERROR = Symbol.for("tailor-platform/sdk:plugin-validation-error");

interface PluginValidationErrorOptions {
  /** Stable identifier for the validation failure. */
  code: string;
  /** What is invalid in the plugin's configuration. */
  message: string;
  /** How to fix the configuration. */
  suggestion?: string;
  /** JSON-serializable facts identifying the invalid values. */
  context?: Readonly<Record<string, Jsonifiable | undefined>>;
}

/** A plugin configuration failure reported with its code and context by the CLI. */
export class PluginValidationError extends Error {
  readonly [PLUGIN_VALIDATION_ERROR] = true;
  /** Stable identifier for the validation failure. */
  readonly code: string;
  /** How to fix the configuration. */
  readonly suggestion?: string;
  /** JSON-serializable facts identifying the invalid values. */
  readonly context?: PluginValidationErrorOptions["context"];

  /**
   * Construct a validation failure to throw while creating a plugin in the config.
   * @param options - Failure description and recovery guidance
   */
  constructor(options: PluginValidationErrorOptions) {
    super(options.message);
    this.name = "PluginValidationError";
    this.code = options.code;
    this.suggestion = options.suggestion;
    this.context = options.context;
  }
}

/**
 * Identify plugin validation failures across SDK copies.
 * @param value - Value thrown while loading configuration
 * @returns Whether the value carries the plugin validation error brand
 */
export function isPluginValidationError(value: unknown): value is PluginValidationError {
  return (
    typeof value === "object" &&
    value !== null &&
    PLUGIN_VALIDATION_ERROR in value &&
    value[PLUGIN_VALIDATION_ERROR] === true
  );
}
