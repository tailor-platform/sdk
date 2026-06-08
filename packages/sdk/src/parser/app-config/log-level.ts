export const LOG_LEVELS = ["DEBUG", "INFO", "WARN", "ERROR", "SILENT"] as const;

export function isLogLevel(value: string): value is (typeof LOG_LEVELS)[number] {
  return (LOG_LEVELS as readonly string[]).includes(value);
}
