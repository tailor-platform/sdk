import { buffer } from "node:stream/consumers";
import { CLIError } from "#/cli/shared/errors";

/** Parsed `--value` / `--value-stdin` options. */
export interface SecretValueArgs {
  value?: string | undefined;
  "value-stdin": boolean;
}

/** Stream the secret value is read from when `--value-stdin` is set. */
export type SecretValueInput = AsyncIterable<string | Uint8Array> & { isTTY?: boolean | undefined };

/**
 * Resolve the secret value from `--value`, or from standard input with `--value-stdin`.
 * One trailing newline is removed from a piped value.
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
      message:
        "--value-stdin reads the secret value from a pipe, but standard input is a terminal.",
      suggestion: "Pipe the value into the command, or pass it with --value.",
      command,
    });
  }

  const bytes = await buffer(stdin);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw CLIError({
      code: "SECRET_VALUE_INVALID_UTF8",
      message: "The secret value read from standard input is not valid UTF-8.",
      command,
      cause: error,
    });
  }
  const value = text.replace(/\r?\n$/, "");
  if (value === "") {
    throw CLIError({
      code: "SECRET_VALUE_EMPTY",
      message: "The secret value read from standard input is empty.",
      command,
    });
  }
  return value;
}
