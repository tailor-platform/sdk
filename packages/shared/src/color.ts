import { Stream } from "node:stream";
import { stripVTControlCharacters, styleText } from "node:util";

/** Style name accepted by `color`, or an array of names to combine */
export type StyleFormat = Parameters<typeof styleText>[0];

/**
 * Creates a style function. Styling is always applied; `renderFor` drops it again
 * when the destination stream has no color support.
 * @param format - Style name, or names to combine
 * @returns Style function for the given format
 */
export const color =
  (format: StyleFormat) =>
  (text: string): string =>
    styleText(format, text, { validateStream: false });

// Ask styleText whether the destination gets colors, so the TTY / NO_COLOR /
// FORCE_COLOR rules stay Node's rather than being reimplemented here. styleText
// returns the text unchanged for streams without color support, and rejects
// values that are not streams at all, such as test doubles.
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
