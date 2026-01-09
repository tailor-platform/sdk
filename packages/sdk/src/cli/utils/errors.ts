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
}

/**
 * CLI error interface with formatted output
 */
export interface CLIError extends Error {
  readonly code?: string;
  readonly details?: string;
  readonly suggestion?: string;
  readonly command?: string;
  format(): string;
}

type CLIErrorInternal = Error & {
  code?: string;
  details?: string;
  suggestion?: string;
  command?: string;
  format(): string;
};

/**
 * Format CLI error for output
 * @param {CLIError} error - CLIError instance to format
 * @returns {string} Formatted error message
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

  return parts.join("");
}

/**
 * Create a CLI error with formatted output
 * @param {CLIErrorOptions} options - Options to construct a CLIError
 * @returns {CLIError} Constructed CLIError instance
 */
function createCLIError(options: CLIErrorOptions): CLIError {
  const error = new Error(options.message) as CLIErrorInternal;
  error.name = "CLIError";
  error.code = options.code;
  error.details = options.details;
  error.suggestion = options.suggestion;
  error.command = options.command;
  error.format = () => formatError(error);
  return error;
}

/**
 * Type guard to check if an error is a CLIError
 * @param {unknown} error - Error to check
 * @returns {error is CLIError} True if the error is a CLIError
 */
export function isCLIError(error: unknown): error is CLIError {
  return error instanceof Error && error.name === "CLIError";
}

// Re-export createCLIError as CLIError for backward compatibility
export { createCLIError as CLIError };
