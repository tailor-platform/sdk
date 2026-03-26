import { describe, expect, it } from "vitest";
import { RuleRegistry } from "./rule-registry";
import type { MigrationRule, TransformContext, TransformResult } from "./types";

function createTestRule(overrides: Partial<MigrationRule> = {}): MigrationRule {
  return {
    id: "test/sample",
    name: "Sample Rule",
    description: "A test migration rule",
    since: "1.0.0",
    until: "2.0.0",
    transform: async (_ctx: TransformContext): Promise<TransformResult> => ({
      changed: false,
      filesModified: [],
      warnings: [],
    }),
    ...overrides,
  };
}

describe("RuleRegistry", () => {
  describe("register", () => {
    it("should register a rule", () => {
      const registry = new RuleRegistry();
      const rule = createTestRule();
      registry.register(rule);
      expect(registry.getAllRules()).toEqual([rule]);
    });

    it("should reject duplicate rule IDs", () => {
      const registry = new RuleRegistry();
      registry.register(createTestRule({ id: "test/dup" }));
      expect(() => registry.register(createTestRule({ id: "test/dup" }))).toThrow(
        "Duplicate migration rule ID: test/dup",
      );
    });
  });

  describe("registerAll", () => {
    it("should register multiple rules", () => {
      const registry = new RuleRegistry();
      const rules = [createTestRule({ id: "test/a" }), createTestRule({ id: "test/b" })];
      registry.registerAll(rules);
      expect(registry.getAllRules()).toHaveLength(2);
    });
  });

  describe("getApplicableRules", () => {
    it("should return rules applicable to the version range", () => {
      const registry = new RuleRegistry();
      const rule = createTestRule({ since: "1.0.0", until: "2.0.0" });
      registry.register(rule);

      const applicable = registry.getApplicableRules("1.30.0", "2.0.0");
      expect(applicable).toEqual([rule]);
    });

    it("should exclude rules when source version is already past the breaking change", () => {
      const registry = new RuleRegistry();
      registry.register(createTestRule({ since: "1.0.0", until: "2.0.0" }));

      const applicable = registry.getApplicableRules("2.0.0", "3.0.0");
      expect(applicable).toEqual([]);
    });

    it("should exclude rules when target version is before the breaking change", () => {
      const registry = new RuleRegistry();
      registry.register(createTestRule({ since: "1.0.0", until: "2.0.0" }));

      const applicable = registry.getApplicableRules("1.5.0", "1.9.0");
      expect(applicable).toEqual([]);
    });

    it("should handle multiple rules with different version ranges", () => {
      const registry = new RuleRegistry();
      const rule1 = createTestRule({ id: "test/v2", since: "1.0.0", until: "2.0.0" });
      const rule2 = createTestRule({ id: "test/v3", since: "2.0.0", until: "3.0.0" });
      const rule3 = createTestRule({ id: "test/v2-late", since: "1.20.0", until: "2.0.0" });
      registry.registerAll([rule1, rule2, rule3]);

      // Migrating from 1.30.0 to 2.0.0: should get v2 rules only
      expect(registry.getApplicableRules("1.30.0", "2.0.0")).toEqual([rule1, rule3]);

      // Migrating from 1.30.0 to 3.0.0: should get both v2 and v3 rules
      // (v2 rules: source 1.30.0 is in [1.0.0, 2.0.0), target 3.0.0 >= 2.0.0)
      // (v3 rule: source 1.30.0 is NOT in [2.0.0, 3.0.0), so excluded)
      expect(registry.getApplicableRules("1.30.0", "3.0.0")).toEqual([rule1, rule3]);

      // Migrating from 2.0.0 to 3.0.0: should get v3 rule only
      expect(registry.getApplicableRules("2.0.0", "3.0.0")).toEqual([rule2]);
    });

    it("should handle patch versions correctly", () => {
      const registry = new RuleRegistry();
      const rule = createTestRule({ since: "1.0.0", until: "2.0.0" });
      registry.register(rule);

      expect(registry.getApplicableRules("1.32.1", "2.0.0")).toEqual([rule]);
      expect(registry.getApplicableRules("1.32.1", "2.1.0")).toEqual([rule]);
    });

    it("should throw on invalid version strings", () => {
      const registry = new RuleRegistry();
      expect(() => registry.getApplicableRules("invalid", "2.0.0")).toThrow(
        "Invalid source version",
      );
      expect(() => registry.getApplicableRules("1.0.0", "invalid")).toThrow(
        "Invalid target version",
      );
    });
  });
});
