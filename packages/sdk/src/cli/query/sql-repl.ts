/**
 * Return true when the buffered SQL input ends with a real statement terminator.
 * @param input - Buffered SQL input
 * @returns True when the SQL statement is complete and ready to execute
 */
export function isSqlInputComplete(input: string): boolean {
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let blockCommentDepth = 0;
  let dollarQuoteTag: string | null = null;
  let lastSignificantTokenWasSemicolon = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = input[i + 1];

    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
      }
      continue;
    }

    if (blockCommentDepth > 0) {
      if (char === "/" && next === "*") {
        blockCommentDepth += 1;
        i += 1;
        continue;
      }
      if (char === "*" && next === "/") {
        blockCommentDepth -= 1;
        i += 1;
      }
      continue;
    }

    if (dollarQuoteTag != null) {
      if (input.startsWith(dollarQuoteTag, i)) {
        i += dollarQuoteTag.length - 1;
        dollarQuoteTag = null;
      }
      continue;
    }

    if (inSingleQuote) {
      if (char === "'" && next === "'") {
        i += 1;
        continue;
      }
      if (char === "'") {
        inSingleQuote = false;
      }
      continue;
    }

    if (inDoubleQuote) {
      if (char === '"' && next === '"') {
        i += 1;
        continue;
      }
      if (char === '"') {
        inDoubleQuote = false;
      }
      continue;
    }

    if (char === "-" && next === "-") {
      inLineComment = true;
      i += 1;
      continue;
    }

    if (char === "/" && next === "*") {
      blockCommentDepth = 1;
      i += 1;
      continue;
    }

    if (char === "'") {
      lastSignificantTokenWasSemicolon = false;
      inSingleQuote = true;
      continue;
    }

    if (char === '"') {
      lastSignificantTokenWasSemicolon = false;
      inDoubleQuote = true;
      continue;
    }

    if (char === "$") {
      const rest = input.slice(i);
      const match = rest.match(/^\$[A-Za-z_][A-Za-z0-9_]*\$/) ?? rest.match(/^\$\$/);
      if (match != null) {
        lastSignificantTokenWasSemicolon = false;
        dollarQuoteTag = match[0];
        i += match[0].length - 1;
        continue;
      }
    }

    if (char === ";") {
      lastSignificantTokenWasSemicolon = true;
      continue;
    }

    if (!/\s/.test(char)) {
      lastSignificantTokenWasSemicolon = false;
    }
  }

  return (
    lastSignificantTokenWasSemicolon &&
    !inSingleQuote &&
    !inDoubleQuote &&
    blockCommentDepth === 0 &&
    dollarQuoteTag == null
  );
}
