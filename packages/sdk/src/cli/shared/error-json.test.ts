import { afterEach, describe, expect, test } from "vitest";
import { serializeError } from "./error-json";
import { CLIError } from "./errors";
import { logger, redactSecrets, resetSecretRegistry } from "./logger";

// This file runs in the shared, non-isolated "unit-core" Vitest project, so registered
// secrets would otherwise leak into unrelated test files run in the same worker.
afterEach(() => {
  resetSecretRegistry();
});

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
    const error = CLIError({
      message: "operation failed",
      context: circular as unknown as CLIError["context"],
    });

    expect(() => serializeError(error)).not.toThrow();
    const parsed = JSON.parse(serializeError(error)) as { error: Record<string, unknown> };
    expect(parsed.error.context).toBeUndefined();
    expect(parsed.error.message).toBe("operation failed");
  });

  test("redacts a registered secret that coincides with an unrelated number in context, keeping the envelope valid JSON", () => {
    // A registered secret that happens to be a purely-numeric string (e.g. a numeric PIN)
    // could otherwise collide with an unrelated bare (unquoted) number elsewhere in the
    // envelope. If serializeError() left that number untouched, the outer, structure-unaware
    // redactSecrets() pass that logger.log() applies to the fully rendered `--json` output
    // would replace it with an unquoted `<redacted>` token, corrupting the JSON.
    const secret = "1234567890";
    logger.registerSecret(secret);
    const error = CLIError({
      message: "operation failed",
      context: { retryAfterSeconds: 1234567890 },
    });

    const output = serializeError(error);
    expect(output).not.toContain(secret);
    const parsed = JSON.parse(output) as { error: { context: { retryAfterSeconds: string } } };
    expect(parsed.error.context.retryAfterSeconds).toBe("<redacted>");

    const afterOuterPass = redactSecrets(output);
    expect(() => JSON.parse(afterOuterPass)).not.toThrow();
  });

  test("redacts a registered secret that coincides with an unrelated null in context, keeping the envelope valid JSON", () => {
    // A secret literally equal to "null" is degenerate (real secrets aren't the word
    // "null"), but it still clears the 4-character registration minimum, so the same
    // bare-token corruption that a numeric collision causes must be prevented here too.
    const secret = "null";
    logger.registerSecret(secret);
    const error = CLIError({
      message: "operation failed",
      context: { cursor: null },
    });

    const output = serializeError(error);
    const parsed = JSON.parse(output) as { error: { context: { cursor: string } } };
    expect(parsed.error.context.cursor).toBe("<redacted>");

    const afterOuterPass = redactSecrets(output);
    expect(() => JSON.parse(afterOuterPass)).not.toThrow();
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
