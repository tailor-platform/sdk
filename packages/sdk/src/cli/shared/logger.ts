import { formatWithOptions, type InspectOptions } from "node:util";
import { color, renderFor } from "@tailor-platform/shared/color";
import { formatDistanceToNowStrict } from "date-fns";
import { renderTable } from "./ascii-table";
import { parseBoolean } from "./parse-boolean";

/**
 * Error thrown when a prompt is attempted in a non-interactive environment
 */
export class CIPromptError extends Error {
  constructor(message?: string) {
    super(
      message ??
        "Interactive prompts are not available in this environment. Provide the required options explicitly.",
    );
    this.name = "CIPromptError";
  }
}

/**
 * Semantic style functions for inline text styling
 */
export const styles = {
  // Status colors
  success: color.green,
  error: color.red,
  warning: color.yellow,
  info: color.cyan,

  // Action colors (for change sets)
  create: color.green,
  update: color.yellow,
  delete: color.red,
  replace: color.magenta,
  unchanged: color.gray,

  // Emphasis
  bold: color.bold,
  dim: color.gray,
  highlight: color.cyanBright,
  successBright: color.greenBright,
  errorBright: color.redBright,

  // Resource types
  resourceType: color.bold,
  resourceName: color.cyan,

  // File paths
  path: color.cyan,

  // Values
  value: color.white,
  placeholder: (text: string) => color.italic(color.gray(text)),
};

/**
 * Standardized symbols for CLI output
 */
export const symbols = {
  success: styles.success("\u2713"),
  error: styles.error("\u2716"),
  warning: styles.warning("\u26a0"),
  info: styles.info("i"),
  create: styles.create("+"),
  update: styles.update("~"),
  delete: styles.delete("-"),
  replace: styles.replace("\u00b1"),
  bullet: styles.dim("\u2022"),
  arrow: styles.dim("\u2192"),
};

/**
 * Log output modes
 */
export type LogMode = "default" | "stream" | "plain";

export interface LogOptions {
  /** Output mode (default: "default") */
  mode?: LogMode;
  /** Number of spaces to indent the entire line (default: 0) */
  indent?: number;
}

/** Field transformer function. null excludes the field from table output. */
export type FieldTransformer = ((value: unknown, item: object) => string) | null;

export interface OutOptions {
  /** Table display field transform/exclude settings. Only applied in table mode (not JSON). */
  display?: Record<string, FieldTransformer>;

  /** Show null values in table output (default: false) */
  showNull?: boolean;
}

// In JSON mode, all logs go to stderr to keep stdout clean for JSON data
let _jsonMode = false;
let _verbose = false;

// Values registered via `logger.registerSecret()`, redacted from diagnostic log output
const _secrets = new Set<string>();
const REDACTED_PLACEHOLDER = "<redacted>";
// Below this length, a registered value is too likely to match unrelated text.
const MIN_SECRET_LENGTH = 4;

/**
 * Aho-Corasick trie node. Indexed by individual UTF-16 code units (not Unicode code
 * points), matching how `string.indexOf`/`.slice` already index this file's strings — a
 * surrogate-pair character occupies two nodes, same as it occupies two `string` indices.
 */
interface TrieNode {
  children: Map<string, TrieNode>;
  fail: TrieNode;
  /** Secrets ending at this node, including those reached via `fail` links (precomputed). */
  outputs: string[];
}

/**
 * Builds a multi-pattern matcher for every registered secret, so `findSecretSpans` below
 * can find all of their occurrences in one pass over the text (`O(text.length + matches)`)
 * instead of scanning the full text once per registered secret. Rebuilt only when
 * `registerSecret` adds a genuinely new value (see `_automaton` below), so its
 * `O(total secret length)` construction cost is amortized across every log line redacted
 * while the secret set doesn't change.
 * @param secrets - Currently registered secrets
 * @returns Root of the built trie
 */
