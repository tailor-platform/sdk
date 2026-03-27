import { createRuleRegistry } from "../rule-registry";
import { v2Rules } from "./v2";

/**
 * Create and populate the default rule registry with all known migration rules.
 * @returns A populated rule registry
 */
export function createDefaultRegistry(): ReturnType<typeof createRuleRegistry> {
  const registry = createRuleRegistry();
  registry.registerAll(v2Rules);
  return registry;
}
