import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";

describe("telemetry", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    vi.resetModules();
  });

  afterEach(async () => {
    process.env = originalEnv;
    // Clean up OTel global state to avoid leaking between tests
    const { trace } = await import("@opentelemetry/api");
    trace.disable();
  });

  test("withSpan executes fn with noop span when no provider is registered", async () => {
    const { withSpan } = await import("./index");
    const result = await withSpan("test-span", async () => {
      return "hello";
    });
    expect(result).toBe("hello");
  });

  test("withSpan propagates errors when no provider is registered", async () => {
    const { withSpan } = await import("./index");
    await expect(
      withSpan("test-span", async () => {
        throw new Error("test error");
      }),
    ).rejects.toThrow("test error");
  });

  test("initTelemetry is a no-op when endpoint is not set", async () => {
    const { initTelemetry, isTelemetryEnabled } = await import("./index");
    await initTelemetry();
    expect(isTelemetryEnabled()).toBe(false);
  });

  test("initTelemetry enables telemetry when endpoint is set", async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://localhost:4318";
    const { initTelemetry, isTelemetryEnabled } = await import("./index");
    await initTelemetry();
    expect(isTelemetryEnabled()).toBe(true);

    // Clean up: shutdown the provider
    const { shutdownTelemetry } = await import("./index");
    await shutdownTelemetry();
  });

  test("withSpan creates spans when provider is registered", async () => {
    const { trace } = await import("@opentelemetry/api");
    const { NodeTracerProvider } = await import("@opentelemetry/sdk-trace-node");
    const { InMemorySpanExporter, SimpleSpanProcessor } =
      await import("@opentelemetry/sdk-trace-base");

    const { withSpan } = await import("./index");

    // Register test provider to capture spans
    const exporter = new InMemorySpanExporter();
    const provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    provider.register();

    const result = await withSpan("test-operation", async (span) => {
      span.setAttribute("test.key", "test-value");
      return 42;
    });

    expect(result).toBe(42);

    const spans = exporter.getFinishedSpans();
    const testSpan = spans.find((s) => s.name === "test-operation");
    expect(testSpan).toBeDefined();
    expect(testSpan?.attributes["test.key"]).toBe("test-value");

    // Clean up
    await provider.shutdown();
    trace.disable();
  });

  test("withSpan records exceptions on error when provider is registered", async () => {
    const { trace, SpanStatusCode } = await import("@opentelemetry/api");
    const { NodeTracerProvider } = await import("@opentelemetry/sdk-trace-node");
    const { InMemorySpanExporter, SimpleSpanProcessor } =
      await import("@opentelemetry/sdk-trace-base");

    const { withSpan } = await import("./index");

    // Register test provider to capture spans
    const exporter = new InMemorySpanExporter();
    const provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    provider.register();

    await expect(
      withSpan("failing-operation", async () => {
        throw new Error("something went wrong");
      }),
    ).rejects.toThrow("something went wrong");

    const spans = exporter.getFinishedSpans();
    const failedSpan = spans.find((s) => s.name === "failing-operation");
    expect(failedSpan).toBeDefined();
    expect(failedSpan?.status.code).toBe(SpanStatusCode.ERROR);
    expect(failedSpan?.events.length).toBeGreaterThan(0);

    // Clean up
    await provider.shutdown();
    trace.disable();
  });

  test("shutdownTelemetry is a no-op when telemetry is disabled", async () => {
    const { initTelemetry, shutdownTelemetry } = await import("./index");
    await initTelemetry();
    await expect(shutdownTelemetry()).resolves.toBeUndefined();
  });
});
