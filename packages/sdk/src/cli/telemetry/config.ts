/**
 * Telemetry configuration parsed from standard OpenTelemetry environment variables.
 * Tracing is enabled when OTEL_EXPORTER_OTLP_ENDPOINT is set.
 */
export interface TelemetryConfig {
  readonly enabled: boolean;
  readonly endpoint: string;
  readonly serviceName: string;
  readonly headers: Record<string, string>;
}

/**
 * Parse OTEL_EXPORTER_OTLP_HEADERS value into a key-value record.
 * Format: "key1=value1,key2=value2"
 * @param raw - Raw header string from environment variable
 * @returns Parsed headers record
 */
function parseHeaders(raw: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!raw) return headers;

  for (const pair of raw.split(",")) {
    const eqIndex = pair.indexOf("=");
    if (eqIndex === -1) continue;
    const key = pair.slice(0, eqIndex).trim();
    const value = pair.slice(eqIndex + 1).trim();
    if (key) {
      headers[key] = value;
    }
  }
  return headers;
}

/**
 * Parse telemetry configuration from standard OpenTelemetry environment variables.
 * Tracing is enabled when OTEL_EXPORTER_OTLP_ENDPOINT is set.
 * @returns Telemetry configuration
 */
export function parseTelemetryConfig(): TelemetryConfig {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "";
  const enabled = endpoint.length > 0;

  return {
    enabled,
    endpoint,
    serviceName: process.env.OTEL_SERVICE_NAME ?? "tailor-sdk",
    headers: parseHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS ?? ""),
  };
}
