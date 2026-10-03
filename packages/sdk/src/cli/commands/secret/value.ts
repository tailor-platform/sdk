import { CLIError } from "#/cli/shared/errors";

/** Largest secret value accepted from standard input, in KiB. */
export const MAX_PIPED_SECRET_KIB = 128;

/** Parsed `--value` option. */
export interface SecretValueArgs {
  value?: string | undefined;
}

/** Stream the secret value is read from when `--value` is omitted. */
export type SecretValueInput = AsyncIterable<string | Uint8Array> & { isTTY?: boolean | undefined };

/**
 * Resolve the secret value from `--value`, or from standard input when `--value` is omitted.
 * A piped value is limited to {@link MAX_PIPED_SECRET_KIB} KiB, and one trailing newline is removed from it.
 * @param args - Parsed `--value` option
 * @param stdin - Stream read when `--value` is omitted
 * @param command - Command path shown in the error's help hint
 * @returns The secret value
 */
export async function resolveSecretValue(
  args: SecretValueArgs,
  stdin: SecretValueInput,
  command: string,
): Promise<string> {
  if (args.value !== undefined) return args.value;
  const missing = (reason: string) =>
    CLIError({
      code: "SECRET_VALUE_REQUIRED",
      message: `No secret value was given: --value is omitted and standard input ${reason}.`,
      suggestion: "Pass --value, or pipe or redirect the value into the command.",
      command,
    });
  if (stdin.isTTY === true) throw missing("is a terminal");

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
  if (value === "") throw missing("is empty");
  return value;
}
