/**
 * Tag function which strips the common leading indent from a multi-line
 * template literal and trims surrounding blank lines, while indenting each
 * line of interpolated values to match the placeholder's indent.
 *
 * Mirrors the behaviour of the `multiline-ts` package, which we used to
 * depend on. We replaced it with this in-tree implementation because the
 * upstream package ships a `preinstall: npx only-allow pnpm` hook that
 * makes `npx create-tailor-sdk@latest` (and any other npm-based install
 * path that resolves a fresh copy) abort with `ECOMPROMISED`.
 * @param value - Template strings array, or a plain string for non-tagged usage
 * @param inputs - Interpolated values
 * @returns The dedented and trimmed string
 */
export default function multiline(
  value: TemplateStringsArray | string,
  ...inputs: string[]
): string {
  const strings = typeof value === "string" ? value.split(/(?=\r\n|\r|\n)/) : Array.from(value);

  let currentIndent = "";
  const joined = strings
    .map((segment, i) => {
      if (/\r\n|\r|\n/.test(segment)) {
        currentIndent = getFinalIndent(segment) || currentIndent;
      }
      const input = inputs[i] ?? "";
      return segment + input.replace(/\r\n|\r|\n/g, `\n${currentIndent}`);
    })
    .join("");

  const lines = joined.split(/\r\n|\r|\n/);
  const indents = lines.filter((line) => /[^ \t]/.test(line)).map((line) => getIndent(line).length);
  const minIndent = indents.length === 0 ? 0 : Math.min(...indents);
  return lines
    .map((line) => line.slice(minIndent))
    .join("\n")
    .replace(/^\n|\n[ \t]*$/g, "");
}

function getIndent(line: string): string {
  const match = line.match(/^[ \t]+/);
  return match ? match[0] : "";
}

function getFinalIndent(value: string): string {
  const match = value.match(/(?<=(\r\n|\r|\n))[ \t]+$/);
  return match ? match[0] : "";
}
