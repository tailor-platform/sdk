import { Code, ConnectError } from "@connectrpc/connect";
import * as path from "pathe";
import { afterEach, describe, expect, test } from "vitest";
import { withErrorDiagnostics } from "./error-diagnostics";
import { errorToJson, serializeError } from "./error-json";
import { CLIError } from "./errors";
import { logger, redactSecrets, resetSecretRegistry, styles } from "./logger";

// This file runs in the shared, non-isolated "unit-core" Vitest project, so registered
// secrets would otherwise leak into unrelated test files run in the same worker.
afterEach(() => {
  resetSecretRegistry();
});

describe("serializeError", () => {
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

  test("redacts a secret split by inline colors", () => {
    logger.registerSecret("sk-colored-secret");
    const output = serializeError(new Error(`bad ${styles.error("sk-colored")}-secret`));
    const parsed = JSON.parse(output) as { error: { message: string } };
    expect(parsed.error.message).toBe("bad <redacted>");
  });

  test("redacts a registered secret that coincides with an unrelated number in context, keeping the envelope valid JSON", () => {
    // A registered secret that happens to be a purely-numeric string (e.g. a numeric PIN)
    // could otherwise collide with an unrelated bare (unquoted) number elsewhere in the
    // envelope. If the envelope kept that number untouched, the outer, structure-unaware
    // redactSecrets() pass that logger.log() applies to the fully rendered `--json` output
    // would replace it with an unquoted `<redacted>` token, corrupting the JSON.
    const secret = "1234567890";
    logger.registerSecret(secret);
    const error = CLIError({
      code: "TEST_ERROR",
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
      code: "TEST_ERROR",
      message: "operation failed",
      context: { cursor: null },
    });

    const output = serializeError(error);
    const parsed = JSON.parse(output) as { error: { context: { cursor: string } } };
    expect(parsed.error.context.cursor).toBe("<redacted>");

    const afterOuterPass = redactSecrets(output);
    expect(() => JSON.parse(afterOuterPass)).not.toThrow();
  });
});

describe("errorToJson", () => {
  const file = path.join(process.cwd(), "tailordb/item.ts");

  test("puts a source location before the message instead of in its own field", () => {
    const error = withErrorDiagnostics(new Error("boom"), {
      code: "SEED_INVALID",
      location: { file, line: 4 },
    });
    const { error: envelope } = errorToJson(error);
    expect(envelope.code).toBe("SEED_INVALID");
    expect(envelope.message).toBe("tailordb/item.ts:4: boom");
    expect(envelope).not.toHaveProperty("location");
  });

  test.each([
    ["a CLI error", CLIError({ code: "DEFINITION_INVALID", message: "boom" }), "boom"],
    [
      "an RPC error",
      new ConnectError("token expired", Code.Unauthenticated),
      "[unauthenticated] token expired",
    ],
  ])("puts a source location before the message of %s", (_, error, message) => {
    withErrorDiagnostics(error, { location: { file } });

    expect(errorToJson(error).error.message).toBe(`tailordb/item.ts: ${message}`);
  });

  test("puts a source location before the message of a cause", () => {
    const error = withErrorDiagnostics(new Error("generation failed"), {
      causes: { load: withErrorDiagnostics(new Error("boom"), { location: { file } }) },
    });

    expect(errorToJson(error).error.context).toEqual({
      load: { code: "UNEXPECTED_ERROR", message: "tailordb/item.ts: boom" },
    });
  });

  test("leaves the message of an error that formats itself, as seed validate throws", () => {
    const error = withErrorDiagnostics(
      Object.assign(new Error("seed data is invalid"), { format: () => "report" }),
      { location: { file, line: 4 } },
    );

    expect(errorToJson(error).error.message).toBe("seed data is invalid");
  });

  test("still carries the diagnostics that belong in the envelope", () => {
    const error = withErrorDiagnostics(new Error("boom"), {
      code: "X",
      suggestion: "do y",
      context: { namespace: "n" },
    });
    const { error: envelope } = errorToJson(error);
    expect(envelope.suggestion).toBe("do y");
    expect(envelope.context).toEqual({ namespace: "n" });
  });

  test("returns string values without colors", () => {
    const { error: envelope } = errorToJson(new Error(`bad ${styles.bold("input")}`));
    expect(envelope.message).toBe("bad input");
  });

  test("redacts a registered secret from the error message", () => {
    logger.registerSecret("sk-live-abcdef123456");
    const { error: envelope } = errorToJson(new Error("failed: sk-live-abcdef123456"));
    expect(envelope.message).toBe("failed: <redacted>");
  });

  test("redacts a secret nested inside the context and inside a cause's envelope", () => {
    logger.registerSecret("nested-context-secret-value");
    const error = withErrorDiagnostics(new Error("operation failed"), {
      code: "TEST_ERROR",
      context: { request: { headers: { authorization: "nested-context-secret-value" } } },
      causes: { publish: new Error("rejected nested-context-secret-value") },
    });
    const { error: envelope } = errorToJson(error);
    expect(envelope.context).toEqual({
      request: { headers: { authorization: "<redacted>" } },
      publish: { code: "UNEXPECTED_ERROR", message: "rejected <redacted>" },
    });
  });

  test("drops a circular context and the stack, keeping the other values plain", () => {
    logger.registerSecret("circular-secret-value");
    const circular: Record<string, unknown> = { name: "circular" };
    circular.self = circular;
    const error = CLIError({
      code: "TEST_ERROR",
      message: `${styles.bold("failed")}: circular-secret-value`,
      context: circular as unknown as CLIError["context"],
    });

    const { error: envelope } = errorToJson(error, { includeStack: true });
    expect(envelope).not.toHaveProperty("context");
    expect(envelope).not.toHaveProperty("stack");
    expect(envelope.message).toBe("failed: <redacted>");
  });

  test("drops only the context of a cause whose context is circular", () => {
    const circular: Record<string, unknown> = { name: "circular" };
    circular.self = circular;
    const cause = CLIError({
      code: "CAUSE_ERROR",
      message: "cause failed",
      context: circular as unknown as CLIError["context"],
    });
    const error = withErrorDiagnostics(new Error("operation failed"), {
      code: "TEST_ERROR",
      context: { namespace: "n" },
      causes: { publish: cause },
    });

    const { error: envelope } = errorToJson(error);
    expect(envelope.context).toEqual({
      namespace: "n",
      publish: { code: "CAUSE_ERROR", message: "cause failed" },
    });
  });

  test("returns a Date inside the context as its JSON string", () => {
    const date = new Date("2024-01-01T00:00:00.000Z");
    const error = CLIError({
      code: "TEST_ERROR",
      message: "operation failed",
      context: { createdAt: date },
    });
    const { error: envelope } = errorToJson(error);
    expect(envelope.context).toEqual({ createdAt: date.toJSON() });
  });
});
