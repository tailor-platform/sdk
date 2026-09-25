// Extract module specifiers from import / export-from / require / dynamic-import
// statements, ignoring anything inside comments or string/template literals.
//
// A naive regex over raw source has two failure modes this scanner avoids:
//   - a `/*` inside a string literal (e.g. a glob like "foo/*") starts a fake
//     block comment and swallows real imports that follow (false negative), and
//   - a `from "..."` inside a codegen template string is read as a real edge
//     (false positive).
// We walk the source character by character, tracking comment/string state, and
// only treat a quoted string as a specifier when the preceding token is one of
// `from`, `import`, `import(`, or `require(`.
//
// Known limitation: a regex literal containing an unescaped quote (e.g.
// /['"]/) is not distinguished from a string. Such literals are rare in the
// files these checks scan; this is still strictly more accurate than a plain
// regex over raw text.

const IDENT = /[A-Za-z0-9_$]/;

/**
 * @param {string} source full source text being scanned
 * @param {number} quoteIndex index of the opening quote of a string literal
 * @returns {boolean} whether the string at quoteIndex is a module specifier
 */
function precededBySpecifierKeyword(source, quoteIndex) {
  let j = quoteIndex - 1;
  while (j >= 0 && /\s/.test(source[j])) j--;
  if (j < 0) return false;

  // `from "x"` / `import "x"`
  if (IDENT.test(source[j])) {
    let k = j;
    while (k >= 0 && IDENT.test(source[k])) k--;
    const word = source.slice(k + 1, j + 1);
    return word === "from" || word === "import";
  }

  // `import("x")` / `require("x")`
  if (source[j] === "(") {
    let m = j - 1;
    while (m >= 0 && /\s/.test(source[m])) m--;
    let s = m;
    while (s >= 0 && IDENT.test(source[s])) s--;
    const fn = source.slice(s + 1, m + 1);
    return fn === "import" || fn === "require";
  }

  return false;
}

/**
 * @param {string} source full source text to scan for import-like statements
 * @returns {string[]} module specifiers referenced by import-like statements
 */
export function extractImportSpecifiers(source) {
  /** @type {string[]} */
  const specifiers = [];
  const n = source.length;
  let i = 0;

  while (i < n) {
    const c = source[i];

    // line comment
    if (c === "/" && source[i + 1] === "/") {
      i += 2;
      while (i < n && source[i] !== "\n") i++;
      continue;
    }

    // block comment
    if (c === "/" && source[i + 1] === "*") {
      i += 2;
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) i++;
      i += 2;
      continue;
    }

    // template literal — never holds a static specifier; skip it whole
    // (nested `${...}` may contain code, but imports are never inside templates).
    if (c === "`") {
      i++;
      while (i < n && source[i] !== "`") {
        if (source[i] === "\\") {
          i += 2;
          continue;
        }
        i++;
      }
      i++;
      continue;
    }

    // single/double quoted string
    if (c === '"' || c === "'") {
      const quoteIndex = i;
      const quote = c;
      i++;
      let value = "";
      while (i < n && source[i] !== quote) {
        if (source[i] === "\\") {
          value += source[i + 1] ?? "";
          i += 2;
          continue;
        }
        value += source[i];
        i++;
      }
      i++; // closing quote
      if (precededBySpecifierKeyword(source, quoteIndex)) {
        specifiers.push(value);
      }
      continue;
    }

    i++;
  }

  return specifiers;
}
