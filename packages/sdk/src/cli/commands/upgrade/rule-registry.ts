import { gte, lt, valid } from "semver";
import type { MigrationRule } from "./types";

/**
 * Registry for migration rules with version-gated filtering.
 * Rules are registered once and filtered per migration run based on
 * the source and target version range.
 */
export class RuleRegistry {
  private readonly rules: MigrationRule[] = [];

  /**
   * Register a single migration rule.
   * @param rule - The migration rule to register
   */
  register(rule: MigrationRule): void {
    if (this.rules.some((r) => r.id === rule.id)) {
      throw new Error(`Duplicate migration rule ID: ${rule.id}`);
    }
    this.rules.push(rule);
  }

  /**
   * Register multiple migration rules at once.
   * @param rules - Array of migration rules to register
   */
  registerAll(rules: MigrationRule[]): void {
    for (const rule of rules) {
      this.register(rule);
    }
  }

  /**
   * Get all registered rules (unfiltered).
   * @returns All registered migration rules
   */
  getAllRules(): readonly MigrationRule[] {
    return this.rules;
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
  getApplicableRules(fromVersion: string, toVersion: string): MigrationRule[] {
    if (!valid(fromVersion)) {
      throw new Error(`Invalid source version: ${fromVersion}`);
    }
    if (!valid(toVersion)) {
      throw new Error(`Invalid target version: ${toVersion}`);
    }

    return this.rules.filter((rule) => {
      return lt(fromVersion, rule.until) && gte(toVersion, rule.until);
    });
  }
}
