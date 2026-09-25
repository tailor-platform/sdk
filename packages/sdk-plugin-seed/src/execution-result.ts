import { logger, styles } from "@tailor-platform/sdk/cli";
import type { ScriptExecutionResult } from "@tailor-platform/sdk/cli";

/**
 * Relay the `console.log` output a bundled script produced while it ran, so
 * per-page/per-chunk progress reaches the user instead of being discarded.
 * @param logs - Raw log output the script execution returned, if any
 * @param indent - Left padding to align the relayed lines with surrounding output
 */
function logExecutionLogs(logs: string | undefined, indent: string): void {
  if (!logs) return;
  for (const line of logs.split("\n").filter(Boolean)) {
    logger.log(styles.dim(`${indent}${line}`));
  }
}

export interface ParsedExecutionResult {
  success: boolean;
  parsed: Record<string, unknown>;
  errors: string[];
  /** True when the transport call itself failed or its result could not be parsed, so it is unknown whether the script's effects were applied. */
  outcomeUnknown: boolean;
}

/**
 * Relay a script execution's logs, then parse its JSON result into a
 * consistent success/error/parsed shape. Shared by `apply.ts` and `dump.ts`
 * so a fix to how results are interpreted only needs to happen once.
 * @param result - Raw script execution result from the operator client
 * @param indent - Left padding used when relaying the script's logs
 * @returns Whether the script succeeded, its parsed payload, and any errors
 */
export function parseExecutionResult(
  result: ScriptExecutionResult,
  indent: string,
): ParsedExecutionResult {
  logExecutionLogs(result.logs, indent);

  if (!result.success) {
    return {
      success: false,
      parsed: {},
      errors: [result.error ?? "Script execution failed"],
      outcomeUnknown: true,
    };
  }

  let parsed: Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(result.result || "{}");
    parsed = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      parsed: {},
      errors: [`Failed to parse result: ${message}`],
      outcomeUnknown: true,
    };
  }

  if (!parsed.success) {
    const errors = Array.isArray(parsed.errors) ? (parsed.errors as string[]) : [];
    return {
      success: false,
      parsed,
      errors: errors.length > 0 ? errors : ["Script reported failure"],
      outcomeUnknown: false,
    };
  }

  return { success: true, parsed, errors: [], outcomeUnknown: false };
}
