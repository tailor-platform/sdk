import { isLogLevel, LOG_LEVELS } from "#/parser/app-config/log-level";
import type { LogLevel, LogLevelInput } from "#/configure/config/types";
import type { TreeshakingOptions } from "rolldown";

const INFO_LEVEL_CONSOLE_METHODS = [
  "console.info",
  "console.table",
  "console.dir",
  "console.dirxml",
  "console.count",
  "console.countReset",
  "console.time",
  "console.timeLog",
  "console.timeEnd",
  "console.group",
  "console.groupCollapsed",
  "console.groupEnd",
  "console.clear",
] as const;

// `console.log` is treated as a DEBUG-level method to stay consistent with the
// platform's OpenTelemetry severity mapping, where the deployment runtime emits
// `console.log` at DEBUG severity rather than INFO.
const DEBUG_LEVEL_CONSOLE_METHODS = ["console.debug", "console.log", "console.trace"] as const;

const WARN_LEVEL_CONSOLE_METHODS = ["console.warn"] as const;

// `console.assert` is intentionally excluded: on the deployment runtime
// (deno_core/V8) only log/debug/info/warn/error are wrapped with a log
// severity, so `console.assert` sits outside the platform's severity system
// and is never dropped by the log-level treeshaking.
const ERROR_LEVEL_CONSOLE_METHODS = ["console.error"] as const;

const MANUAL_PURE_FUNCTIONS_BY_LOG_LEVEL: Record<LogLevel, readonly string[]> = {
  DEBUG: [],
  INFO: DEBUG_LEVEL_CONSOLE_METHODS,
  WARN: [...DEBUG_LEVEL_CONSOLE_METHODS, ...INFO_LEVEL_CONSOLE_METHODS],
  ERROR: [
    ...DEBUG_LEVEL_CONSOLE_METHODS,
    ...INFO_LEVEL_CONSOLE_METHODS,
    ...WARN_LEVEL_CONSOLE_METHODS,
  ],
  SILENT: [
    ...DEBUG_LEVEL_CONSOLE_METHODS,
    ...INFO_LEVEL_CONSOLE_METHODS,
    ...WARN_LEVEL_CONSOLE_METHODS,
    ...ERROR_LEVEL_CONSOLE_METHODS,
  ],
};

export function normalizeBundleLogLevel(value: string): LogLevel | undefined {
  const normalized = value.trim().toUpperCase();
  return isLogLevel(normalized) ? normalized : undefined;
}

export function resolveBundleLogLevel(configValue?: LogLevelInput): LogLevel {
  if (configValue === undefined) return "DEBUG";
  const resolved = normalizeBundleLogLevel(configValue);
  if (resolved) return resolved;

  throw new Error(`Invalid logLevel "${configValue}". Expected one of: ${LOG_LEVELS.join(", ")}`);
}

export function manualPureFunctionsForLogLevel(logLevel: LogLevel): readonly string[] {
  return MANUAL_PURE_FUNCTIONS_BY_LOG_LEVEL[logLevel];
}

export function createLogLevelTreeshakeOptions(logLevel: LogLevel): TreeshakingOptions {
  const manualPureFunctions = manualPureFunctionsForLogLevel(logLevel);
  return manualPureFunctions.length > 0 ? { manualPureFunctions } : {};
}
