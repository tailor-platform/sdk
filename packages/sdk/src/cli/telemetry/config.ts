/**
 * Telemetry configuration parsed from standard OpenTelemetry environment variables.
 * Tracing is enabled when OTEL_EXPORTER_OTLP_ENDPOINT is set.
 */
export interface TelemetryConfig {
  readonly enabled: boolean;
  readonly endpoint: string;
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
  };
}
