import { CLIError } from "../shared/errors";
import type { QueryEngine } from "./types";

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

type MapQueryExecutionErrorArgs = {
  error: unknown;
  engine: QueryEngine;
  namespace: string | undefined;
  machineUser?: string;
};

/**
 * Maps errors from query execution to user-friendly CLI errors with suggestions when possible.
 * @param args - The error and context information for mapping
 * @returns A CLIError with a user-friendly message
 */
export function mapQueryExecutionError(args: MapQueryExecutionErrorArgs): Error {
  const message = toErrorMessage(args.error);

  if (message.includes("machine user does not exist")) {
    return CLIError({
      code: "not_found",
      message: `Machine user '${args.machineUser ?? "unknown"}' was not found.`,
      suggestion: "Run `tailor-sdk machineuser list` and use an existing name.",
    });
  }

  if (
    args.engine === "sql" &&
    message.includes(
      "sqlaccess error: failed to fetch schema: query returned an unexpected number of rows",
    )
  ) {
    return CLIError({
      code: "invalid_namespace",
      message: `Failed to load TailorDB schema for namespace '${args.namespace}'.`,
      suggestion:
        "Ensure the query references TailorDB types from a single namespace and re-apply if needed.",
    });
  }

  if (args.engine === "sql" && message.includes("sqlaccess error: failed to parse:")) {
    const parserReason = message
      .split("sqlaccess error: failed to parse:")
      .at(1)
      ?.split("\n")
      .at(0)
      ?.trim();

    return CLIError({
      code: "invalid_sql",
      message: "SQL parse error.",
      suggestion: parserReason ?? "The SQL query contains unsupported syntax.",
    });
  }

  return args.error instanceof Error ? args.error : new Error(message);
}