function buildAutomaton(secrets: ReadonlySet<string>): TrieNode {
  const root: TrieNode = {
    children: new Map(),
    fail: undefined as unknown as TrieNode,
    outputs: [],
  };
  root.fail = root;

  for (const secret of secrets) {
    let node = root;
    for (let i = 0; i < secret.length; i++) {
      const ch = secret[i] as string;
      let next = node.children.get(ch);
      if (!next) {
        next = { children: new Map(), fail: root, outputs: [] };
        node.children.set(ch, next);
      }
      node = next;
    }
    node.outputs.push(secret);
  }

  // A head index instead of Array#shift(): shift() re-indexes every remaining element on
  // each call, which would make this loop quadratic in the number of trie nodes rather than
  // the linear BFS this is meant to be.
  const queue: TrieNode[] = [...root.children.values()];
  for (let head = 0; head < queue.length; head++) {
    const parent = queue[head] as TrieNode;
    for (const [ch, child] of parent.children) {
      let fail = parent.fail;
      while (fail !== root && !fail.children.has(ch)) fail = fail.fail;
      child.fail = fail.children.get(ch) ?? root;
      child.outputs = child.outputs.concat(child.fail.outputs);
      queue.push(child);
    }
  }
  return root;
}

// Cached automaton for the current `_secrets` contents; `null` means rebuild on next use.
// Invalidated only when `registerSecret` actually grows `_secrets` (Set#add on an existing
// value is a no-op), so re-registering an already-known secret never triggers a rebuild.
let _automaton: TrieNode | null = null;

function getAutomaton(): TrieNode {
  _automaton ??= buildAutomaton(_secrets);
  return _automaton;
}

/**
 * Finds every occurrence of every registered secret in `text`, including overlapping ones,
 * in a single pass over `text` via the Aho-Corasick automaton.
 * @param text - Text to search
 * @returns Match spans as `[start, end)` pairs, in the order found
 */
function findSecretSpans(text: string): Array<[start: number, end: number]> {
  const spans: Array<[start: number, end: number]> = [];
  const root = getAutomaton();
  let node = root;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    while (node !== root && !node.children.has(ch)) node = node.fail;
    node = node.children.get(ch) ?? root;
    for (const secret of node.outputs) {
      spans.push([i + 1 - secret.length, i + 1]);
    }
  }
  return spans;
}

/**
 * Redacts every registered secret from `text` in a single pass over the original text.
 *
 * Matches are found against the original text only - never against text a previous
 * replacement produced - and overlapping/adjacent matches (whether one secret contains
 * another, or two secrets merely cross, e.g. registering "abcde" and "defghi" against
 * "abcdefghi") are merged into one contiguous span before any substitution happens. This
 * avoids two failure modes an iterative "replace one secret, then the next" approach has:
 * a later secret re-matching inside a placeholder a previous replacement already inserted,
 * and a crossing (non-nested) overlap leaving a fragment of one secret unredacted.
 *
 * Idempotent: a match that falls inside an occurrence of `<redacted>` already present in
 * `text` is discarded rather than substituted again. Without this, calling this function
 * twice on the same text (which happens whenever something already redacted, such as a
 * `--json` error envelope, is later passed to a diagnostic log call) could corrupt the
 * placeholder itself if a registered secret happens to be one of its substrings (e.g. a
 * secret literally containing "redact").
 * @param text - Text to redact
 * @returns `text` with every registered secret occurrence replaced by `<redacted>`
 */
export function redactSecrets(text: string): string {
  if (_secrets.size === 0) return text;

  const protectedSpans: Array<[start: number, end: number]> = [];
  for (let from = 0, index: number; (index = text.indexOf(REDACTED_PLACEHOLDER, from)) !== -1;) {
    protectedSpans.push([index, index + REDACTED_PLACEHOLDER.length]);
    from = index + REDACTED_PLACEHOLDER.length;
  }

  // Only a match wholly inside a protected placeholder is discarded (it can only be the
  // placeholder's own text, e.g. a registered secret that is a substring of "redacted").
  // A match that merely overlaps one — extending outside it, e.g. a registered secret that
  // happens to be "leak<redacted>" — still has real secret content outside the placeholder
  // and must still be replaced.
  //
  // A registered secret wholly contained in the placeholder (up to and including a secret
  // equal to "<redacted>" itself) is indistinguishable from the placeholder in rendered
  // output either way: substituting REDACTED_PLACEHOLDER for text that already reads
  // REDACTED_PLACEHOLDER is a no-op. Discarding the match here (rather than "fixing" it to
  // substitute anyway) isn't a redaction gap — it just skips redundant work on text that's
  // already the safe, masked form.
  const spans = findSecretSpans(text).filter(
    ([start, end]) => !protectedSpans.some(([pStart, pEnd]) => start >= pStart && end <= pEnd),
  );
  if (spans.length === 0) return text;
  spans.sort(([a], [b]) => a - b);

  const merged: Array<[start: number, end: number]> = [];
  for (const span of spans) {
    const last = merged.at(-1);
    if (last && span[0] <= last[1]) {
      last[1] = Math.max(last[1], span[1]);
    } else {
      merged.push(span);
    }
  }

  let result = "";
  let cursor = 0;
  for (const [start, end] of merged) {
    result += text.slice(cursor, start) + REDACTED_PLACEHOLDER;
    cursor = end;
  }
  return result + text.slice(cursor);
}

