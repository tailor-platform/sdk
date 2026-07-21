import { describe, test, expect, aroundEach } from "vitest";
import { parseTelemetryConfig } from "./config";

describe("parseTelemetryConfig", () => {
  aroundEach(async (runTest) => {
    const originalEnv = process.env;
    process.env = { ...originalEnv };
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    await runTest();
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
});
