interface WritableLike {
  writableLength: number;
  write(chunk: string, callback: () => void): unknown;
}

interface ExitAfterOutputOptions {
  /** Streams whose queued output must be written first (default: stdout and stderr) */
  streams?: readonly WritableLike[];
  /** Ends the process (default: `process.exit`) */
  exit?: (code: number) => void;
}

/**
 * End the process once the output queued on stdout and stderr has been written, since exiting at
 * once would cut it off when the streams are pipes.
 * @param code - Exit code
 * @param options - Streams to drain and the function that ends the process
 */
export async function exitAfterOutput(
  code: number,
  options: ExitAfterOutputOptions = {},
): Promise<void> {
  const streams = options.streams ?? [process.stdout, process.stderr];
  const exit = options.exit ?? ((exitCode: number) => process.exit(exitCode));
  const queued = streams.filter((stream) => stream.writableLength > 0);
  await Promise.all(
    queued.map((stream) => new Promise<void>((resolve) => stream.write("", () => resolve()))),
  );
  exit(code);
}
