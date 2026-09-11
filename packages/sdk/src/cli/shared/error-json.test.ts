import { describe, expect, test } from "vitest";
import { serializeError } from "./error-json";
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
});