/**
 * Reset the registered-secret redaction state. Used for testing.
 *
 * `_secrets` is process-lifetime, module-level state with no production unregister API
 * (a real process should never stop hiding a secret it once saw). Test files that call
 * `logger.registerSecret()` and run in a Vitest project with `isolate: false` share this
 * state across files, so a value registered in one file's test can still be redacted in an
 * unrelated later file's assertions unless cleared between tests.
 */
export function resetSecretRegistry(): void {
  _secrets.clear();
  _automaton = null;
}

// Type icons for log output
const TYPE_ICONS: Record<string, string> = {
  info: "ℹ",
  success: "✔",
  warn: "⚠",
  error: "✖",
  debug: "⚙",
  trace: "→",
  log: "",
};

// Color functions for icon and message text
const TYPE_COLORS: Record<string, (text: string) => string> = {
  info: styles.info,
  success: styles.success,
  warn: styles.warning,
  error: styles.error,
  debug: styles.dim,
  trace: styles.dim,
  log: (text) => text,
};

interface FormatLogLineOptions {
  mode: string;
  indent: number;
  type: string;
  message: string;
  timestamp?: string;
}

/**
 * Formats a log line with the appropriate prefix and indentation
 * @param opts - Formatting options
 * @returns Formatted log line
 */
export function formatLogLine(opts: FormatLogLineOptions): string {
  const { mode, indent, type, message, timestamp } = opts;
  const indentPrefix = indent > 0 ? " ".repeat(indent) : "";
  const colorFn = TYPE_COLORS[type] || ((text: string) => text);

  // Plain mode: color only, no icon, no timestamp
  if (mode === "plain") {
    return `${indentPrefix}${colorFn(message)}\n`;
  }

  // Default/Stream mode: with icon and color
  const icon = TYPE_ICONS[type] || "";
  const prefix = icon ? `${icon} ` : "";
  const coloredOutput = colorFn(`${prefix}${message}`);
  const timestampPrefix = timestamp ?? "";

  return `${indentPrefix}${timestampPrefix}${coloredOutput}\n`;
}

/**
 * Writes a formatted log line to stderr.
 * @param type - Log type (info, success, warn, error, log)
 * @param message - Log message
 * @param opts - Log options (mode and indent)
 */
function writeLog(type: string, message: string, opts?: LogOptions): void {
  const mode = opts?.mode ?? "default";
  const indent = opts?.indent ?? 0;
  const inspectOpts: InspectOptions = {
    breakLength: process.stdout.columns || 80,
  };
  const formattedMessage = formatWithOptions(inspectOpts, message);
  const timestamp = mode === "stream" ? `${new Date().toLocaleTimeString()} ` : "";
  const output = formatLogLine({ mode, indent, type, message: formattedMessage, timestamp });
  process.stderr.write(renderFor(process.stderr, redactSecrets(output)));
}

/**
 * The CLI logger. Diagnostics go to stderr; `out()` writes primary output to
 * stdout as a table, or as JSON when `jsonMode` is on. `--json` and
 * `--verbose` feed the `jsonMode` / `verbose` state, which CLI plugins share
 * with the SDK code paths they call.
 */
