import { Code, ConnectError } from "@connectrpc/connect";
import chalk from "chalk";

/**
 * Options for creating a CLI error
 */
export interface CLIErrorOptions {
  message: string;
  details?: string;
  suggestion?: string;
  command?: string;
  code?: string;
  next?: CLIErrorNextAction;
  context?: Readonly<Record<string, unknown>>;
}

export interface CLIErrorNextAction {
  /** Executable name, such as `tailor-sdk`. */
  command: string;
  /** Arguments passed directly to the executable. */
  args: readonly string[];
}

export interface ErrorToJsonOptions {
  includeStack?: boolean;
}

/**
 * CLI error interface with formatted output
 */
export interface CLIError extends Error {
  readonly code?: string;
  readonly details?: string;
  readonly suggestion?: string;
  readonly command?: string;
  readonly next?: CLIErrorNextAction;
  readonly context?: Readonly<Record<string, unknown>>;
  format(): string;
}

type CLIErrorInternal = Error & {
  code?: string;
  details?: string;
  suggestion?: string;
  command?: string;
  next?: CLIErrorNextAction;
  context?: Readonly<Record<string, unknown>>;
  format(): string;
};

function shellQuote(value: string): string {
  if (process.platform === "win32") {
    if (/^[A-Za-z0-9_./:=@+\\-]+$/.test(value)) return value;
    return `"${value.replaceAll('"', '\\"')}"`;
  }
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

/**
 * Format CLI error for output
 * @param error - CLIError instance to format
 * @returns Formatted error message
 */
function formatError(error: CLIError): string {
  const parts: string[] = [
    chalk.red(`Error${error.code ? ` [${error.code}]` : ""}: ${error.message}`),
  ];

  if (error.details) {
    parts.push(`\n  ${chalk.gray("Details:")} ${error.details}`);
  }

  if (error.suggestion) {
    parts.push(`\n  ${chalk.cyan("Suggestion:")} ${error.suggestion}`);
  }

  if (error.command) {
    parts.push(
      `\n  ${chalk.gray("Help:")} Run \`tailor-sdk ${error.command} --help\` for usage information.`,
    );
  }

  if (error.next) {
    const command = [error.next.command, ...error.next.args].map(shellQuote).join(" ");
    parts.push(`\n  ${chalk.cyan("Next:")} Run \`${command}\`.`);
  }

  return parts.join("");
}

/**
 * Create a CLI error with formatted output
 * @param options - Options to construct a CLIError
 * @returns Constructed CLIError instance
 */
function createCLIError(options: CLIErrorOptions): CLIError {
  const error = new Error(options.message) as CLIErrorInternal;
  error.name = "CLIError";
  error.code = options.code;
  error.details = options.details;
  error.suggestion = options.suggestion;
  error.command = options.command;
  error.next = options.next;
  error.context = options.context;
  error.format = () => formatError(error);
  return error;
}

/**
 * Type guard to check if an error is a CLIError
 * @param error - Error to check
 * @returns True if the error is a CLIError
 */
export function isCLIError(error: unknown): error is CLIError {
  return error instanceof Error && error.name === "CLIError";
}

/**
 * Convert a CLI failure into the stable JSON error envelope.
 * @param error - Failure to serialize
 * @param options - JSON serialization options
 * @returns JSON-compatible error envelope
 */
export function errorToJson(
  error: unknown,
  options?: ErrorToJsonOptions,
): { error: Readonly<Record<string, unknown>> } {
  if (isCLIError(error)) {
    return {
      error: {
        code: error.code ?? "CLI_ERROR",
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
        ...(error.suggestion ? { suggestion: error.suggestion } : {}),
        ...(error.command
          ? {
              help: executableHelpAction(error.command),
            }
          : {}),
        ...(error.next ? { next: error.next } : {}),
        ...(error.context ? { context: error.context } : {}),
        ...(options?.includeStack && error.stack ? { stack: error.stack } : {}),
      },
    };
  }
  if (error instanceof ConnectError) {
    const codeName = Code[error.code];
    const stableCode = codeName.replaceAll(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
    return { error: { code: `RPC_${stableCode}`, message: error.message } };
  }
  if (error instanceof Error) {
    return {
      error: {
        code: error.name === "CIPromptError" ? "INTERACTIVE_PROMPT_REQUIRED" : "UNEXPECTED_ERROR",
        message: error.message,
        ...(options?.includeStack && error.stack ? { stack: error.stack } : {}),
      },
    };
  }
  return { error: { code: "UNKNOWN_ERROR", message: String(error) } };
}

function executableHelpAction(command: string): CLIErrorNextAction {
  return {
    command: "tailor-sdk",
    args: [...command.split(/\s+/).filter(Boolean), "--help"],
  };
}

// Re-export createCLIError as CLIError for backward compatibility
export { createCLIError as CLIError };
