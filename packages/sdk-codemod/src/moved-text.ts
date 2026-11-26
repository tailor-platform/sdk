/**
 * Where text moved to: the occurrence in `target` of `source.slice(start, start + length)`, or of
 * its longest prefix that `target` holds, down to its leading word, whose surrounding characters
 * match the source's furthest, any run of whitespace matching any other, the first one on a tie.
 * @param source - Text the moved text was in
 * @param start - Index of the moved text in `source`
 * @param length - Length of the moved text
 * @param target - Text it moved to
 * @returns Index of the occurrence in `target`, or -1 when `target` holds none of those prefixes
 */
export function movedIndex(source: string, start: number, length: number, target: string): number {
  for (const size of prefixLengths(source.slice(start, start + length))) {
    const at = bestOccurrence(source, start, size, target);
    if (at !== -1) return at;
  }
  return -1;
}

/**
 * The lengths of a text's prefixes, longest first, down to its leading word.
 * @param text - The text
 * @returns The lengths, down to the length of its leading identifier, or to 1 without one
 */
export function prefixLengths(text: string): number[] {
  const shortest = Math.max(/^[\w$]*/u.exec(text)![0].length, 1);
  return Array.from(
    { length: Math.max(text.length - shortest + 1, 0) },
    (_, index) => text.length - index,
  );
}

function bestOccurrence(source: string, start: number, length: number, target: string): number {
  const moved = source.slice(start, start + length);
  let best = -1;
  let bestScore = -1;
  for (let at = target.indexOf(moved); at !== -1; at = target.indexOf(moved, at + 1)) {
    const score =
      sameRun(source, start - 1, target, at - 1, -1) +
      sameRun(source, start + length, target, at + length, 1);
    if (score > bestScore) {
      best = at;
      bestScore = score;
    }
  }
  return best;
}

function isSpace(char: string | undefined): boolean {
  return char !== undefined && /\s/u.test(char);
}

function sameRun(a: string, from: number, b: string, at: number, step: 1 | -1): number {
  let count = 0;
  let i = from;
  let j = at;
  while (a[i] !== undefined && b[j] !== undefined) {
    if (isSpace(a[i]) && isSpace(b[j])) {
      while (isSpace(a[i])) i += step;
      while (isSpace(b[j])) j += step;
    } else if (a[i] === b[j]) {
      i += step;
      j += step;
    } else {
      break;
    }
    count += 1;
  }
  return count;
}

/**
 * The one-based line of an index in a text.
 * @param text - The text
 * @param index - Index in `text`
 * @returns The line
 */
export function lineOfIndex(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}
