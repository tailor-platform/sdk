import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { Spinner } from "./spinner";

type FakeStream = {
  isTTY: boolean;
  columns?: number;
  write: (chunk: string) => boolean;
  output: string;
};

function createFakeStream(opts: { isTTY: boolean; columns?: number }): FakeStream {
  const stream = {
    isTTY: opts.isTTY,
    columns: opts.columns,
    output: "",
    write(chunk: string) {
      stream.output += chunk;
      return true;
    },
  };
  return stream;
}

// eslint-disable-next-line no-control-regex -- ANSI escapes include ESC (U+001B) by definition
const stripAnsi = (s: string): string => s.replace(/\[[0-9;]*[a-zA-Z]/g, "");

function createStartedSpinner(opts: {
  isTTY: boolean;
  columns?: number;
  indent?: number;
  text?: string;
}) {
  const stream = createFakeStream({ isTTY: opts.isTTY, columns: opts.columns });
  const spinner = new Spinner({
    stream: stream as unknown as NodeJS.WriteStream,
    indent: opts.indent,
  });
  spinner.start(opts.text ?? "working");
  stream.output = "";
  return { stream, spinner };
}

describe("Spinner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("TTY mode", () => {
    test("start renders an initial frame and hides the cursor", () => {
      const stream = createFakeStream({ isTTY: true, columns: 80 });
      const spinner = new Spinner({ stream: stream as unknown as NodeJS.WriteStream });
      spinner.start("loading");
      // Cursor hide ANSI present
      expect(stream.output).toContain("\x1B[?25l");
      // Visible content includes the text
      expect(stripAnsi(stream.output)).toContain("loading");
    });

    test("text setter updates rendered content on next frame", () => {
      const { stream, spinner } = createStartedSpinner({
        isTTY: true,
        columns: 80,
        text: "first",
      });
      spinner.text = "second";
      vi.advanceTimersByTime(200);
      expect(stripAnsi(stream.output)).toContain("second");
      expect(stripAnsi(stream.output)).not.toContain("first");
      spinner.stop();
    });

    test("succeed prints persistent line with check symbol and restores cursor", () => {
      const { stream, spinner } = createStartedSpinner({ isTTY: true, columns: 80 });
      spinner.succeed("done");
      const plain = stripAnsi(stream.output);
      expect(plain).toContain("✓ done");
      expect(plain).toMatch(/\n$/);
      expect(stream.output).toContain("\x1B[?25h");
    });

    test("fail prints persistent line with cross symbol", () => {
      const { stream, spinner } = createStartedSpinner({ isTTY: true, columns: 80 });
      spinner.fail("oops");
      expect(stripAnsi(stream.output)).toContain("✖ oops");
    });

    test("warn prints persistent line with warning symbol", () => {
      const { stream, spinner } = createStartedSpinner({ isTTY: true, columns: 80 });
      spinner.warn("careful");
      expect(stripAnsi(stream.output)).toContain("⚠ careful");
    });

    test("stop clears the line and shows the cursor", () => {
      const { stream, spinner } = createStartedSpinner({ isTTY: true, columns: 80 });
      spinner.stop();
      expect(stream.output).toContain("\x1B[2K");
      expect(stream.output).toContain("\x1B[?25h");
    });

    test("indent option prefixes spaces", () => {
      const stream = createFakeStream({ isTTY: true, columns: 80 });
      const spinner = new Spinner({
        stream: stream as unknown as NodeJS.WriteStream,
        indent: 4,
      });
      spinner.start("indented");
      const plain = stripAnsi(stream.output);
      expect(plain).toContain("    ");
      spinner.stop();
    });

    test("columns=0 (uninitialized winsize) does not produce infinite cursor-up clears", () => {
      const { stream, spinner } = createStartedSpinner({
        isTTY: true,
        columns: 0,
        text: "hello",
      });
      spinner.stop();
      // With columns falling back to 80, single short line clears with one CLEAR_LINE
      // eslint-disable-next-line no-control-regex -- ANSI escapes include ESC (U+001B) by definition
      const cursorUpCount = (stream.output.match(/\[1A/g) ?? []).length;
      expect(cursorUpCount).toBe(0);
    });

    test("clearing accounts for wrapped lines on narrow terminals", () => {
      // text + frame + space takes more than 10 cols → wraps to multiple lines
      const { stream, spinner } = createStartedSpinner({
        isTTY: true,
        columns: 10,
        text: "a long enough message that wraps",
      });
      spinner.stop();
      // Must move cursor up at least once when clearing wrapped output
      expect(stream.output).toContain("\x1B[1A");
    });

    test("calling start twice is a no-op for animation", () => {
      const stream = createFakeStream({ isTTY: true, columns: 80 });
      const spinner = new Spinner({ stream: stream as unknown as NodeJS.WriteStream });
      spinner.start("first");
      const writesAfterFirst = stream.output.length;
      spinner.start("second");
      // start is no-op when already running, but text update still works on next frame
      vi.advanceTimersByTime(200);
      expect(stripAnsi(stream.output)).toContain("second");
      expect(stream.output.length).toBeGreaterThan(writesAfterFirst);
      spinner.stop();
    });

    test("SIGINT clears the spinner line and restores the cursor", () => {
      const { stream } = createStartedSpinner({ isTTY: true, columns: 80 });
      // Trigger our SIGINT handler without actually killing the process
      process.emit("SIGINT");
      // Spinner cleared its drawn line and restored the cursor, leaving the
      // cursor at column 0 of the cleared line for any subsequent output.
      expect(stream.output).toContain("\x1B[2K");
      expect(stream.output).toContain("\x1B[?25h");
    });
  });

  describe("non-TTY mode", () => {
    test("start writes a single line and stays idle", () => {
      const stream = createFakeStream({ isTTY: false });
      const spinner = new Spinner({ stream: stream as unknown as NodeJS.WriteStream });
      spinner.start("hello");
      expect(stream.output).toBe("- hello\n");
      vi.advanceTimersByTime(1000);
      // No animation in non-TTY
      expect(stream.output).toBe("- hello\n");
    });

    test.each([
      ["succeed", "done", "✓ done\n"],
      ["fail", "nope", "✖ nope\n"],
      ["warn", "careful", "⚠ careful\n"],
    ] as const)("%s prints a single persistent line", (method, text, expected) => {
      const { stream, spinner } = createStartedSpinner({ isTTY: false, text: "hello" });
      spinner[method](text);
      expect(stream.output).toBe(expected);
    });

    test("text setter does not write anything in non-TTY mode", () => {
      const { stream, spinner } = createStartedSpinner({ isTTY: false, text: "hello" });
      spinner.text = "updated";
      vi.advanceTimersByTime(1000);
      expect(stream.output).toBe("");
    });

    test("stop is a no-op on non-TTY streams", () => {
      const { stream, spinner } = createStartedSpinner({ isTTY: false, text: "hello" });
      spinner.stop();
      expect(stream.output).toBe("");
    });
  });
});
