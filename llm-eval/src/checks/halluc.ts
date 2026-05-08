import type { Signal } from "../types.ts";
import type { Inventory } from "../variants/inventory.ts";
import type { ParsedCall, ParsedImport } from "./parse.ts";

/**
 * Heuristic: any call whose receiver is a *named* SDK import but whose
 * receiver+method tuple is not in the inventory counts as a hallucinated
 * method.
 *
 * To avoid false positives on partially-known surfaces, we only flag when
 * the inventory has at least one known member for that receiver — i.e. we
 * actually have data to compare against.
 */
export function checkHallucinations(
  calls: ParsedCall[],
  imports: ParsedImport[],
  inventory: Inventory,
): Signal[] {
  const out: Signal[] = [];

  const sdkIdentifiers = new Set<string>();
  for (const imp of imports) {
    if (!imp.path.startsWith("@tailor-platform/sdk")) continue;
    for (const n of imp.named) sdkIdentifiers.add(n);
    if (imp.defaultName) sdkIdentifiers.add(imp.defaultName);
    if (imp.namespaceName) sdkIdentifiers.add(imp.namespaceName);
  }

  const seen = new Set<string>();
  for (const call of calls) {
    if (call.receiverChain.length === 0) continue;
    const root = call.receiverChain[0];
    if (!sdkIdentifiers.has(root)) continue;

    // Skip chained calls like `t.int().optional` — those require type-aware
    // checking, not surface lookup.
    if (call.callee.includes("(") || call.callee.includes("[")) continue;

    if (inventory.symbols.has(call.callee)) continue;

    // Direct member calls only: only flag when chain length is 1.
    if (call.receiverChain.length !== 1) continue;

    const knownMembers = inventory.members.get(root);
    if (!knownMembers || knownMembers.size === 0) continue;
    if (knownMembers.has(call.method)) continue;

    const dedupKey = `${root}.${call.method}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    out.push({
      type: "hallucinated_method",
      receiver: root,
      method: call.method,
    });
  }

  return out;
}
