import fs from "node:fs";
import type { TraceEvent } from "./trace";

/**
 * "First-hit" measures whether the agent's first discovery query lands on a
 * canonical SDK symbol. It's the single strongest signal we have for API
 * self-evidence: an agent that types the right name on the first try has
 * found the API obvious; one that flounders through plausible-but-wrong
 * names has been misled by the design.
 *
 * Per iteration outcome:
 * - `hit`: the first grep / rg pattern matched at least one
 *   `canonicalSymbols` entry from the problem meta.
 * - `miss`: a grep / rg was issued but did not match.
 * - `no_grep`: the agent never invoked grep / rg (e.g. went straight to
 *   `Read` on a known path). Excluded from the hit-rate denominator.
 *
 * Per problem, `hitRate = hits / (hits + misses)`.
 */
export type FirstHitOutcome = "hit" | "miss" | "no_grep";

/**
 * How tightly the agent's grep pattern matched the symbol:
 * - `strict`: the canonical/attractor full name appears as a substring of the
 *   pattern, e.g. `\bdefineIdp\b` ⊃ `defineIdp`. This is the agent typing the
 *   actual symbol they're looking for.
 * - `prefix`: the pattern's regex matches the symbol, but the symbol isn't a
 *   substring of the pattern. Typically a prefix probe like `defineStatic`
 *   that catches both `defineStaticWebSite` and `defineStaticWebsite` —
 *   useful information, but it doesn't tell us which name the agent had in
 *   mind.
 */
export type HitStrictness = "strict" | "prefix";

export type FirstHitResult = {
  outcome: FirstHitOutcome;
  /** The pattern that was extracted from the first grep / rg command. */
  pattern?: string;
  /** Which canonical symbol matched, when outcome is `hit`. */
  matchedSymbol?: string;
  /** How tightly the pattern matched the symbol; set when outcome is `hit`. */
  strictness?: HitStrictness;
  /** The raw shell command we matched (useful for debugging false negatives). */
  command?: string;
};

export type FirstBiasMissResult = {
  isBiasMiss: boolean;
  pattern?: string;
  matchedAttractor?: string;
  /** How tightly the pattern matched the attractor; set when `isBiasMiss`. */
  strictness?: HitStrictness;
  command?: string;
};

export type FirstHitProblemStats = {
  problemId: string;
  hits: number;
  misses: number;
  noGrep: number;
  /** `hits / (hits + misses)`; 0 when the agent never issued a grep. */
  hitRate: number;
};

function pickString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/**
 * Unwrap `bash -lc "<inner>"` (and `sh -c "<inner>"`) wrappers so the
 * downstream matcher sees the inner rg / grep command.
 */
