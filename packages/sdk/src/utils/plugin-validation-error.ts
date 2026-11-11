import type { Jsonifiable } from "type-fest";

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
