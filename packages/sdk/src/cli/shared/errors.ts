import { styles } from "./logger";

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
  /** Executable name, such as `tailor`. */
  command: string;
  /** Arguments passed directly to the executable. */
  args: readonly string[];
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

function needsArgvRendering(argv: readonly string[]): boolean {
  // cmd.exe/PowerShell expand %, $, and ! even inside double quotes, so no
  // quoting can keep such values literal on Windows.
  return process.platform === "win32" && argv.some((value) => /[%$!]/.test(value));
}

/**
 * Render an argv array as a copyable command line for the current platform's shell
 * @param {readonly string[]} argv - Executable name followed by its arguments
 * @returns {string} A shell-quoted command line, or an `argv [...]` JSON rendering when the platform shell cannot keep a value literal
 */
export function formatCopyableCommand(argv: readonly string[]): string {
  if (needsArgvRendering(argv)) {
    return `argv ${JSON.stringify(argv)}`;
  }
  return argv.map(shellQuote).join(" ");
}

function formatNextAction(next: CLIErrorNextAction): string {
  const argv = [next.command, ...next.args];
  const rendered = formatCopyableCommand(argv);
  return needsArgvRendering(argv) ? `with ${rendered}` : `\`${rendered}\``;
}

/**
 * Format CLI error for output
 * @param error - CLIError instance to format
 * @returns Formatted error message
 */
function formatError(error: CLIError): string {
  const parts: string[] = [
    styles.error(`Error${error.code ? ` [${error.code}]` : ""}: ${error.message}`),
  ];

  if (error.details) {
    parts.push(`\n  ${styles.dim("Details:")} ${error.details}`);
  }

  if (error.suggestion) {
    parts.push(`\n  ${styles.info("Suggestion:")} ${error.suggestion}`);
  }

  if (error.command) {
    parts.push(
      `\n  ${styles.dim("Help:")} Run \`tailor ${error.command} --help\` for usage information.`,
    );
  }

  if (error.next) {
    parts.push(`\n  ${styles.info("Next:")} Run ${formatNextAction(error.next)}.`);
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

// Re-export createCLIError as CLIError for backward compatibility
export { createCLIError as CLIError };
