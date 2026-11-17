import { errorToJson } from "@tailor-platform/sdk/cli";

/**
 * Prefix a failure's message with the file it points at, as the host CLI prints it.
 * @param error - Failure to print
 * @returns The message of the failure's JSON error envelope
 */
export function locatedMessage(error: Error): string {
  const { message } = errorToJson(error).error;
  return typeof message === "string" ? message : error.message;
}
