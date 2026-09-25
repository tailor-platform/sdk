import { parse, Lang } from "@ast-grep/napi";
import type { Edit, SgNode } from "@ast-grep/napi";

const NEEDLE = "executeScript";

function quickFilter(source: string): boolean {
  return source.includes(NEEDLE) && source.includes("JSON.stringify");
}

function pairKeyText(pair: SgNode): string | null {
  const key = pair.children()[0];
  if (!key) return null;
  return key.text().replace(/^['"]|['"]$/g, "");
}

/**
 * True when `stringifyCall` is the value of a top-level `arg:` property in the
 * object literal passed directly to `executeScript(...)`. The chain checked is
 * `JSON.stringify(...)` → pair (`arg:`) → object → arguments → `executeScript`
 * call, so a nested `arg:` (e.g. `executeScript({ opts: { arg: ... } })`) or an
 * unrelated `JSON.stringify` is left untouched.
 */
function isExecuteScriptArg(stringifyCall: SgNode): boolean {
  const pair = stringifyCall.parent();
  if (!pair || pair.kind() !== "pair") return false;
  if (pairKeyText(pair) !== "arg") return false;

  const obj = pair.parent();
  if (!obj || obj.kind() !== "object") return false;

  const args = obj.parent();
  if (!args || args.kind() !== "arguments") return false;

  const call = args.parent();
  if (!call || call.kind() !== "call_expression") return false;

  const callee = call.children()[0];
  return !!callee && callee.text() === NEEDLE;
}

/**
 * Rewrite `executeScript({ ..., arg: JSON.stringify(X), ... })` to
 * `executeScript({ ..., arg: X, ... })`.
 *
 * In v2 the `executeScript` `arg` option takes a JSON-serializable value and
 * serializes it internally, so a pre-stringified argument double-encodes. Only
 * the literal `arg: JSON.stringify(<single expr>)` form is rewritten; indirect
 * forms (a stringified value held in a variable, `JSON.stringify(x, null, 2)`,
 * etc.) are left for manual migration.
 * @param source - File contents
 * @param _filePath - Absolute path to the file (kept for the runner signature)
 * @returns Transformed source or null when nothing matched.
 */
export default function transform(source: string, _filePath: string): string | null {
  if (!quickFilter(source)) return null;

  const lang = source.includes("</") || source.includes("/>") ? Lang.Tsx : Lang.TypeScript;
  const root = parse(lang, source).root();

  const edits: Edit[] = [];
  for (const match of root.findAll({ rule: { pattern: "JSON.stringify($X)" } })) {
    if (!isExecuteScriptArg(match)) continue;
    const inner = match.getMatch("X");
    if (!inner) continue;
    edits.push(match.replace(inner.text()));
  }

  if (edits.length === 0) return null;

  const result = root.commitEdits(edits);
  return result === source ? null : result;
}
