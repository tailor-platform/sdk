import { stripVTControlCharacters } from "node:util";
import { describe, test, expect, vi } from "vitest";
import { CIPromptError, formatLogLine, logger } from "./logger";

function captureStdout(fn: () => void): string {
  using stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  fn();
  return stdoutSpy.mock.calls.map((call) => String(call[0])).join("");
}

function captureStderr(fn: () => void): string {
  using stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  fn();
  return stripVTControlCharacters(stderrSpy.mock.calls.map((call) => String(call[0])).join(""));
}

describe("logger", () => {
  describe("CIPromptError", () => {
    test("has correct name and message", () => {
      const error = new CIPromptError();
      expect(error.name).toBe("CIPromptError");
      expect(error.message).toContain("not available in this environment");
      expect(error.message).toContain("required options explicitly");
    });

    test("accepts custom message", () => {
      const customMessage = "Custom CI error message";
      const error = new CIPromptError(customMessage);
      expect(error.message).toBe(customMessage);
    });
  });

  describe("formatLogLine", () => {
    const cases = [
      {
        name: "default mode without indent",
        mode: "default",
        indent: 0,
        type: "info",
        expected: /^ℹ MSG\n$/,
      },
      {
        name: "default mode with 2-space indent",
        mode: "default",
        indent: 2,
        type: "info",
        expected: /^ {2}ℹ MSG\n$/,
      },
      {
        name: "default mode with 4-space indent",
        mode: "default",
        indent: 4,
        type: "info",
        expected: /^ {4}ℹ MSG\n$/,
      },
      {
        name: "success messages with indent",
        mode: "default",
        indent: 2,
        type: "success",
        expected: /^ {2}✔ MSG\n$/,
      },
      {
        name: "warn messages with indent",
        mode: "default",
        indent: 2,
        type: "warn",
        expected: /^ {2}⚠ MSG\n$/,
      },
      {
        name: "error messages with indent",
        mode: "default",
        indent: 2,
        type: "error",
        expected: /^ {2}✖ MSG\n$/,
      },
      {
        name: "plain mode with indent (no icon)",
        mode: "plain",
        indent: 2,
        type: "info",
        expected: /^ {2}MSG\n$/,
      },
      {
        name: "indent 0 treated as no indent",
        mode: "default",
        indent: 0,
        type: "info",
        expected: /^ℹ MSG\n$/,
      },
    ] as const;

    test.each(cases)("formats $name", ({ mode, indent, type, expected }) => {
      const result = formatLogLine({ mode, indent, type, message: "MSG" });
      expect(stripVTControlCharacters(result)).toMatch(expected);
    });

    test("formats stream mode with timestamp and indent", () => {
      const result = formatLogLine({
        mode: "stream",
        indent: 2,
        type: "info",
        message: "stream message",
        timestamp: "10:30:00 ",
      });
      expect(stripVTControlCharacters(result)).toMatch(/^ {2}10:30:00 ℹ stream message\n$/);
    });

    test("handles unknown log type", () => {
      const result = formatLogLine({
        mode: "default",
        indent: 0,
        type: "unknown",
        message: "test message",
      });
      expect(result).toBe("test message\n");
    });
  });

  describe("out", () => {
    test("writes a plain string as-is, adding a trailing newline only when missing", () => {
      expect(captureStdout(() => logger.out("hello"))).toBe("hello\n");
      expect(captureStdout(() => logger.out("hello\n"))).toBe("hello\n");
    });

    test("renders an object as a key-value table with a separator between every row", () => {
      const output = captureStdout(() => logger.out({ id: "abc", status: "ok" }));
      expect(output).toContain("id");
      expect(output).toContain("abc");
      expect(output).toContain("status");
      expect(output).toContain("ok");
      expect(output.match(/├/g)?.length).toBe(1);
    });

    test("renders an array of objects as a table with a header row", () => {
      const output = captureStdout(() =>
        logger.out([
          { name: "alice", role: "admin" },
          { name: "bob", role: "member" },
        ]),
      );
      expect(output).toContain("name");
      expect(output).toContain("role");
      expect(output).toContain("alice");
      expect(output).toContain("bob");
      // only one separator: right after the header row
      expect(output.match(/├/g)?.length).toBe(1);
    });

    test("writes nothing for an empty array", () => {
      const output = captureStdout(() => logger.out([]));
      expect(output).toBe("");
    });

    test("writes nothing when every item has no displayable fields", () => {
      const emptyItems = captureStdout(() => logger.out([{}, {}]));
      expect(emptyItems).toBe("");

      const allFieldsExcluded = captureStdout(() =>
        logger.out([{ secret: "x" }], { display: { secret: null } }),
      );
      expect(allFieldsExcluded).toBe("");
    });

    test("formats null, undefined, Date, and nested object values", () => {
      const output = captureStdout(() =>
        logger.out({
          missing: null,
          absent: undefined,
          createdAt: new Date(Date.now() - 5 * 60 * 1000),
          meta: { nested: "value" },
        }),
      );
      expect(output).toContain("N/A");
      expect(output).toContain("ago");
      expect(output).toContain('"nested"');
    });

    test("showNull renders null as the literal string NULL", () => {
      const output = captureStdout(() => logger.out({ field: null }, { showNull: true }));
      expect(output).toContain("NULL");
      expect(output).not.toContain("N/A");
    });

    test("display: null excludes a field entirely", () => {
      const output = captureStdout(() =>
        logger.out({ id: "abc", secret: "hidden" }, { display: { secret: null } }),
      );
      expect(output).toContain("id");
      expect(output).not.toContain("secret");
      expect(output).not.toContain("hidden");
    });

    test("does not redact registered secrets", () => {
      logger.registerSecret("out-should-not-redact-this-token");
      const output = captureStdout(() => logger.out("out-should-not-redact-this-token"));
      expect(output).toBe("out-should-not-redact-this-token\n");
    });
  });

  describe("registerSecret", () => {
    test("redacts a registered secret from info/success/warn/error/log/debug output", () => {
      logger.registerSecret("sk-live-abcdef123456");
      logger.verbose = true;

      expect(captureStderr(() => logger.info("token: sk-live-abcdef123456"))).toContain(
        "<redacted>",
      );
      expect(captureStderr(() => logger.success("token: sk-live-abcdef123456"))).toContain(
        "<redacted>",
      );
      expect(captureStderr(() => logger.warn("token: sk-live-abcdef123456"))).toContain(
        "<redacted>",
      );
      expect(captureStderr(() => logger.error("token: sk-live-abcdef123456"))).toContain(
        "<redacted>",
      );
      expect(captureStderr(() => logger.log("token: sk-live-abcdef123456"))).toContain(
        "<redacted>",
      );
      expect(captureStderr(() => logger.debug("token: sk-live-abcdef123456"))).toContain(
        "<redacted>",
      );

      logger.verbose = false;
      for (const output of [
        captureStderr(() => logger.info("token: sk-live-abcdef123456")),
        captureStderr(() => logger.success("token: sk-live-abcdef123456")),
        captureStderr(() => logger.warn("token: sk-live-abcdef123456")),
        captureStderr(() => logger.error("token: sk-live-abcdef123456")),
        captureStderr(() => logger.log("token: sk-live-abcdef123456")),
      ]) {
        expect(output).not.toContain("sk-live-abcdef123456");
      }
    });

    test("ignores a non-string value instead of throwing (e.g. an unvalidated undefined field)", () => {
      expect(() => logger.registerSecret(undefined as unknown as string)).not.toThrow();
      expect(() => logger.registerSecret(null as unknown as string)).not.toThrow();
    });

    test("ignores empty strings and values shorter than 4 characters", () => {
      logger.registerSecret("");
      logger.registerSecret("abc");
      const output = captureStderr(() => logger.info("prefix abc suffix and more text"));
      expect(output).toContain("abc");
      expect(output).not.toContain("<redacted>");
    });

    test("redacts the longer of two overlapping registered secrets without leaving a fragment", () => {
      logger.registerSecret("credential-outer-9f2c8b1a");
      logger.registerSecret("outer-9f2c8b1a");
      const output = captureStderr(() => logger.info("value=credential-outer-9f2c8b1a"));
      expect(output).toBe("ℹ value=<redacted>\n");
    });

    test("redacts a registered secret even after JSON.stringify escapes it", () => {
      const secret = 'a"secret-with-quotes\\and-backslashes';
      logger.registerSecret(secret);
      const serialized = JSON.stringify({ token: secret });
      const output = captureStderr(() => logger.log(serialized));
      expect(output).not.toContain(secret);
      expect(output).not.toContain("secret-with-quotes");
      expect(output).toContain("<redacted>");
    });

    test("does not reprocess the placeholder when a later secret matches text inside it", () => {
      logger.registerSecret("foo-reprocess-guard-redacted");
      logger.registerSecret("reprocess-guard-redacted");
      const output = captureStderr(() => logger.info("value=foo-reprocess-guard-redacted"));
      expect(output).toBe("ℹ value=<redacted>\n");
    });

    test("merges two secrets that cross (neither contains the other) without leaking a fragment of either", () => {
      logger.registerSecret("crossoverleftpart");
      logger.registerSecret("leftpartcrossoverright");
      // "leftpartcrossoverright" starts in the middle of "crossoverleftpart".
      const output = captureStderr(() => logger.info("value=crossoverleftpartcrossoverright"));
      expect(output).toBe("ℹ value=<redacted>\n");
    });

    test("does not leak internal redaction machinery when a registered secret happens to contain 'redact'", () => {
      logger.registerSecret("first-registered-secret-value");
      logger.registerSecret("REDACT");
      const output = captureStderr(() => logger.info("value=first-registered-secret-value"));
      expect(output).toBe("ℹ value=<redacted>\n");
    });
  });
});
