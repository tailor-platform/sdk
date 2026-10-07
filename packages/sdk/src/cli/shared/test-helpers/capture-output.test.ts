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

  test("stops capturing once disposed", () => {
    {
      using stdout = captureStdoutStream();
      console.log("captured");
      expect(stdout.output).toBe("captured\n");
    }
    expect(vi.isMockFunction(console.log)).toBe(false);
  });
});
