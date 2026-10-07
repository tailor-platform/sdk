import { describe, expect, test, vi } from "vitest";
import { captureStdoutStream } from "./capture-output";

describe("captureStdoutStream", () => {
  test("records each console.log call as one line", () => {
    using stdout = captureStdoutStream();
    console.log("first");
    console.log("second", 2);
    expect(stdout.output).toBe("first\nsecond 2\n");
  });

  test("records string chunks written to process.stdout unchanged", () => {
    using stdout = captureStdoutStream();
    process.stdout.write("{}\n");
    expect(stdout.output).toBe("{}\n");
  });

  test("decodes byte chunks written to process.stdout as UTF-8", () => {
    using stdout = captureStdoutStream();
    process.stdout.write(new TextEncoder().encode('{"name":"日本語"}\n'));
    expect(stdout.output).toBe('{"name":"日本語"}\n');
  });

  test("joins a UTF-8 character split across two writes", () => {
    using stdout = captureStdoutStream();
    const bytes = new TextEncoder().encode("日");
    process.stdout.write(bytes.slice(0, 1));
    process.stdout.write(bytes.slice(1));
    expect(stdout.output).toBe("日");
  });

  test("keeps an incomplete trailing sequence visible instead of dropping it", () => {
    using stdout = captureStdoutStream();
    process.stdout.write(Uint8Array.of(0xe2));
    console.log("{}");
    expect(stdout.output).not.toBe("{}\n");
    expect(stdout.output).toContain("\uFFFD");
  });

  test("stops capturing once disposed", () => {
    {
      using stdout = captureStdoutStream();
      console.log("captured");
      expect(stdout.output).toBe("captured\n");
    }
    expect(vi.isMockFunction(console.log)).toBe(false);
  });
});
