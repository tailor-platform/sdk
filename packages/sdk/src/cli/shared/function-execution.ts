import { timestampDate } from "@bufbuild/protobuf/wkt";
import {
  FunctionExecution_Status,
  FunctionLogSeverity,
} from "@tailor-platform/tailor-proto/function_resource_pb";
import { styles } from "./logger";
import { protoEnumLookup, protoEnumName } from "./proto-enum";
import type { FunctionLogEntry } from "@tailor-platform/tailor-proto/function_resource_pb";

/**
 * A structured log line recorded while a function execution ran.
 */
export interface FunctionLogEntryInfo {
  /** Log message */
  message: string;
  /** Severity name such as `INFO`, `WARNING`, or `ERROR` */
  severity: string;
  /** When the line was logged, or null when unknown */
  timestamp: Date | null;
}

/**
 * Convert function execution status enum to string.
 * @param status - Function execution status enum value
 * @returns Status string representation
 */
export function functionExecutionStatusToString(status: FunctionExecution_Status): string {
  return protoEnumName(FunctionExecution_Status, status) ?? "UNSPECIFIED";
}

/**
 * Colorize function execution status string.
 * @param status - Function execution status string
 * @returns Colorized status string
 */
export function colorizeFunctionExecutionStatus(status: string): string {
  switch (status) {
    case "RUNNING":
      return styles.info(status);
    case "SUCCESS":
      return styles.success(status);
    case "FAILED":
      return styles.error(status);
    default:
      return status;
  }
}

const FUNCTION_EXECUTION_TERMINAL = {
  [FunctionExecution_Status.UNSPECIFIED]: false,
  [FunctionExecution_Status.RUNNING]: false,
  [FunctionExecution_Status.SUCCESS]: true,
  [FunctionExecution_Status.FAILED]: true,
  [FunctionExecution_Status.SUSPEND]: false,
  [FunctionExecution_Status.CANCELING]: false,
  [FunctionExecution_Status.CANCELED]: true,
} satisfies Record<FunctionExecution_Status, boolean>;

/**
 * Check if function execution status is terminal.
 * @param status - Function execution status enum value
 * @returns True if status is terminal
 */
export function isFunctionExecutionTerminalStatus(status: FunctionExecution_Status): boolean {
  // A status newer than the stubs is treated as not terminal, so waiting continues until the timeout.
  return protoEnumLookup(FUNCTION_EXECUTION_TERMINAL, status, false);
}

/**
 * Convert function log severity enum to string.
 * @param severity - Function log severity enum value
 * @returns Severity string representation
 */
export function functionLogSeverityToString(severity: FunctionLogSeverity): string {
  return protoEnumName(FunctionLogSeverity, severity) ?? "UNSPECIFIED";
}

/**
 * Transform a FunctionLogEntry proto into CLI-friendly log entry info.
 * @param entry - Function log entry from proto
 * @returns Log entry info with string severity and Date timestamp
 */
export function toFunctionLogEntryInfo(entry: FunctionLogEntry): FunctionLogEntryInfo {
  return {
    message: entry.message,
    severity: functionLogSeverityToString(entry.severity),
    timestamp: entry.timestamp ? timestampDate(entry.timestamp) : null,
  };
}

function colorizeLogSeverity(severity: string): string {
  const label = `[${severity}]`;
  switch (severity) {
    case "ERROR":
      return styles.error(label);
    case "WARNING":
      return styles.warning(label);
    case "DEBUG":
      return styles.dim(label);
    default:
      return label;
  }
}

/**
 * Format a log entry as a single human-readable line.
 * @param entry - Log entry info
 * @returns `<timestamp> [<severity>] <message>`
 */
export function formatFunctionLogEntry(entry: FunctionLogEntryInfo): string {
  const timestamp = entry.timestamp ? entry.timestamp.toISOString() : "N/A";
  return `${styles.dim(timestamp)} ${colorizeLogSeverity(entry.severity)} ${entry.message}`;
}

/**
 * Build the lines of a logs section.
 * @param logEntries - Structured log entries, if any
 * @returns Lines to print, empty when there is nothing to show
 */
export function formatFunctionLogLines(logEntries: FunctionLogEntryInfo[] | undefined): string[] {
  return logEntries ? logEntries.map(formatFunctionLogEntry) : [];
}

/**
 * Join the messages of structured log entries into newline-delimited text.
 * @param logEntries - Log entries from a function execution
 * @returns Messages joined with newlines, empty when there are no entries
 */
export function joinFunctionLogMessages(logEntries: readonly FunctionLogEntry[]): string {
  return logEntries.map((entry) => entry.message).join("\n");
}
