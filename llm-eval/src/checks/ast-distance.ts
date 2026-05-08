import type { Inventory } from "../variants/inventory.ts";
import { parseCode } from "./parse.ts";

export type VibeDistance = {
  distance: number;
  details: { invented: string[]; matched: string[] };
};

/**
 * Given LLM-predicted code (from the `predicted` condition where the SDK
 * surface was NOT shown) and the actual SDK inventory, compute how far the
 * model's expectation is from reality.
 *
 *   distance = invented / max(predicted_total, 1)
 *
 * 0 = perfect match. 1 = nothing matched.
 *
 * Only symbols sourced from `@tailor-platform/sdk*` are considered — the
 * universe is "what API does the LLM expect from the SDK", not "every call
 * the LLM made (incl. console.log)".
 */
export function computeVibeDistance(predictedCode: string, actual: Inventory): VibeDistance {
  const parsed = parseCode(predictedCode, "predicted.ts");

  const sdkRoots = new Set<string>();
  const referenced = new Set<string>();
  for (const imp of parsed.imports) {
    if (!imp.path.startsWith("@tailor-platform/sdk")) continue;
    for (const n of imp.named) {
      sdkRoots.add(n);
      referenced.add(n);
    }
    if (imp.defaultName) {
      sdkRoots.add(imp.defaultName);
      referenced.add(imp.defaultName);
    }
    if (imp.namespaceName) {
      sdkRoots.add(imp.namespaceName);
      referenced.add(imp.namespaceName);
    }
  }

  for (const call of parsed.calls) {
    const root = call.receiverChain[0];
    if (call.receiverChain.length === 1 && root && sdkRoots.has(root)) {
      // direct member call like db.type
      referenced.add(call.callee);
    }
  }

  if (referenced.size === 0) return { distance: 1, details: { invented: [], matched: [] } };

  const invented: string[] = [];
  const matched: string[] = [];
  for (const sym of referenced) {
    if (actual.symbols.has(sym)) matched.push(sym);
    else invented.push(sym);
  }
  const total = matched.length + invented.length;
  const distance = invented.length / Math.max(total, 1);
  return { distance, details: { invented, matched } };
}