const BASH_LC_RE = /^\s*(?:\/(?:usr\/)?bin\/)?(?:ba)?sh\s+-l?c\s+(['"])([\s\S]*)\1\s*$/;
export function unwrapBashLc(command: string): string {
  const m = command.match(BASH_LC_RE);
  if (!m) return command;
  const inner = (m[2] ?? command).trim();
  // The outer bash `"..."` quote contributes one layer of backslash escapes
  // that the tokenizer below would otherwise treat as literal. Reverse it for
  // the characters bash actually escapes inside double quotes (\", \\, \$,
  // \`); leave \b, \w, etc. intact so they reach the regex matcher.
  return m[1] === '"' ? inner.replace(/\\(["\\$`])/g, "$1") : inner;
}

const GREP_TOOL_RE = /^(rg|grep|egrep|fgrep)$/;
const SHELL_OPERATORS = new Set(["|", "||", "&&", ";"]);

/**
 * Return the arg list of the first rg/grep/egrep/fgrep sub-command in a
 * shell line. We tokenize first so quoted patterns containing `|` (e.g.
 * `rg "foo\|bar"` alternation) aren't mistaken for a shell pipe, then walk
 * tokens until the first shell operator. Returns `null` when the head
 * sub-command is not a grep tool.
 */
export function extractGrepArgs(command: string): string[] | null {
  const all = tokenize(command);
  if (all.length === 0) return null;
  if (!GREP_TOOL_RE.test(all[0] ?? "")) return null;
  const out: string[] = [];
  for (let i = 1; i < all.length; i++) {
    const t = all[i]!;
    if (SHELL_OPERATORS.has(t)) break;
    out.push(t);
  }
  return out;
}

/**
 * Tokenize a shell-ish argument string respecting single + double quotes
 * (no command substitution, no variable expansion). Sufficient for grep
 * patterns the agent typically emits.
 *
 * Shell operators (`|`, `||`, `&&`, `;`) are emitted as standalone tokens
 * even when they're jammed against an argument (`rg foo|head` →
 * `["rg", "foo", "|", "head"]`). This lets {@link extractGrepArgs} stop
 * cleanly at the operator instead of swallowing the next command into the
 * pattern.
 */
export function tokenize(s: string): string[] {
  const out: string[] = [];
  let buf = "";
  let quote: '"' | "'" | null = null;
  const flush = (): void => {
    if (buf) {
      out.push(buf);
      buf = "";
    }
  };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i] ?? "";
    if (quote) {
      if (ch === quote) {
        quote = null;
        continue;
      }
      if (quote === '"' && ch === "\\" && i + 1 < s.length) {
        buf += s[i + 1];
        i++;
        continue;
      }
      buf += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch as '"' | "'";
      continue;
    }
    if (/\s/.test(ch)) {
      flush();
      continue;
    }
    // Shell operators outside quotes — flush current buf and emit the
    // operator as its own token so it can break extractGrepArgs even when
    // it touches an argument (`rg foo|head`, `rg missing||true`).
    if (ch === "|" && s[i + 1] === "|") {
      flush();
      out.push("||");
      i++;
      continue;
    }
    if (ch === "&" && s[i + 1] === "&") {
      flush();
      out.push("&&");
      i++;
      continue;
    }
    if (ch === "|") {
      flush();
      out.push("|");
      continue;
    }
    if (ch === ";") {
      flush();
      out.push(";");
      continue;
    }
    buf += ch;
  }
  flush();
  return out;
}

// Flags that put rg / grep into "list filenames" / "no search" mode, so
// any positional after them is a path, not a regex pattern. When the agent
// uses any of these the invocation is exploratory (file listing or
// help / version probing) rather than a symbol-discovery query.
const LIST_MODE_FLAGS = new Set([
  "--files",
  "--files-with-matches",
  "-l",
  "--files-without-match",
  "-L",
  "--type-list",
  "--help",
  "-h",
  "--version",
  "-V",
]);

// Flags from rg/grep that consume the next token as their value. Used to
// skip past flag values when picking the first positional pattern.
const FLAGS_WITH_VALUE = new Set([
  "-e",
  "--regexp",
  "-f",
  "--file",
  "-A",
  "--after-context",
  "-B",
  "--before-context",
  "-C",
  "--context",
  "-t",
  "--type",
  "-T",
  "--type-not",
  "-g",
  "--glob",
  "-m",
  "--max-count",
  "-M",
  "--max-columns",
  "-d",
  "--max-depth",
  "--max-filesize",
  "--iglob",
  "--replace",
]);

/**
 * Extract the regex pattern from a parsed grep arg list. Honors `-e <pat>`,
 * `--regexp=<pat>`, then falls back to the first non-flag positional arg.
 */
export function extractPatternFromArgs(args: string[]): string | null {
  // List-mode flags (e.g. `--files`, `-l`) mean any positional is a path,
  // not a regex pattern. Treat the whole invocation as patternless.
  if (args.some((a) => LIST_MODE_FLAGS.has(a))) return null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "-e" || a === "--regexp") return args[i + 1] ?? null;
    if (a.startsWith("-e=")) return a.slice(3);
    if (a.startsWith("--regexp=")) return a.slice("--regexp=".length);
  }
  let i = 0;
  while (i < args.length) {
    const a = args[i]!;
    if (FLAGS_WITH_VALUE.has(a)) {
      i += 2;
      continue;
    }
    if (a.startsWith("-") && a.length > 1) {
      i += 1;
      continue;
    }
    return a;
  }
  return null;
}

/**
 * Decide whether `pattern` matches any string in `symbols`. The pattern is
 * compiled as a regex (`new RegExp(pattern)`); when compilation fails we
 * fall back to bidirectional substring match so simple-but-malformed
 * patterns still classify reasonably.
 */
export function matchAnyCanonical(pattern: string, symbols: readonly string[]): string | null {
  return matchAnyCanonicalWithStrictness(pattern, symbols)?.symbol ?? null;
}

/**
 * Like {@link matchAnyCanonical} but also reports *how* the pattern matched
 * the symbol. See {@link HitStrictness}.
 */
export function matchAnyCanonicalWithStrictness(
  pattern: string,
  symbols: readonly string[],
): { symbol: string; strictness: HitStrictness } | null {
  // Strip regex zero-width assertions so a probe like `\bdefineIdp\b`
  // compares cleanly against the bare symbol.
  const stripped = pattern
    .replace(/\\[bB]/g, "")
    .replace(/^\^/, "")
    .replace(/\$$/, "");

  // First pass: strict — the full symbol name appears in the pattern with
  // identifier-level boundaries. Plain `stripped.includes(s)` would call
  // `getDBClient` a strict hit for canonical `getDB`, which is exactly the
  // false-positive we want to avoid. Anchoring with word boundaries (using
  // lookbehind / lookahead, dropped when the symbol itself starts or ends
  // with a non-word character like `.method`) keeps alternations like
  // `oauth2Clients|defineAuth` strict while rejecting longer-name overlaps.
  for (const s of symbols) {
    if (containsWholeIdentifier(stripped, s)) {
      return { symbol: s, strictness: "strict" };
    }
  }

  // Second pass: regex match without substring equality. Catches prefix
  // probes (`defineStatic`) and the symbol-includes-pattern direction
  // (`kysely` matching `kyselyTypePlugin`).
  let re: RegExp | null = null;
  try {
    re = new RegExp(stripped);
  } catch {
    re = null;
  }
  for (const s of symbols) {
    if (re && re.test(s)) return { symbol: s, strictness: "prefix" };
    if (!re && s.includes(stripped)) return { symbol: s, strictness: "prefix" };
  }
  return null;
}

const REGEX_META = /[.*+?^${}()|[\]\\]/g;

/**
 * Test whether `pattern` contains `symbol` at identifier-level boundaries:
 * the character before `symbol` is not a word character (or the start of
 * the pattern) and the character after is not a word character (or the
 * end). Symbols that themselves start/end with a non-word character (e.g.
 * `.method`) drop the matching boundary check so members like
 * `db.aggregate.method` still match.
 */
function containsWholeIdentifier(pattern: string, symbol: string): boolean {
  const escaped = symbol.replace(REGEX_META, "\\$&");
  const left = /^\w/.test(symbol) ? "(?<!\\w)" : "";
  const right = /\w$/.test(symbol) ? "(?!\\w)" : "";
  return new RegExp(`${left}${escaped}${right}`).test(pattern);
}

/**
 * Walk events, find the first Bash event whose command starts with a grep
 * tool (after `bash -lc` unwrap), and classify the outcome.
 */
export function classifyFirstHit(
  events: Iterable<TraceEvent>,
  canonicalSymbols: readonly string[],
): FirstHitResult {
  for (const event of events) {
    if (event.kind !== "tool_use") continue;
    if (event.name !== "Bash") continue;
    const command = pickString(event.input["command"]);
    if (!command) continue;
    const inner = unwrapBashLc(command);
    const grepArgs = extractGrepArgs(inner);
    if (!grepArgs) continue;
    const pattern = extractPatternFromArgs(grepArgs);
    // Patternless invocations like `rg --files` are file listings, not
    // symbol-discovery queries — skip past them so the metric measures the
    // first *symbol* search the agent issued.
    if (!pattern) continue;
    const matched = matchAnyCanonicalWithStrictness(pattern, canonicalSymbols);
    if (matched) {
      return {
        outcome: "hit",
        pattern,
        matchedSymbol: matched.symbol,
        strictness: matched.strictness,
        command,
      };
    }
    return { outcome: "miss", pattern, command };
  }
  return { outcome: "no_grep" };
}

/**
 * Same shape as {@link classifyFirstHit}, but tests the first grep pattern
 * against the bias-attractor list (plausible-but-wrong names). A `true`
 * result is mutually exclusive with `classifyFirstHit` returning `hit`
 * provided the two symbol lists don't overlap (problem authors should keep
 * them disjoint).
 */
export function classifyFirstBiasMiss(
  events: Iterable<TraceEvent>,
  biasAttractors: readonly string[],
): FirstBiasMissResult {
  for (const event of events) {
    if (event.kind !== "tool_use") continue;
    if (event.name !== "Bash") continue;
    const command = pickString(event.input["command"]);
    if (!command) continue;
    const inner = unwrapBashLc(command);
    const grepArgs = extractGrepArgs(inner);
    if (!grepArgs) continue;
    const pattern = extractPatternFromArgs(grepArgs);
    if (!pattern) continue;
    const matched = matchAnyCanonicalWithStrictness(pattern, biasAttractors);
    if (matched) {
      return {
        isBiasMiss: true,
        pattern,
        matchedAttractor: matched.symbol,
        strictness: matched.strictness,
        command,
      };
    }
    return { isBiasMiss: false, pattern, command };
  }
  return { isBiasMiss: false };
}

/**
 * Stream a JSONL trace file and classify the first-hit outcome against the
 * given canonical-symbol list. Missing / unreadable files classify as
 * `no_grep` so callers don't need to gate on existence.
 */
export function classifyFirstHitFromTraceFile(
  traceFile: string,
  canonicalSymbols: readonly string[],
): FirstHitResult {
  const events = readTraceEvents(traceFile);
  return classifyFirstHit(events, canonicalSymbols);
}

function readTraceEvents(traceFile: string): TraceEvent[] {
  let content: string;
  try {
    content = fs.readFileSync(traceFile, "utf-8");
  } catch {
    return [];
  }
  const events: TraceEvent[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed) as TraceEvent);
    } catch {
      // skip malformed lines
    }
  }
  return events;
}

/**
 * Aggregate per-iteration outcomes into a per-problem stats record.
 */
export function aggregateFirstHit(
  problemId: string,
  results: readonly FirstHitResult[],
): FirstHitProblemStats {
  let hits = 0;
  let misses = 0;
  let noGrep = 0;
  for (const r of results) {
    if (r.outcome === "hit") hits++;
    else if (r.outcome === "miss") misses++;
    else noGrep++;
  }
  const denom = hits + misses;
  return {
    problemId,
    hits,
    misses,
    noGrep,
    hitRate: denom > 0 ? hits / denom : 0,
  };
}
