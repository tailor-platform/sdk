import * as path from "pathe";

const COMMAND_PATTERN = /\btailor-sdk\s+function\s+test-run\b/;

// Sentinel used to fold `\<newline>` continuations into a single logical line
// before splitting on `\n`. Plain ASCII so the SHELL_ARG_PATTERN can reference
// it directly as a separator alternative; the chosen token is unlikely to
// appear inside a `tailor-sdk function test-run` invocation.
const JOIN_MARKER = "SDK_CODEMOD_JOIN";

// The separator group accepts the JOIN_MARKER literal so a backslash-newline
// continuation between `--arg` and the quoted JSON (joined into the line via
// the marker by `transformShellLikeText`) still matches.
const SHELL_ARG_PATTERN = new RegExp(
  `(--arg|-a)(\\s*=\\s*|(?:\\s|${JOIN_MARKER})+)(['"\`])((?:\\\\.|(?!\\3)[^\\\\])*)\\3`,
  "g",
);

function isInputWrapper(parsed: unknown): parsed is { input: unknown } {
  return (
    typeof parsed === "object" &&
    parsed !== null &&
    !Array.isArray(parsed) &&
    Object.keys(parsed).length === 1 &&
    "input" in parsed
  );
}

function unwrapJsonString(body: string, quote: string): string | null {
  const decoded = quote === '"' ? body.replace(/\\(["\\])/g, "$1") : body;
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    return null;
  }
  if (!isInputWrapper(parsed)) return null;
  const inner = JSON.stringify(parsed.input);
  if (quote === '"') {
    return inner.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }
  return inner;
}

/**
 * Apply the unwrap to one shell command segment. Quotes are tracked so command
 * boundary characters inside strings (e.g. `'a;b'`) are not split.
 */
function applyUnwrapToSegment(segment: string): string {
  return segment.replace(SHELL_ARG_PATTERN, (match, flag, sep, quote, body) => {
    const unwrapped = unwrapJsonString(body, quote);
    if (unwrapped == null) return match;
    return `${flag}${sep}${quote}${unwrapped}${quote}`;
  });
}

/**
 * Walk the line splitting on unquoted shell command boundaries (`;`, `&&`,
 * `||`, `|`, `&`) and only run the unwrap on segments that actually invoke
 * `tailor-sdk function test-run`. Without this, a chained line like
 * `tailor-sdk function test-run ... --arg '{"input":...}' && other-cli --arg '{"input":...}'`
 * would have the unrelated `other-cli` argument unwrapped too.
 */
function transformShellLine(line: string): string {
  if (!COMMAND_PATTERN.test(line)) return line;

  let result = "";
  let segBuf = "";
  let i = 0;
  let quoteChar: string | null = null;
  const N = line.length;

  const flushSegment = () => {
    if (COMMAND_PATTERN.test(segBuf)) {
      result += applyUnwrapToSegment(segBuf);
    } else {
      result += segBuf;
    }
    segBuf = "";
  };

  while (i < N) {
    const ch = line[i]!;
    if (quoteChar) {
      if (ch === "\\" && quoteChar !== "'" && i + 1 < N) {
        segBuf += line.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (ch === quoteChar) quoteChar = null;
      segBuf += ch;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quoteChar = ch;
      segBuf += ch;
      i++;
      continue;
    }
    const two = line.slice(i, i + 2);
    if (two === "&&" || two === "||") {
      flushSegment();
      result += two;
      i += 2;
      continue;
    }
    if (ch === ";" || ch === "|" || ch === "&") {
      flushSegment();
      result += ch;
      i++;
      continue;
    }
    segBuf += ch;
    i++;
  }
  flushSegment();
  return result;
}

function transformShellLikeText(source: string): string | null {
  if (!COMMAND_PATTERN.test(source)) return null;

  // Treat backslash-newline as a line continuation so a multi-line invocation
  // like `tailor-sdk function test-run resolvers/x.ts \\\n  --arg '{"input":...}'`
  // is recognized as a single command. The original `\\\n` is restored after
  // transformation so line breaks remain in place.
  const joined = source.replace(/\\\n/g, JOIN_MARKER);

  let modified = false;
  const lines = joined.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const transformed = transformShellLine(line);
    if (transformed !== line) {
      lines[i] = transformed;
      modified = true;
    }
  }
  if (!modified) return null;
  return lines.join("\n").split(JOIN_MARKER).join("\\\n");
}

function transformPackageJson(source: string): string | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(source) as Record<string, unknown>;
  } catch {
    return null;
  }
  const scripts = parsed.scripts;
  if (typeof scripts !== "object" || scripts == null || Array.isArray(scripts)) return null;

  let modified = false;
  for (const [name, value] of Object.entries(scripts as Record<string, unknown>)) {
    if (typeof value !== "string") continue;
    if (!COMMAND_PATTERN.test(value)) continue;
    const updated = transformShellLikeText(value);
    if (updated != null) {
      (scripts as Record<string, string>)[name] = updated;
      modified = true;
    }
  }
  if (!modified) return null;

  const trailing = source.endsWith("\n") ? "\n" : "";
  return JSON.stringify(parsed, null, 2) + trailing;
}

/**
 * Strip `{ "input": ... }` wrappers from `tailor-sdk function test-run --arg` JSON.
 *
 * In v2 the resolver `--arg` JSON must be the input fields directly. Old format
 * wrapped them under `input` and is removed.
 * @param source - File contents
 * @param filePath - Absolute path to the file (used to dispatch by extension)
 * @returns Transformed source or null when nothing matched.
 */
export default function transform(source: string, filePath: string): string | null {
  if (!source.includes("tailor-sdk")) return null;

  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".json") return transformPackageJson(source);
  return transformShellLikeText(source);
}
