import { Stream } from "node:stream";
import { stripVTControlCharacters, styleText } from "node:util";

/** Applies a style to text */
export type StyleFn = (text: string) => string;

type StyleName = Exclude<Parameters<typeof styleText>[0], readonly unknown[] | unknown[]>;

const style =
  (name: StyleName): StyleFn =>
  (text) =>
    styleText(name, text, { validateStream: false });

/**
 * Style functions by name, so call sites read `color.bold(text)`. Styling is
 * always applied; `renderFor` drops it again when the destination stream has no
 * color support. Add a name here when a package needs one that is not listed.
 */
export const color = {
  bold: style("bold"),
  dim: style("dim"),
  italic: style("italic"),
  gray: style("gray"),
  white: style("white"),
  red: style("red"),
  green: style("green"),
  yellow: style("yellow"),
  cyan: style("cyan"),
  magenta: style("magenta"),
  redBright: style("redBright"),
  greenBright: style("greenBright"),
  cyanBright: style("cyanBright"),
};

// Ask styleText whether the destination gets colors, so the TTY / NO_COLOR /
// FORCE_COLOR rules stay Node's rather than being reimplemented here. It returns
// the text unchanged when the stream has no color support, and throws for values
// that are not streams, which is why test doubles are filtered out first.
const PROBE = "?";
const supportsColor = (stream: NodeJS.WriteStream): boolean =>
  stream instanceof Stream && styleText("red", PROBE, { stream }) !== PROBE;

/**
 * Prepares styled text for the stream it is written to.
 * @param stream - Stream the text is written to
 * @param text - Styled text
 * @returns Text with styling removed when the stream has no color support
 */
export function renderFor(stream: NodeJS.WriteStream, text: string): string {
  return supportsColor(stream) ? text : stripVTControlCharacters(text);
}
