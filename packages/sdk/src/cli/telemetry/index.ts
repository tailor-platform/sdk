import { trace, SpanStatusCode, type Span } from "@opentelemetry/api";
import { parseTelemetryConfig, type TelemetryConfig } from "./config";

let _config: TelemetryConfig | undefined;
let _initialized = false;
let _provider: { register: () => void; shutdown: () => Promise<void> } | undefined;

/**
 * Check whether telemetry is currently enabled.
 * @returns true if telemetry has been initialized and is enabled
 */
export function isTelemetryEnabled(): boolean {
  return _config?.enabled ?? false;
}

/**
 * Initialize telemetry if OTEL_EXPORTER_OTLP_ENDPOINT is set.
 * When disabled, this is a no-op with zero overhead beyond reading env vars.
 * @returns Promise that resolves when initialization completes
 */
export async function initTelemetry(): Promise<void> {
  if (_initialized) return;
  _initialized = true;

  _config = parseTelemetryConfig();
  if (!_config.enabled) return;

  // Dynamic imports - only loaded when tracing is enabled
  const [
    { NodeTracerProvider, BatchSpanProcessor },
    { OTLPTraceExporter },
    { resourceFromAttributes },
    { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION },
    { readPackageJson },
  ] = await Promise.all([
    import("@opentelemetry/sdk-trace-node"),
    import("@opentelemetry/exporter-trace-otlp-proto"),
    import("@opentelemetry/resources"),
    import("@opentelemetry/semantic-conventions"),
    import("#/cli/shared/package-json"),
  ]);

  const packageJson = await readPackageJson();
  const version = packageJson.version ?? "unknown";

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: "tailor-sdk",
    [ATTR_SERVICE_VERSION]: version,
  });

  const exporter = new OTLPTraceExporter({
    url: `${_config.endpoint}/v1/traces`,
  });

  _provider = new NodeTracerProvider({
    resource,
    spanProcessors: [new BatchSpanProcessor(exporter)],
  });

  _provider.register();
}

/**
 * Shutdown the telemetry provider, flushing all pending spans.
 * Must be called before process exit to ensure traces are exported.
 * @returns Promise that resolves when shutdown completes
 */
export async function shutdownTelemetry(): Promise<void> {
  if (!_provider) return;
  await _provider.shutdown();
}

/**
 * Execute a function within a new span. Records exceptions and sets span status.
 * When no TracerProvider is registered, the OTel API automatically provides
 * noop spans with zero overhead.
 * @param name - Span name
 * @param fn - Function to execute within the span
 * @returns Result of fn
 */
export async function withSpan<T>(name: string, fn: (span: Span) => Promise<T>): Promise<T> {
  const tracer = trace.getTracer("tailor-sdk");

  return tracer.startActiveSpan(name, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      if (error instanceof Error) {
        span.recordException(error);
      }
      throw error;
    } finally {
      span.end();
    }
  });
}
