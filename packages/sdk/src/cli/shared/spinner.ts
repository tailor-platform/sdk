import { assertDefined } from "@/utils/assert";
import { styles, symbols } from "./logger";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const FRAME_INTERVAL_MS = 80;

const CURSOR_HIDE = "\x1B[?25l";
const CURSOR_SHOW = "\x1B[?25h";
const CLEAR_LINE = "\x1B[2K";
const CURSOR_TO_START = "\r";
const CURSOR_UP = "\x1B[1A";
// DEC mode 2026: synchronized output. Brackets a frame redraw so supporting
// terminals render the clear+rewrite atomically and avoid flicker on slow links.
const SYNC_BEGIN = "\x1B[?2026h";
const SYNC_END = "\x1B[?2026l";

// eslint-disable-next-line no-control-regex -- ANSI escapes include ESC (U+001B) by definition
const ANSI_RE = /\u001B\[[0-9;]*[a-zA-Z]/g;

function visibleLength(s: string): number {
  return s.replace(ANSI_RE, "").length;
}

export type SpinnerOptions = {
  indent?: number;
  stream?: NodeJS.WriteStream;
};

const activeSpinners = new Set<Spinner>();
let exitHookInstalled = false;
let signalHookInstalled = false;

function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  // Restore the terminal cursor when the process exits even if a spinner is still active
  // (e.g. on Ctrl+C the SIGINT handler typically calls process.exit which fires this).
  process.on("exit", () => {
    for (const s of activeSpinners) {
      s.cleanupOnExit();
    }
  });
}

function installSignalHook(): void {
  if (signalHookInstalled) return;
  signalHookInstalled = true;
  // Clear the spinner's drawn line on Ctrl+C so any subsequent stderr output
  // (e.g. politty's "✖ Process interrupted") starts at column 0 on its own
  // line instead of being appended after the spinner frame and the
  // TTY-echoed "^C".
  //
  // We use prependListener so our handler runs before any pre-existing one.
  // In particular, politty registers an async SIGINT handler whose body runs
  // synchronously up to its first `await`, and that prefix calls
  // `logger.error("Process interrupted")`. If our handler were appended, the
  // error message would already have been written to stderr — appended after
  // the spinner frame on the same line — by the time we got control. Running
  // first lets us tear down the spinner line cleanly first.
  const handler = (): void => {
    for (const s of activeSpinners) s.stop();
  };
  process.prependListener("SIGINT", handler);
  process.prependListener("SIGTERM", handler);
}

export class Spinner {
  text: string;
  readonly #indent: number;
  readonly #stream: NodeJS.WriteStream;
  readonly #isEnabled: boolean;
  #frame = 0;
  #timer?: NodeJS.Timeout;
  #linesDrawn = 0;
  #started = false;

  constructor(options: SpinnerOptions = {}) {
    this.text = "";
    this.#indent = options.indent ?? 0;
    this.#stream = options.stream ?? process.stderr;
    this.#isEnabled = Boolean(this.#stream.isTTY);
  }

  start(text?: string): this {
    if (text !== undefined) this.text = text;

    if (!this.#isEnabled) {
      this.#writeLine(`- ${this.text}`);
      return this;
    }

    if (this.#started) {
      // Already running; just update text. The next render frame will pick it up.
      return this;
    }

    installExitHook();
    installSignalHook();
    activeSpinners.add(this);
    this.#started = true;
    this.#stream.write(CURSOR_HIDE);
    this.#renderFrame();
    this.#timer = setInterval(() => this.#renderFrame(), FRAME_INTERVAL_MS);
    if (typeof this.#timer.unref === "function") this.#timer.unref();
    return this;
  }

  stop(): this {
    if (!this.#started) return this;
    this.#started = false;
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
    if (this.#isEnabled) {
      this.#clearDrawn();
      this.#stream.write(CURSOR_SHOW);
    }
    activeSpinners.delete(this);
    return this;
  }

  succeed(text?: string): this {
    return this.#stopAndPersist(symbols.success, text);
  }

  fail(text?: string): this {
    return this.#stopAndPersist(symbols.error, text);
  }

  warn(text?: string): this {
    return this.#stopAndPersist(symbols.warning, text);
  }

  /**
   * Called by the global exit hook to restore the cursor.
   * @internal
   */
  cleanupOnExit(): void {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
    if (this.#isEnabled) {
      this.#stream.write(CURSOR_SHOW);
    }
  }

  #stopAndPersist(symbol: string, text?: string): this {
    if (text !== undefined) this.text = text;
    if (this.#started) {
      this.#started = false;
      if (this.#timer) {
        clearInterval(this.#timer);
        this.#timer = undefined;
      }
      if (this.#isEnabled) {
        this.#clearDrawn();
        this.#stream.write(CURSOR_SHOW);
      }
      activeSpinners.delete(this);
    }
    this.#writeLine(`${symbol} ${this.text}`);
    return this;
  }

  #renderFrame(): void {
    this.#stream.write(SYNC_BEGIN);
    this.#clearDrawn();
    const frame = styles.info(
      FRAMES[this.#frame] ?? assertDefined(FRAMES[0], "spinner frames empty"),
    );
    this.#frame = (this.#frame + 1) % FRAMES.length;
    const indent = " ".repeat(this.#indent);
    const line = `${indent}${frame} ${this.text}`;
    this.#stream.write(line);
    this.#stream.write(SYNC_END);
    const cols = this.#stream.columns || 80;
    this.#linesDrawn = Math.max(1, Math.ceil(visibleLength(line) / cols));
  }

  #clearDrawn(): void {
    if (this.#linesDrawn === 0) return;
    this.#stream.write(CURSOR_TO_START);
    this.#stream.write(CLEAR_LINE);
    for (let i = 1; i < this.#linesDrawn; i++) {
      this.#stream.write(CURSOR_UP);
      this.#stream.write(CLEAR_LINE);
    }
    this.#linesDrawn = 0;
  }

  #writeLine(content: string): void {
    const indent = " ".repeat(this.#indent);
    this.#stream.write(`${indent}${content}\n`);
  }
}

/**
 * Create a terminal spinner. Falls back to a single line write in non-TTY
 * environments so output stays useful in CI logs.
 * @param options - Spinner options
 * @returns A Spinner instance
 */
export function spinner(options?: SpinnerOptions): Spinner {
  return new Spinner(options);
}
