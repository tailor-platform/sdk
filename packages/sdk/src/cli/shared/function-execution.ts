import { timestampDate } from "@bufbuild/protobuf/wkt";
import {
  FunctionExecution_Status,
  FunctionLogSeverity,
} from "@tailor-platform/tailor-proto/function_resource_pb";
import { styles } from "./logger";
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
  switch (status) {
    case FunctionExecution_Status.RUNNING:
      return "RUNNING";
    case FunctionExecution_Status.SUCCESS:
      return "SUCCESS";
    case FunctionExecution_Status.FAILED:
      return "FAILED";
    case FunctionExecution_Status.SUSPEND:
      return "SUSPEND";
    case FunctionExecution_Status.CANCELING:
      return "CANCELING";
    case FunctionExecution_Status.CANCELED:
      return "CANCELED";
    default:
      return "UNSPECIFIED";
  }
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

/**
 * Check if function execution status is terminal.
 * @param status - Function execution status enum value
 * @returns True if status is terminal
 */
export function isFunctionExecutionTerminalStatus(status: FunctionExecution_Status): boolean {
  return (
    status === FunctionExecution_Status.SUCCESS ||
    status === FunctionExecution_Status.FAILED ||
    status === FunctionExecution_Status.CANCELED
  );
}

/**
 * Convert function log severity enum to string.
 * @param severity - Function log severity enum value
 * @returns Severity string representation
 */
export function functionLogSeverityToString(severity: FunctionLogSeverity): string {
  switch (severity) {
    case FunctionLogSeverity.LOG:
      return "LOG";
    case FunctionLogSeverity.DEBUG:
      return "DEBUG";
    case FunctionLogSeverity.INFO:
      return "INFO";
    case FunctionLogSeverity.WARNING:
      return "WARNING";
    case FunctionLogSeverity.ERROR:
      return "ERROR";
    default:
      return "UNSPECIFIED";
  }
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
 * Build the lines of a logs section. Structured entries take precedence;
 * the flat `logs` string is used only when no entries are available.
 * @param logEntries - Structured log entries, if any
 * @param logs - Flat newline-delimited logs, if any
 * @returns Lines to print, empty when there is nothing to show
 */
export function formatFunctionLogLines(
  logEntries: FunctionLogEntryInfo[] | undefined,
  logs: string | undefined,
): string[] {
  if (logEntries && logEntries.length > 0) {
    return logEntries.map(formatFunctionLogEntry);
  }
  return logs ? logs.split("\n") : [];
}
