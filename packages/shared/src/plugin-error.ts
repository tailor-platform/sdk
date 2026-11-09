interface PluginErrorOutput {
  logger: {
    readonly jsonMode: boolean;
    readonly verbose: boolean;
    log(message: string): void;
    error(message: string): void;
    debug(message: string): void;
  };
  serializeError(error: unknown, options: { includeStack: boolean }): string;
  annotateTerminalError(error: unknown, options: { jsonMode: boolean }): void;
}

function hasFormat(error: unknown): error is { format(): string } {
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { format?: unknown }).format === "function"
  );
}

/** Render a plugin's terminal failure using the host CLI's output facilities. */
export function reportPluginError(error: unknown, output: PluginErrorOutput): void {
  if (!error) return;
  const { logger } = output;
  if (logger.jsonMode) {
    logger.log(output.serializeError(error, { includeStack: logger.verbose }));
  } else if (hasFormat(error)) {
    logger.log(error.format());
  } else if (error instanceof Error) {
    logger.error(error.message);
  } else {
    // oxlint-disable-next-line typescript/no-base-to-string -- Preserve the fallback for non-Error thrown values.
    logger.error(`Unknown error: ${String(error)}`);
  }
  if (!logger.jsonMode && error instanceof Error && error.stack) {
    logger.debug(`\nStack trace:\n${error.stack}`);
  }
  output.annotateTerminalError(error, { jsonMode: logger.jsonMode });
}
