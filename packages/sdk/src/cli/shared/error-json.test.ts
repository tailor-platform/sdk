import { describe, expect, test } from "vitest";
import { serializeError } from "./error-json";
import { CLIError } from "./errors";
import { logger } from "./logger";

describe("serializeError", () => {
  test("redacts a registered secret from the error message", () => {
    logger.registerSecret("sk-live-abcdef123456");
    const output = serializeError(new Error("failed: sk-live-abcdef123456"));
    expect(output).not.toContain("sk-live-abcdef123456");
    expect(output).toContain("<redacted>");
  });

  test("redacts a secret even when it is already JSON-escaped once inside the message", () => {
    // Simulates an upstream API returning a JSON error body (already one level of JSON
    // escaping) that echoes back a submitted secret, which then gets embedded verbatim into
    // an Error's message — before this function's own JSON.stringify adds a second level.
    const secret = 'a"secret-with-quotes\\and-backslashes';
    logger.registerSecret(secret);
    const upstreamJsonBody = JSON.stringify({ error: "invalid value", value: secret });
    const output = serializeError(new Error(`request failed: ${upstreamJsonBody}`));

    const parsed = JSON.parse(output) as { error: { message: string } };
    expect(parsed.error.message).not.toContain(secret);
    expect(parsed.error.message).not.toContain("secret-with-quotes");
    expect(parsed.error.message).toContain("<redacted>");
  });

  test("redacts a secret nested inside CLIError.context, an arbitrary record", () => {
    logger.registerSecret("nested-context-secret-value");
    const error = CLIError({
      message: "operation failed",
      context: { request: { headers: { authorization: "nested-context-secret-value" } } },
    });
    const output = serializeError(error);
    const parsed = JSON.parse(output) as {
      error: { context: { request: { headers: { authorization: string } } } };
    };
    expect(parsed.error.context.request.headers.authorization).toBe("<redacted>");
    expect(output).not.toContain("nested-context-secret-value");
  });

  test("falls back to dropping context/stack instead of crashing on a circular context", () => {
    const circular: Record<string, unknown> = { name: "circular" };
    circular.self = circular;
    const error = CLIError({ message: "operation failed", context: circular });

    expect(() => serializeError(error)).not.toThrow();
    const parsed = JSON.parse(serializeError(error)) as { error: Record<string, unknown> };
    expect(parsed.error.context).toBeUndefined();
    expect(parsed.error.message).toBe("operation failed");
  });

  test("preserves a Date's normal JSON serialization inside context", () => {
    const date = new Date("2024-01-01T00:00:00.000Z");
    const error = CLIError({ message: "operation failed", context: { createdAt: date } });
    const parsed = JSON.parse(serializeError(error)) as {
      error: { context: { createdAt: string } };
    };
    expect(parsed.error.context.createdAt).toBe(date.toJSON());
  });
});
