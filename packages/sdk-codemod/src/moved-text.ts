/**
 * Where text moved to: the occurrence in `target` of `source.slice(start, start + length)`, or of
 * its longest prefix that `target` holds, down to its leading word, whose surrounding characters
 * match the source's furthest, the first one on a tie.
 * @param source - Text the moved text was in
 * @param start - Index of the moved text in `source`
 * @param length - Length of the moved text
 * @param target - Text it moved to
 * @returns Index of the occurrence in `target`, or -1 when `target` holds none of those prefixes
 */
export function movedIndex(source: string, start: number, length: number, target: string): number {
  const moved = source.slice(start, start + length);
  const shortest = Math.max(/^[\w$]*/u.exec(moved)![0].length, 1);
  for (let size = moved.length; size >= shortest; size -= 1) {
    const at = bestOccurrence(source, start, size, target);
    if (at !== -1) return at;
  }
  return -1;
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

function sameRun(a: string, from: number, b: string, at: number, step: 1 | -1): number {
  let count = 0;
  while (a[from + count * step] !== undefined && a[from + count * step] === b[at + count * step]) {
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
