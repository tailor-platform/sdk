import { CLIError, isCLIError, toError } from "../shared/errors";
import type { QueryEngine } from "./types";

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

const INVALID_SQL = "INVALID_SQL";

/**
 * Build the error for SQL the local parser rejects, under the code of the server's parse failure.
 * @param cause - What the parser threw
 * @returns CLIError carrying the parser's message
 */
export function sqlParseError(cause: unknown): CLIError {
  return CLIError({
    code: INVALID_SQL,
    message: `SQL parse error: ${toErrorMessage(cause)}`,
    suggestion:
      'If your table name is a reserved keyword (e.g. User), wrap it in double quotes: SELECT * FROM "User"',
    cause,
  });
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
  if (isCLIError(args.error) && args.error.code === INVALID_SQL) {
    return args.error;
  }

  const message = toErrorMessage(args.error);

  if (message.includes("machine user does not exist")) {
    return CLIError({
      code: "MACHINE_USER_NOT_FOUND",
      message: `Machine user '${args.machineUser ?? "unknown"}' was not found.`,
      suggestion: "Run `tailor machineuser list` and use an existing name.",
    });
  }

  if (
    args.engine === "sql" &&
    message.includes(
      "sqlaccess error: failed to fetch schema: query returned an unexpected number of rows",
    )
  ) {
    return CLIError({
      code: "INVALID_NAMESPACE",
      message: `Failed to load TailorDB schema for namespace '${args.namespace}'.`,
      suggestion:
        "Ensure the query references TailorDB tables from a single namespace and re-apply if needed.",
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
      code: INVALID_SQL,
      message: "SQL parse error.",
      suggestion: parserReason ?? "The SQL query contains unsupported syntax.",
    });
  }

  return toError(args.error);
}
