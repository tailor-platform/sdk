interface PluginErrorOutput {
  logger: {
    readonly jsonMode: boolean;
    readonly verbose: boolean;
    log(message: string): void;
    error(message: string): void;
    debug(message: string): void;
  };
  locatedMessage(error: Error): string;
  serializeError(error: unknown, options: { includeStack: boolean }): string;
  annotateTerminalError(error: unknown, options: { jsonMode: boolean }): void;
}

function formattedText(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const format = (error as { format?: unknown }).format;
  if (typeof format !== "function") return undefined;
  const formatted: unknown = format.call(error);
  return typeof formatted === "string" ? formatted : undefined;
}

/** Render a plugin's terminal failure using the host CLI's output facilities. */
export function reportPluginError(error: unknown, output: PluginErrorOutput): void {
  if (!error) return;
  const { logger } = output;
  const formatted = formattedText(error);
  if (logger.jsonMode) {
    logger.log(output.serializeError(error, { includeStack: logger.verbose }));
  } else if (formatted !== undefined) {
    logger.log(formatted);
  } else if (error instanceof Error) {
    logger.error(output.locatedMessage(error));
  } else {
    // oxlint-disable-next-line typescript/no-base-to-string -- Preserve the fallback for non-Error thrown values.
    logger.error(`Unknown error: ${String(error)}`);
  }
  if (!logger.jsonMode && error instanceof Error && error.stack) {
    logger.debug(`\nStack trace:\n${error.stack}`);
  }
  output.annotateTerminalError(error, { jsonMode: logger.jsonMode });
}
