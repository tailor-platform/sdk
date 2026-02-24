import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { parseTelemetryConfig } from "./config";

describe("parseTelemetryConfig", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.OTEL_SERVICE_NAME;
    delete process.env.OTEL_EXPORTER_OTLP_HEADERS;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test("returns disabled when OTEL_EXPORTER_OTLP_ENDPOINT is not set", () => {
    const config = parseTelemetryConfig();
    expect(config.enabled).toBe(false);
    expect(config.endpoint).toBe("");
  });

  test("returns enabled when OTEL_EXPORTER_OTLP_ENDPOINT is set", () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://localhost:4318";
    const config = parseTelemetryConfig();
    expect(config.enabled).toBe(true);
    expect(config.endpoint).toBe("http://localhost:4318");
  });

  test("uses default service name when OTEL_SERVICE_NAME is not set", () => {
    const config = parseTelemetryConfig();
    expect(config.serviceName).toBe("tailor-sdk");
  });

  test("uses custom service name from OTEL_SERVICE_NAME", () => {
    process.env.OTEL_SERVICE_NAME = "my-service";
    const config = parseTelemetryConfig();
    expect(config.serviceName).toBe("my-service");
  });

  test("parses headers from OTEL_EXPORTER_OTLP_HEADERS", () => {
    process.env.OTEL_EXPORTER_OTLP_HEADERS = "x-api-key=abc123,x-team=backend";
    const config = parseTelemetryConfig();
    expect(config.headers).toEqual({
      "x-api-key": "abc123",
      "x-team": "backend",
    });
  });

  test("returns empty headers when OTEL_EXPORTER_OTLP_HEADERS is not set", () => {
    const config = parseTelemetryConfig();
    expect(config.headers).toEqual({});
  });

  test("handles header values containing equals signs", () => {
    process.env.OTEL_EXPORTER_OTLP_HEADERS = "Authorization=Bearer token=abc";
    const config = parseTelemetryConfig();
    expect(config.headers).toEqual({
      Authorization: "Bearer token=abc",
    });
  });

  test("ignores malformed header entries without equals sign", () => {
    process.env.OTEL_EXPORTER_OTLP_HEADERS = "valid=value,malformed,another=ok";
    const config = parseTelemetryConfig();
    expect(config.headers).toEqual({
      valid: "value",
      another: "ok",
    });
  });
});
