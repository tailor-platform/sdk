import { afterEach, describe, expect, test, vi } from "vitest";
import { color, renderFor } from "./color";

const GREEN = "\x1B[32m";
const GRAY = "\x1B[90m";
const ITALIC = "\x1B[3m";
const FG_OFF = "\x1B[39m";
const ITALIC_OFF = "\x1B[23m";

const tty = { isTTY: true } as NodeJS.WriteStream;
const pipe = { isTTY: undefined } as unknown as NodeJS.WriteStream;

/** Clears every variable that decides color support, leaving the stream to decide. */
function neutralEnv(): void {
  vi.stubEnv("FORCE_COLOR", undefined);
  vi.stubEnv("NO_COLOR", undefined);
  vi.stubEnv("NODE_DISABLE_COLORS", undefined);
  vi.stubEnv("TERM", "xterm-256color");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("color", () => {
  test("styles unconditionally, so the escapes survive until renderFor", () => {
    vi.stubEnv("NO_COLOR", "1");
    expect(color.green("x")).toBe(`${GREEN}x${FG_OFF}`);
  });

  test("combines by composing, keeping the outer style around the inner one", () => {
    expect(color.italic(color.gray("x"))).toBe(`${ITALIC}${GRAY}x${FG_OFF}${ITALIC_OFF}`);
  });
});

describe("renderFor", () => {
  test("keeps styling for a terminal and drops it for a pipe", () => {
    neutralEnv();
    expect(renderFor(tty, color.green("x"))).toBe(`${GREEN}x${FG_OFF}`);
    expect(renderFor(pipe, color.green("x"))).toBe("x");
  });

  test("decides per stream, so redirecting one leaves the other alone", () => {
    neutralEnv();
    expect(renderFor(pipe, color.green("data"))).toBe("data");
    expect(renderFor(tty, color.green("diagnostic"))).toBe(`${GREEN}diagnostic${FG_OFF}`);
  });

  const cases = [
    {
      name: "NO_COLOR=1 drops styling on a terminal",
      env: { NO_COLOR: "1" },
      tty: true,
      styled: false,
    },
    { name: "NO_COLOR=0 counts as set", env: { NO_COLOR: "0" }, tty: true, styled: false },
    { name: "NO_COLOR= counts as unset", env: { NO_COLOR: "" }, tty: true, styled: true },
    {
      name: "NODE_DISABLE_COLORS=1 drops styling",
      env: { NODE_DISABLE_COLORS: "1" },
      tty: true,
      styled: false,
    },
    { name: "TERM=dumb drops styling", env: { TERM: "dumb" }, tty: true, styled: false },
    {
      name: "FORCE_COLOR=1 keeps styling through a pipe",
      env: { FORCE_COLOR: "1" },
      tty: false,
      styled: true,
    },
    {
      name: "FORCE_COLOR=0 drops styling on a terminal",
      env: { FORCE_COLOR: "0" },
      tty: true,
      styled: false,
    },
    {
      name: "FORCE_COLOR=false drops styling",
      env: { FORCE_COLOR: "false" },
      tty: true,
      styled: false,
    },
    {
      name: "FORCE_COLOR outranks NO_COLOR",
      env: { FORCE_COLOR: "1", NO_COLOR: "1" },
      tty: false,
      styled: true,
    },
  ] as const;

  test.each(cases)("$name", ({ env, tty: onTty, styled }) => {
    neutralEnv();
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    const rendered = renderFor(onTty ? tty : pipe, color.green("x"));
    expect(rendered).toBe(styled ? `${GREEN}x${FG_OFF}` : "x");
  });
});
