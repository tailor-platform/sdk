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

// Node's rules for whether a destination gets colors, applied by hand. Asking
// styleText instead would be shorter but only correct on Node: Bun ignores both
// the stream option and NO_COLOR (reproduced on 1.3.14), so it reports every
// destination as color-capable and escapes end up in redirected output.
//
// FORCE_COLOR decides on its own when set, which is how CI keeps colors through
// a pipe. NO_COLOR counts as set at any non-empty value, "0" included.
const supportsColor = (stream: NodeJS.WriteStream): boolean => {
  const forced = process.env.FORCE_COLOR;
  if (forced !== undefined) return forced !== "0" && forced !== "false";
  if (process.env.NODE_DISABLE_COLORS !== undefined) return false;
  if ((process.env.NO_COLOR ?? "") !== "") return false;
  if (process.env.TERM === "dumb") return false;
  return stream.isTTY === true;
};

/**
 * Prepares styled text for the stream it is written to.
 * @param stream - Stream the text is written to
 * @param text - Styled text
 * @returns Text with styling removed when the stream has no color support
 */
export function renderFor(stream: NodeJS.WriteStream, text: string): string {
  return supportsColor(stream) ? text : stripVTControlCharacters(text);
}
