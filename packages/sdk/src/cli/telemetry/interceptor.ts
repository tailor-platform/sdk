import { isTelemetryEnabled } from "./index";
import type { Interceptor } from "@connectrpc/connect";

/**
 * Create a Connect-RPC interceptor that records OTLP spans for each RPC call.
 * When tracing is disabled, returns undefined so it is not added to the chain.
 * @returns Tracing interceptor or undefined
 */
export function createTracingInterceptor(): Interceptor | undefined {
  if (!isTelemetryEnabled()) return undefined;

  return (next) => async (req) => {
    const { trace, SpanStatusCode } = await import("@opentelemetry/api");
    const tracer = trace.getTracer("tailor-sdk");

    return tracer.startActiveSpan(`rpc.${req.method.name}`, async (span) => {
      span.setAttribute("rpc.method", req.method.name);
      span.setAttribute("rpc.service", "OperatorService");
      span.setAttribute("rpc.system", "connect-rpc");

      try {
        const response = await next(req);
        span.setStatus({ code: SpanStatusCode.OK });
        return response;
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
  };
}
