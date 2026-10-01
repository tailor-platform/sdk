import { CLIError } from "#/cli/shared/errors";

/** Largest secret value `--value-stdin` accepts, in KiB. */
export const MAX_PIPED_SECRET_KIB = 128;

/** Parsed `--value` / `--value-stdin` options. */
export interface SecretValueArgs {
  value?: string | undefined;
  "value-stdin": boolean;
}

/** Stream the secret value is read from when `--value-stdin` is set. */
export type SecretValueInput = AsyncIterable<string | Uint8Array> & { isTTY?: boolean | undefined };

/**
 * Resolve the secret value from `--value`, or from standard input with `--value-stdin`.
 * A piped value is limited to {@link MAX_PIPED_SECRET_KIB} KiB, and one trailing newline is removed from it.
 * @param args - Parsed `--value` / `--value-stdin` options
 * @param stdin - Stream read when `--value-stdin` is set
 * @param command - Command path shown in the error's help hint
 * @returns The secret value
 */
export async function resolveSecretValue(
  args: SecretValueArgs,
  stdin: SecretValueInput,
  command: string,
): Promise<string> {
  if (args.value !== undefined && args["value-stdin"]) {
    throw CLIError({
      code: "SECRET_VALUE_OPTIONS_CONFLICT",
      message: "--value and --value-stdin cannot be used together.",
      command,
    });
  }
  if (args.value !== undefined) return args.value;
  if (!args["value-stdin"]) {
    throw CLIError({
      code: "SECRET_VALUE_REQUIRED",
      message: "No secret value was given.",
      suggestion: "Pass --value, or pipe the value to standard input with --value-stdin.",
      command,
    });
  }
  if (stdin.isTTY === true) {
    throw CLIError({
      code: "SECRET_VALUE_STDIN_TTY",
      message: "--value-stdin cannot read the secret value from a terminal.",
      suggestion: "Pipe or redirect the value into the command, or pass it with --value.",
      command,
    });
  }

  const maxBytes = MAX_PIPED_SECRET_KIB * 1024;
  const tooLarge = () =>
    CLIError({
      code: "SECRET_VALUE_TOO_LARGE",
      message: `The secret value read from standard input exceeds ${MAX_PIPED_SECRET_KIB} KiB.`,
      command,
    });
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of stdin) {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    size += bytes.length;
    if (size > maxBytes + "\r\n".length) throw tooLarge();
    chunks.push(bytes);
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks));
  } catch (error) {
    throw CLIError({
      code: "SECRET_VALUE_INVALID_UTF8",
      message: "The secret value read from standard input is not valid UTF-8.",
      command,
      cause: error,
    });
  }
  const value = text.replace(/\r?\n$/, "");
  if (Buffer.byteLength(value) > maxBytes) throw tooLarge();
  if (value === "") {
    throw CLIError({
      code: "SECRET_VALUE_EMPTY",
      message: "The secret value read from standard input is empty.",
      command,
    });
  }
  return value;
}
