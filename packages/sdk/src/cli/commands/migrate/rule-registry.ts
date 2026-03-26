import { satisfies, valid } from "semver";
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
   * A rule is applicable when:
   * - The source version satisfies `>= rule.since` AND `< rule.until`
   * - The target version satisfies `>= rule.until`
   *
   * This ensures rules are only applied when migrating across the version
   * boundary where the breaking change was introduced.
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
      // A rule applies when its version boundary (until) falls within the migration range.
      // This ensures multi-version migrations (e.g., 1.30 -> 3.0) pick up all intermediate
      // rules, since earlier rules transform the code to match later rules' patterns.
      const notYetCrossed = satisfies(fromVersion, `<${rule.until}`);
      const targetPastBreakingChange = satisfies(toVersion, `>=${rule.until}`);
      return notYetCrossed && targetPastBreakingChange;
    });
  }
}
