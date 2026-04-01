import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRuleRegistry } from "./rule-registry";
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

vi.mock("@/cli/shared/prompt", () => ({
  prompt: {
    confirm: vi.fn(),
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
    const registry = createRuleRegistry();
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

  it("should pass custom files to rules with filePatterns", async () => {
    // Create both TS and JSON files in the temp directory
    await fs.promises.writeFile(path.join(tmpDir, "config.ts"), "export default {};");
    await fs.promises.writeFile(path.join(tmpDir, "data.json"), "{}");

    const receivedFiles: string[][] = [];

    const ruleWithPatterns = createMockRule({
      id: "test/json-rule",
      filePatterns: ["**/*.json"],
      transform: async (ctx: TransformContext): Promise<TransformResult> => {
        receivedFiles.push([...ctx.files]);
        return { changed: false, filesModified: [], warnings: [] };
      },
    });

    const ruleWithoutPatterns = createMockRule({
      id: "test/ts-rule",
      transform: async (ctx: TransformContext): Promise<TransformResult> => {
        receivedFiles.push([...ctx.files]);
        return { changed: false, filesModified: [], warnings: [] };
      },
    });

    // Simulate what service.ts does with filePatterns
    const { collectFiles } = await import("./file-collector");
    const defaultFiles = await collectFiles(tmpDir);

    for (const rule of [ruleWithPatterns, ruleWithoutPatterns]) {
      const files = rule.filePatterns
        ? await collectFiles(tmpDir, rule.filePatterns)
        : defaultFiles;
      await rule.transform({ projectRoot: tmpDir, files, dryRun: false });
    }

    // Rule with filePatterns should receive only JSON files
    expect(receivedFiles[0]).toHaveLength(1);
    expect(receivedFiles[0][0]).toContain("data.json");

    // Rule without filePatterns should receive only TS files (default)
    expect(receivedFiles[1]).toHaveLength(1);
    expect(receivedFiles[1][0]).toContain("config.ts");
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

  it("should chain intermediate results between rules in dry-run mode via createRule", async () => {
    // Rule A renames "oldName" to "midName", Rule B renames "midName" to "newName".
    // In dry-run without fileOverrides, Rule B would see the original file and skip.
    // With fileOverrides, Rule B sees Rule A's output and matches "midName".
    const { createRule } = await import("./rule-helpers");

    const filePath = path.join(tmpDir, "chain.ts");
    await fs.promises.writeFile(filePath, 'const oldName = "hello";');

    const ruleA = createRule(
      { id: "test/chain-a", name: "A", description: "d", since: "0.0.0", until: "1.0.0" },
      (source) => {
        if (!source.includes("oldName")) return null;
        return source.replace(/\boldName\b/g, "midName");
      },
    );

    const ruleB = createRule(
      { id: "test/chain-b", name: "B", description: "d", since: "0.0.0", until: "1.0.0" },
      (source) => {
        if (!source.includes("midName")) return null;
        return source.replace(/\bmidName\b/g, "newName");
      },
    );

    // Simulate what service.ts does: maintain fileOverrides across rules
    const fileOverrides = new Map<string, string>();
    let rulesApplied = 0;
    let lastAfter = "";

    for (const rule of [ruleA, ruleB]) {
      const result = await rule.transform({
        projectRoot: tmpDir,
        files: [filePath],
        dryRun: true,
        fileOverrides,
      });
      if (result.changed && result.diffs) {
        rulesApplied++;
        for (const diff of result.diffs) {
          fileOverrides.set(diff.file, diff.after);
          lastAfter = diff.after;
        }
      }
    }

    // Both rules should have applied (Rule B sees Rule A's output via fileOverrides)
    expect(rulesApplied).toBe(2);
    expect(lastAfter).toBe('const newName = "hello";');
    // Original file should be unchanged (dry-run)
    const onDisk = await fs.promises.readFile(filePath, "utf-8");
    expect(onDisk).toBe('const oldName = "hello";');
  });
});

describe("upgrade - interactive mode", () => {
  let tmpDir: string;

  beforeEach(async () => {
    vi.resetModules();
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "migrate-interactive-test-"));
    // Create a package.json with SDK dependency so version detection works
    await fs.promises.writeFile(
      path.join(tmpDir, "package.json"),
      JSON.stringify({
        dependencies: { "@tailor-platform/sdk": "1.0.0" },
      }),
    );
    // Create node_modules structure for installed version detection
    const sdkDir = path.join(tmpDir, "node_modules", "@tailor-platform", "sdk");
    await fs.promises.mkdir(sdkDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(sdkDir, "package.json"),
      JSON.stringify({ name: "@tailor-platform/sdk", version: "1.0.0" }),
    );
    // Create a target TS file
    await fs.promises.writeFile(path.join(tmpDir, "test.ts"), 'const x = "before";');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  async function mockPromptConfirm(answer: boolean): Promise<void> {
    const { prompt } = await import("@/cli/shared/prompt");
    vi.mocked(prompt.confirm).mockResolvedValue(answer);
  }

  function createChangingRule(id: string, filePath: string, afterContent: string): MigrationRule {
    return {
      id,
      name: `Rule ${id}`,
      description: `Test rule ${id}`,
      since: "1.0.0",
      until: "2.0.0",
      transform: async (ctx: TransformContext): Promise<TransformResult> => {
        const beforeContent = await fs.promises.readFile(filePath, "utf-8");
        if (!ctx.dryRun) {
          await fs.promises.writeFile(filePath, afterContent, "utf-8");
        }
        return {
          changed: true,
          filesModified: [filePath],
          warnings: [],
          diffs: [{ file: filePath, before: beforeContent, after: afterContent }],
        };
      },
    };
  }

  it("should pass dryRun=true to rules when interactive mode is enabled", async () => {
    const receivedDryRun: boolean[] = [];

    vi.doMock("./rules", () => ({
      createDefaultRegistry: () => ({
        getApplicableRules: () => [
          {
            id: "test/spy",
            name: "Spy Rule",
            description: "Captures dryRun flag",
            since: "1.0.0",
            until: "2.0.0",
            transform: async (ctx: TransformContext): Promise<TransformResult> => {
              receivedDryRun.push(ctx.dryRun);
              return { changed: false, filesModified: [], warnings: [] };
            },
          },
        ],
      }),
    }));

    const { upgrade } = await import("./service");
    await upgrade({ to: "2.0.0", dryRun: false, path: tmpDir, interactive: true });

    expect(receivedDryRun).toEqual([true]);
  });

  it("should write files when user accepts changes in interactive mode", async () => {
    await mockPromptConfirm(true);

    const filePath = path.join(tmpDir, "test.ts");
    const afterContent = 'const x = "after";';

    vi.doMock("./rules", () => ({
      createDefaultRegistry: () => ({
        getApplicableRules: () => [createChangingRule("test/accept", filePath, afterContent)],
      }),
    }));

    const { upgrade } = await import("./service");
    await upgrade({ to: "2.0.0", dryRun: false, path: tmpDir, interactive: true });

    const written = await fs.promises.readFile(filePath, "utf-8");
    expect(written).toBe(afterContent);
  });

  it("should not write files when user rejects changes in interactive mode", async () => {
    await mockPromptConfirm(false);

    const filePath = path.join(tmpDir, "test.ts");
    const originalContent = await fs.promises.readFile(filePath, "utf-8");

    vi.doMock("./rules", () => ({
      createDefaultRegistry: () => ({
        getApplicableRules: () => [
          createChangingRule("test/reject", filePath, 'const x = "changed";'),
        ],
      }),
    }));

    const { upgrade } = await import("./service");
    await upgrade({ to: "2.0.0", dryRun: false, path: tmpDir, interactive: true });

    const written = await fs.promises.readFile(filePath, "utf-8");
    expect(written).toBe(originalContent);
  });

  it("should count rejected rules as skipped", async () => {
    await mockPromptConfirm(false);

    const filePath = path.join(tmpDir, "test.ts");

    vi.doMock("./rules", () => ({
      createDefaultRegistry: () => ({
        getApplicableRules: () => [
          createChangingRule("test/skip", filePath, 'const x = "changed";'),
        ],
      }),
    }));

    const { upgrade } = await import("./service");
    await upgrade({ to: "2.0.0", dryRun: false, path: tmpDir, interactive: true });

    // "Skipped by user" should appear in the log calls
    const { logger } = await import("@/cli/shared/logger");
    const logCalls = vi.mocked(logger.log).mock.calls.flat();
    expect(logCalls.some((c) => typeof c === "string" && c.includes("Skipped by user"))).toBe(true);
  });

  it("should skip interactive custom rules that do not provide diffs", async () => {
    const filePath = path.join(tmpDir, "test.ts");
    const originalContent = await fs.promises.readFile(filePath, "utf-8");
    const { logger } = await import("@/cli/shared/logger");
    vi.mocked(logger.log).mockClear();
    vi.mocked(logger.success).mockClear();

    vi.doMock("./rules", () => ({
      createDefaultRegistry: () => ({
        getApplicableRules: () => [
          {
            id: "test/no-diff-interactive",
            name: "No Diff Interactive Rule",
            description: "Reports changed without diff output",
            since: "1.0.0",
            until: "2.0.0",
            transform: async (): Promise<TransformResult> => ({
              changed: true,
              filesModified: [filePath],
              warnings: [],
            }),
          },
        ],
      }),
    }));

    const { upgrade } = await import("./service");
    await upgrade({ to: "2.0.0", dryRun: false, path: tmpDir, interactive: true });

    const written = await fs.promises.readFile(filePath, "utf-8");
    expect(written).toBe(originalContent);

    const logCalls = vi.mocked(logger.log).mock.calls.flat();
    expect(
      logCalls.some(
        (c) =>
          typeof c === "string" && c.includes("Skipped (no diff available for interactive review)"),
      ),
    ).toBe(true);
    expect(vi.mocked(logger.success)).not.toHaveBeenCalledWith("  1 file(s) modified");
  });

  it("should display the count of changed lines, not total file lines", async () => {
    await mockPromptConfirm(true);

    const filePath = path.join(tmpDir, "test.ts");
    const multiLineBefore = [
      "const a = 1;",
      "const b = 2;",
      "const c = 3;",
      "const d = 4;",
      "const e = 5;",
    ].join("\n");
    const multiLineAfter = [
      "const a = 1;",
      "const b = 999;",
      "const c = 3;",
      "const d = 4;",
      "const e = 5;",
    ].join("\n");
    await fs.promises.writeFile(filePath, multiLineBefore);

    vi.doMock("./rules", () => ({
      createDefaultRegistry: () => ({
        getApplicableRules: () => [
          {
            id: "test/line-count",
            name: "Line Count Rule",
            description: "Changes one line in a multi-line file",
            since: "1.0.0",
            until: "2.0.0",
            transform: async (_ctx: TransformContext): Promise<TransformResult> => {
              const content = await fs.promises.readFile(filePath, "utf-8");
              return {
                changed: true,
                filesModified: [filePath],
                warnings: [],
                diffs: [{ file: filePath, before: content, after: multiLineAfter }],
              };
            },
          },
        ],
      }),
    }));

    const { upgrade } = await import("./service");
    await upgrade({ to: "2.0.0", dryRun: false, path: tmpDir, interactive: true });

    const { logger } = await import("@/cli/shared/logger");
    const logCalls = vi.mocked(logger.log).mock.calls.flat();
    // Should show 1 changed line, not 5 (total file lines)
    expect(logCalls.some((c) => typeof c === "string" && c.includes("1 line(s) affected"))).toBe(
      true,
    );
    expect(logCalls.some((c) => typeof c === "string" && c.includes("5 line(s) affected"))).toBe(
      false,
    );
  });

  it("should fall back to dry-run when both dryRun and interactive are set", async () => {
    // dryRun takes precedence - no prompt should be shown
    const filePath = path.join(tmpDir, "test.ts");
    const originalContent = await fs.promises.readFile(filePath, "utf-8");

    vi.doMock("./rules", () => ({
      createDefaultRegistry: () => ({
        getApplicableRules: () => [
          createChangingRule("test/dryrun-priority", filePath, 'const x = "changed";'),
        ],
      }),
    }));

    const { prompt } = await import("@/cli/shared/prompt");
    vi.mocked(prompt.confirm).mockClear();

    const { upgrade } = await import("./service");
    await upgrade({ to: "2.0.0", dryRun: true, path: tmpDir, interactive: true });

    // File should not be modified (dry-run takes precedence)
    const written = await fs.promises.readFile(filePath, "utf-8");
    expect(written).toBe(originalContent);

    // prompt.confirm should not have been called (dry-run skips interactive prompt)
    expect(prompt.confirm).not.toHaveBeenCalled();
  });
});