export const logger = {
  get jsonMode(): boolean {
    return _jsonMode;
  },
  set jsonMode(value: boolean) {
    _jsonMode = value;
  },

  get verbose(): boolean {
    return _verbose || parseBoolean(process.env.DEBUG) === true || process.env.RUNNER_DEBUG === "1";
  },
  set verbose(value: boolean) {
    _verbose = value;
  },

  info(message: string, opts?: LogOptions): void {
    writeLog("info", message, opts);
  },

  success(message: string, opts?: LogOptions): void {
    writeLog("success", message, opts);
  },

  warn(message: string, opts?: LogOptions): void {
    writeLog("warn", message, opts);
  },

  error(message: string, opts?: LogOptions): void {
    writeLog("error", message, opts);
  },

  log(message: string): void {
    writeLog("log", message, { mode: "plain" });
  },

  newline(): void {
    process.stderr.write("\n");
  },

  debug(message: string): void {
    if (logger.verbose) {
      writeLog("log", styles.dim(message), { mode: "plain" });
    }
  },

  /**
   * Registers a value to be redacted from diagnostic log output (`info`/`success`/`warn`/
   * `error`/`log`/`debug`). Any occurrence of `value` — or of its JSON-string-escaped form,
   * so a value embedded in `JSON.stringify`d output (e.g. `--json` mode error envelopes)
   * is also caught — is replaced with `<redacted>` before it reaches stderr. Does not affect
   * `out()`, since some commands intentionally print secret values as their primary result.
   *
   * Values shorter than 4 characters are ignored, since they are too likely to match
   * unrelated text. A non-string value (e.g. `undefined` from an unvalidated external
   * payload cast to a typed shape) is ignored the same way, rather than throwing, since a
   * logging call must never be what crashes the process.
   * @param value - The secret value to redact from future log output
   */
  registerSecret(value: string): void {
    // Counts Unicode code points, not UTF-16 code units, so a value made of surrogate-pair
    // characters (e.g. emoji) isn't undercounted as longer than it actually is.
    if (typeof value !== "string" || [...value].length < MIN_SECRET_LENGTH) return;
    const sizeBefore = _secrets.size;
    _secrets.add(value);
    const jsonEscaped = JSON.stringify(value).slice(1, -1);
    if (jsonEscaped !== value) _secrets.add(jsonEscaped);
    // Set#add on an already-registered value is a no-op, so this only invalidates the
    // cached automaton (see findSecretSpans) when a genuinely new secret was added.
    if (_secrets.size !== sizeBefore) _automaton = null;
  },

  out(data: string | object | object[], options?: OutOptions): void {
    if (typeof data === "string") {
      process.stdout.write(renderFor(process.stdout, data.endsWith("\n") ? data : data + "\n"));
      return;
    }

    if (this.jsonMode) {
      // eslint-disable-next-line no-restricted-syntax
      console.log(JSON.stringify(data));
      return;
    }

    const display = options?.display;

    // Helper to format a value for table display
    const formatValue = (value: unknown, pretty = false): string => {
      if (options?.showNull && value === null) return "NULL";
      if (value === null || value === undefined) return "N/A";
      if (value instanceof Date) {
        return formatDistanceToNowStrict(value, { addSuffix: true });
      }
      if (typeof value === "object") {
        return pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value);
      }
      return String(value);
    };

    // Helper to check if field should be excluded
    const isExcluded = (key: string): boolean => {
      return display !== undefined && key in display && display[key] === null;
    };

    // Helper to apply transformer or default formatting
    const transformValue = (key: string, value: unknown, item: object, pretty = false): string => {
      if (display && key in display) {
        const transformer = display[key];
        if (transformer) {
          return transformer(value, item);
        }
      }
      return formatValue(value, pretty);
    };

    if (!Array.isArray(data)) {
      const entries = Object.entries(data).filter(([key]) => !isExcluded(key));
      const formattedEntries = entries.map(([key, value]) => [
        key,
        transformValue(key, value, data, true),
      ]);
      const t = renderTable(formattedEntries, { singleLine: false });
      process.stdout.write(renderFor(process.stdout, t));
      return;
    }

    if (data.length === 0) {
      return;
    }

    const allHeaders = Array.from(new Set(data.flatMap((item) => Object.keys(item))));
    const headers = allHeaders.filter((h) => !isExcluded(h));
    if (headers.length === 0) {
      return;
    }
    const rows = data.map((item) =>
      headers.map((header) =>
        transformValue(header, (item as Record<string, unknown>)[header], item),
      ),
    );

    const t = renderTable([headers, ...rows], {
      drawHorizontalLine: (lineIndex, rowCount) => {
        return lineIndex === 0 || lineIndex === 1 || lineIndex === rowCount;
      },
    });
    process.stdout.write(renderFor(process.stdout, t));
  },
};
