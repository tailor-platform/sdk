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
 */
export function createCLIError(options: CLIErrorOptions): CLIError {
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
 */
export function isCLIError(error: unknown): error is CLIError {
  return error instanceof Error && error.name === "CLIError";
}

// Re-export createCLIError as CLIError for backward compatibility
export { createCLIError as CLIError };

/**
 * Pre-defined error factories for common CLI errors
 */
export const errors = {
  /**
   * Configuration file not found
   */
  configNotFound: (path: string) =>
    createCLIError({
      message: `Configuration file not found: ${path}`,
      suggestion: "Create a tailor.config.ts file or specify the path with --config",
      command: "apply",
      code: "CONFIG_NOT_FOUND",
    }),

  /**
   * User not authenticated
   */
  notLoggedIn: () =>
    createCLIError({
      message: "Not authenticated",
      suggestion:
        "Log in using 'tailor-sdk login' or set TAILOR_PLATFORM_TOKEN environment variable.",
      command: "login",
      code: "NOT_AUTHENTICATED",
    }),

  /**
   * Workspace not found or not specified
   */
  workspaceNotFound: (profile?: string) =>
    createCLIError({
      message: "Workspace ID not specified",
      suggestion: profile
        ? `Profile "${profile}" not found. Create it with 'tailor-sdk profile create'`
        : "Specify --workspace-id or set TAILOR_PLATFORM_WORKSPACE_ID environment variable",
      command: "profile create",
      code: "WORKSPACE_NOT_FOUND",
    }),

  /**
   * Resource not found
   */
  resourceNotFound: (resourceType: string, resourceName: string) =>
    createCLIError({
      message: `${resourceType} "${resourceName}" not found`,
      suggestion: `Verify the ${resourceType.toLowerCase()} exists and you have access to it`,
      code: "RESOURCE_NOT_FOUND",
    }),

  /**
   * Invalid argument value
   */
  invalidArgument: (argName: string, message: string) =>
    createCLIError({
      message: `Invalid ${argName}: ${message}`,
      code: "INVALID_ARGUMENT",
    }),

  /**
   * Operation cancelled by user
   */
  operationCancelled: () =>
    createCLIError({
      message: "Operation cancelled",
      code: "OPERATION_CANCELLED",
    }),

  /**
   * Permission denied
   */
  permissionDenied: (resource?: string) =>
    createCLIError({
      message: resource ? `Permission denied for ${resource}` : "Permission denied",
      suggestion: "Check your access permissions for this resource",
      code: "PERMISSION_DENIED",
    }),
};
