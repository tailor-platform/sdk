import type { LogLevel } from "@/types/app-config";

export const LOG_LEVELS = [
  "DEBUG",
  "INFO",
  "WARN",
  "ERROR",
  "SILENT",
] as const satisfies readonly LogLevel[];

export function isLogLevel(value: string): value is LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value);
}
