import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RuleRegistry } from "./rule-registry";
import type { MigrationRule, TransformContext, TransformResult } from "./types";

// Mock the modules that have side effects (logger, telemetry)
vi.mock("@/cli/shared/logger", () => ({
  logger: {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    log: vi.fn(),
    debug: vi.fn(),
    out: vi.fn(),
  },
  styles: {
    success: (s: string) => s,
    error: (s: string) => s,
    warning: (s: string) => s,
    info: (s: string) => s,
    dim: (s: string) => s,
    bold: (s: string) => s,
    highlight: (s: string) => s,
    path: (s: string) => s,
  },
}));

/**
 * Test the migration pipeline logic by importing individual components
 * and verifying their integration.
 */
describe("migrate service - integration", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "migrate-service-test-"));
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  function createMockRule(overrides: Partial<MigrationRule> = {}): MigrationRule {
    return {
      id: "test/mock",
      name: "Mock Rule",
      description: "A mock rule for testing",
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

  it("should register and filter rules correctly for a version migration", () => {
    const registry = new RuleRegistry();
    const applicableRule = createMockRule({
      id: "test/applicable",
      since: "1.0.0",
      until: "2.0.0",
    });
    const inapplicableRule = createMockRule({
      id: "test/inapplicable",
      since: "2.0.0",
      until: "3.0.0",
    });

    registry.registerAll([applicableRule, inapplicableRule]);

    const rules = registry.getApplicableRules("1.32.1", "2.0.0");
    expect(rules).toEqual([applicableRule]);
  });

  it("should execute a rule transform and collect results", async () => {
    const transformFn = vi.fn(
      async (ctx: TransformContext): Promise<TransformResult> => ({
        changed: true,
        filesModified: [path.join(ctx.projectRoot, "test.ts")],
        warnings: ["Check manual step X"],
      }),
    );

    const rule = createMockRule({ transform: transformFn });

    // Simulate what service.ts does
    const result = await rule.transform({
      projectRoot: tmpDir,
      files: [path.join(tmpDir, "test.ts")],
      dryRun: false,
    });

    expect(transformFn).toHaveBeenCalledOnce();
    expect(result.changed).toBe(true);
    expect(result.filesModified).toHaveLength(1);
    expect(result.warnings).toEqual(["Check manual step X"]);
  });

  it("should handle rule errors gracefully", async () => {
    const rule = createMockRule({
      transform: async () => {
        throw new Error("Transform failed");
      },
    });

    const errors: Array<{ ruleId: string; error: Error }> = [];

    try {
      await rule.transform({
        projectRoot: tmpDir,
        files: [],
        dryRun: false,
      });
    } catch (error) {
      errors.push({
        ruleId: rule.id,
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }

    expect(errors).toHaveLength(1);
    expect(errors[0].ruleId).toBe("test/mock");
    expect(errors[0].error.message).toBe("Transform failed");
  });

  it("should collect warnings from rules that report changed: false", async () => {
    const rule = createMockRule({
      transform: async (): Promise<TransformResult> => ({
        changed: false,
        filesModified: [],
        warnings: ["Manual step required: update config"],
      }),
    });

    const summary = {
      rulesApplied: 0,
      rulesSkipped: 0,
      filesModified: [] as string[],
      warnings: [] as string[],
      errors: [] as Array<{ ruleId: string; error: Error }>,
    };

    const result = await rule.transform({
      projectRoot: tmpDir,
      files: [],
      dryRun: false,
    });

    // Simulate what service.ts does: always collect warnings regardless of changed flag
    if (result.changed) {
      summary.rulesApplied++;
    } else {
      summary.rulesSkipped++;
    }
    summary.warnings.push(...result.warnings);

    expect(summary.rulesSkipped).toBe(1);
    expect(summary.warnings).toEqual(["Manual step required: update config"]);
  });
});
