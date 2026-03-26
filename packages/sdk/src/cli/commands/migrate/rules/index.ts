import { RuleRegistry } from "../rule-registry";
import { v2Rules } from "./v2";

/**
 * Create and populate the default rule registry with all known migration rules.
 * @returns A populated RuleRegistry instance
 */
export function createDefaultRegistry(): RuleRegistry {
  const registry = new RuleRegistry();
  registry.registerAll(v2Rules);
  return registry;
}
