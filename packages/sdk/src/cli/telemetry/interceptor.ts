import { trace, SpanStatusCode } from "@opentelemetry/api";
import type { Interceptor } from "@connectrpc/connect";

/**
 * Create a Connect-RPC interceptor that records OTLP spans for each RPC call.
 * When no TracerProvider is registered, the OTel API automatically provides
 * noop spans with zero overhead.
 * @returns Tracing interceptor
 */
export function createTracingInterceptor(): Interceptor {
  return (next) => async (req) => {
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
