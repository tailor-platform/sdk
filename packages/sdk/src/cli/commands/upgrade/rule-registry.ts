import { gte, lt, valid } from "semver";
import type { MigrationRule } from "./types";

interface RuleRegistry {
  register(rule: MigrationRule): void;
  registerAll(rules: MigrationRule[]): void;
  getAllRules(): readonly MigrationRule[];
  getApplicableRules(fromVersion: string, toVersion: string): MigrationRule[];
}

/**
 * Registry for migration rules with version-gated filtering.
 * Rules are registered once into a closure and filtered per migration run
 * based on the source and target version range.
 * @returns A rule registry backed by function closures
 */
export function createRuleRegistry(): RuleRegistry {
  const rules: MigrationRule[] = [];

  /**
   * Register a single migration rule.
   * @param rule - The migration rule to register
   */
  function register(rule: MigrationRule): void {
    if (rules.some((registeredRule) => registeredRule.id === rule.id)) {
      throw new Error(`Duplicate migration rule ID: ${rule.id}`);
    }
    rules.push(rule);
  }

  /**
   * Register multiple migration rules at once.
   * @param nextRules - Array of migration rules to register
   */
  function registerAll(nextRules: MigrationRule[]): void {
    for (const rule of nextRules) {
      register(rule);
    }
  }

  /**
   * Get all registered rules (unfiltered).
   * @returns All registered migration rules
   */
  function getAllRules(): readonly MigrationRule[] {
    return rules;
  }

  /**
   * Get rules applicable to a specific version migration.
   *
   * A rule is applicable when its breaking-change boundary (`until`) falls
   * within the migration range: `fromVersion < rule.until <= toVersion`.
   *
   * `rule.since` is intentionally not checked. In chained migrations, earlier
   * rules transform the code so later rules' patterns match. If the source
   * predates `rule.since`, the rule simply finds no matches (harmless no-op).
   * @param fromVersion - The current SDK version (e.g., "1.30.0")
   * @param toVersion - The target SDK version (e.g., "2.0.0")
   * @returns Filtered list of applicable migration rules
   */
  function getApplicableRules(fromVersion: string, toVersion: string): MigrationRule[] {
    if (!valid(fromVersion)) {
      throw new Error(`Invalid source version: ${fromVersion}`);
    }
    if (!valid(toVersion)) {
      throw new Error(`Invalid target version: ${toVersion}`);
    }

    return rules.filter((rule) => {
      return lt(fromVersion, rule.until) && gte(toVersion, rule.until);
    });
  }

  return {
    register,
    registerAll,
    getAllRules,
    getApplicableRules,
  };
}
