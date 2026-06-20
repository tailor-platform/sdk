import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { runCodemods } from "./runner";
import type { CodemodPackage } from "./types";

/**
 * Create a temporary directory with a test file for codemod testing.
 * @param fileName - Name of the test file
 * @param content - Content of the test file
 * @returns Object with tmpDir path and absolute file path
 */
async function createTestProject(
  fileName: string,
  content: string,
): Promise<{ tmpDir: string; filePath: string }> {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "runner-test-"));
  const filePath = path.join(tmpDir, fileName);
  await fs.promises.writeFile(filePath, content, "utf-8");
  return { tmpDir, filePath };
}

function makeCodemod(
  id: string,
  scriptPath?: string,
  filePatterns?: string[],
  legacyPatterns?: Array<string | string[]>,
  extra?: Pick<CodemodPackage, "suspiciousPatterns" | "prompt">,
): CodemodPackage {
  return {
    id,
    name: id,
    description: `Test codemod ${id}`,
    since: "1.0.0",
    until: "2.0.0",
    scriptPath,
    filePatterns,
    legacyPatterns,
    ...extra,
  };
}

describe("runCodemods", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    }
  });

  describe("chained transforms in dry-run", () => {
    // Transform A: renames "oldFunc" → "midFunc"
    const transformAPath = path.join(os.tmpdir(), "transform-a.ts");
    // Transform B: renames "midFunc" → "newFunc" (depends on A's output)
    const transformBPath = path.join(os.tmpdir(), "transform-b.ts");

    beforeEach(async () => {
      await fs.promises.writeFile(
        transformAPath,
        `export default function transformA(source) {
          if (!source.includes("oldFunc")) return null;
          return source.replace(/\\boldFunc\\b/g, "midFunc");
        }`,
        "utf-8",
      );
      await fs.promises.writeFile(
        transformBPath,
        `export default function transformB(source) {
          if (!source.includes("midFunc")) return null;
          return source.replace(/\\bmidFunc\\b/g, "newFunc");
        }`,
        "utf-8",
      );
    });

    afterEach(async () => {
      await fs.promises.rm(transformAPath, { force: true });
      await fs.promises.rm(transformBPath, { force: true });
    });

    test("should chain transforms so B sees A's output in dry-run", async () => {
      const { tmpDir: dir } = await createTestProject("test.ts", 'const oldFunc = "hello";');
      tmpDir = dir;

      // Suppress stderr (diff output) during test
      using _stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);

      const result = await runCodemods(
        [
          { codemod: makeCodemod("test/a", transformAPath), scriptPath: transformAPath },
          { codemod: makeCodemod("test/b", transformBPath), scriptPath: transformBPath },
        ],
        tmpDir,
        true, // dry-run
      );

      // Both transforms should have applied (B saw A's "midFunc" output)
      expect(result.changed).toBe(true);
      expect(result.filesModified).toHaveLength(1);

      // Original file should be unchanged (dry-run)
      const onDisk = await fs.promises.readFile(path.join(tmpDir, "test.ts"), "utf-8");
      expect(onDisk).toBe('const oldFunc = "hello";');
    });

    test("should produce diff showing final result (oldFunc → newFunc) in dry-run", async () => {
      const { tmpDir: dir } = await createTestProject("test.ts", 'const oldFunc = "hello";');
      tmpDir = dir;

      const stderrOutput: string[] = [];
      using _stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
        stderrOutput.push(String(chunk));
        return true;
      });

      await runCodemods(
        [
          { codemod: makeCodemod("test/a", transformAPath), scriptPath: transformAPath },
          { codemod: makeCodemod("test/b", transformBPath), scriptPath: transformBPath },
        ],
        tmpDir,
        true,
      );

      const output = stderrOutput.join("");
      // Diff should show oldFunc → newFunc (the chained result), NOT oldFunc → midFunc
      expect(output).toContain("-const oldFunc");
      expect(output).toContain("+const newFunc");
      expect(output).not.toContain("midFunc");
    });

    test("should write final chained result in non-dry-run", async () => {
      const { tmpDir: dir, filePath } = await createTestProject(
        "test.ts",
        'const oldFunc = "hello";',
      );
      tmpDir = dir;

      await runCodemods(
        [
          { codemod: makeCodemod("test/a", transformAPath), scriptPath: transformAPath },
          { codemod: makeCodemod("test/b", transformBPath), scriptPath: transformBPath },
        ],
        tmpDir,
        false, // actual run
      );

      const result = await fs.promises.readFile(filePath, "utf-8");
      expect(result).toBe('const newFunc = "hello";');
    });

    test("should skip transform B if A produces no match for B", async () => {
      const { tmpDir: dir } = await createTestProject("test.ts", 'const something = "hello";');
      tmpDir = dir;

      const result = await runCodemods(
        [
          { codemod: makeCodemod("test/a", transformAPath), scriptPath: transformAPath },
          { codemod: makeCodemod("test/b", transformBPath), scriptPath: transformBPath },
        ],
        tmpDir,
        true,
      );

      // Neither transform matches → no changes
      expect(result.changed).toBe(false);
      expect(result.filesModified).toHaveLength(0);
    });
  });

  describe("filePatterns filtering", () => {
    const transformPath = path.join(os.tmpdir(), "transform-upper.ts");
    const throwingTransformPath = path.join(os.tmpdir(), "transform-throw.ts");

    beforeEach(async () => {
      await fs.promises.writeFile(
        transformPath,
        `export default function transform(source) {
          return source.toUpperCase();
        }`,
        "utf-8",
      );
      await fs.promises.writeFile(
        throwingTransformPath,
        `export default function transform() {
          throw new Error("nonmatching transform should not run");
        }`,
        "utf-8",
      );
    });

    afterEach(async () => {
      await fs.promises.rm(transformPath, { force: true });
      await fs.promises.rm(throwingTransformPath, { force: true });
    });

    test("should only apply transform to files matching filePatterns", async () => {
      const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "runner-pattern-test-"));
      tmpDir = dir;
      await fs.promises.writeFile(path.join(dir, "config.ts"), "hello", "utf-8");
      await fs.promises.writeFile(path.join(dir, "data.json"), "world", "utf-8");
      using readFileSpy = vi.spyOn(fs.promises, "readFile");

      const result = await runCodemods(
        [
          {
            codemod: makeCodemod("test/upper", transformPath, ["**/*.json"]),
            scriptPath: transformPath,
          },
        ],
        dir,
        false,
      );

      // Only JSON file should be modified
      expect(result.filesModified).toHaveLength(1);
      expect(result.filesModified[0]).toContain("data.json");
      expect(readFileSpy).not.toHaveBeenCalledWith(path.join(dir, "config.ts"), "utf-8");

      // TS file should be unchanged
      const tsContent = await fs.promises.readFile(path.join(dir, "config.ts"), "utf-8");
      expect(tsContent).toBe("hello");

      // JSON file should be uppercased
      const jsonContent = await fs.promises.readFile(path.join(dir, "data.json"), "utf-8");
      expect(jsonContent).toBe("WORLD");
    });

    test("should not run transforms whose filePatterns do not match a matched file", async () => {
      const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "runner-pattern-test-"));
      tmpDir = dir;
      await fs.promises.writeFile(path.join(dir, "data.json"), "world", "utf-8");

      const result = await runCodemods(
        [
          {
            codemod: makeCodemod("test/upper", transformPath, ["**/*.json"]),
            scriptPath: transformPath,
          },
          {
            codemod: makeCodemod("test/throw", throwingTransformPath, ["**/*.ts"]),
            scriptPath: throwingTransformPath,
          },
        ],
        dir,
        false,
      );

      expect(result.filesModified).toEqual([path.join(dir, "data.json")]);
      await expect(fs.promises.readFile(path.join(dir, "data.json"), "utf-8")).resolves.toBe(
        "WORLD",
      );
    });

    test("should apply transforms to matching files under dot directories", async () => {
      const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "runner-dot-test-"));
      tmpDir = dir;
      const workflowPath = path.join(dir, ".github/workflows/test.yml");
      await fs.promises.mkdir(path.dirname(workflowPath), { recursive: true });
      await fs.promises.writeFile(workflowPath, "hello", "utf-8");

      const result = await runCodemods(
        [
          {
            codemod: makeCodemod("test/upper", transformPath, ["**/*.yml"]),
            scriptPath: transformPath,
          },
        ],
        dir,
        false,
      );

      expect(result.filesModified).toEqual([workflowPath]);
      await expect(fs.promises.readFile(workflowPath, "utf-8")).resolves.toBe("HELLO");
    });

    test("should skip unapproved tool dot directories", async () => {
      const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "runner-dot-test-"));
      tmpDir = dir;
      const workflowPath = path.join(dir, ".github/workflows/test.yml");
      const agentPackagePath = path.join(dir, ".agent/worktrees/demo/package.json");
      const nextYamlPath = path.join(dir, ".next/cache/workflow.yml");
      await fs.promises.mkdir(path.dirname(workflowPath), { recursive: true });
      await fs.promises.mkdir(path.dirname(agentPackagePath), { recursive: true });
      await fs.promises.mkdir(path.dirname(nextYamlPath), { recursive: true });
      await fs.promises.writeFile(workflowPath, "hello", "utf-8");
      await fs.promises.writeFile(
        agentPackagePath,
        '{"scripts":{"deploy":"tailor-sdk apply"}}',
        "utf-8",
      );
      await fs.promises.writeFile(nextYamlPath, "hello", "utf-8");

      const result = await runCodemods(
        [
          {
            codemod: makeCodemod("test/upper", transformPath, ["**/*.yml", "**/package.json"]),
            scriptPath: transformPath,
          },
        ],
        dir,
        false,
      );

      expect(result.filesModified).toEqual([workflowPath]);
      await expect(fs.promises.readFile(workflowPath, "utf-8")).resolves.toBe("HELLO");
      await expect(fs.promises.readFile(agentPackagePath, "utf-8")).resolves.toBe(
        '{"scripts":{"deploy":"tailor-sdk apply"}}',
      );
      await expect(fs.promises.readFile(nextYamlPath, "utf-8")).resolves.toBe("hello");
    });
  });

  describe("legacy pattern warnings", () => {
    const partialTransformPath = path.join(os.tmpdir(), "transform-partial.ts");

    beforeEach(async () => {
      await fs.promises.writeFile(
        partialTransformPath,
        `export default function transform(source) {
          return source.replaceAll("tailor-sdk crash-report", "tailor-sdk crashreport");
        }`,
        "utf-8",
      );
    });

    afterEach(async () => {
      await fs.promises.rm(partialTransformPath, { force: true });
    });

    test("warns when legacy patterns remain after a partial migration", async () => {
      const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "runner-warning-test-"));
      tmpDir = dir;
      await fs.promises.writeFile(
        path.join(dir, "README.md"),
        "Run `tailor-sdk crash-report list`.\nRun tailor-sdk login --machineuser.\n",
        "utf-8",
      );

      using _stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);

      const result = await runCodemods(
        [
          {
            codemod: makeCodemod(
              "test/partial",
              partialTransformPath,
              ["**/*.md"],
              ["tailor-sdk crash-report", "--machineuser"],
            ),
            scriptPath: partialTransformPath,
          },
        ],
        dir,
        true,
      );

      expect(result.filesModified).toEqual([path.join(dir, "README.md")]);
      expect(result.warnings).toEqual([
        "README.md: contains --machineuser but was not migrated automatically (rule: test/partial). Manual migration may be needed.",
      ]);
    });

    test("ignores source comments, strings, and identifier substrings for legacy warnings", async () => {
      const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "runner-warning-source-test-"));
      tmpDir = dir;
      await fs.promises.writeFile(
        path.join(dir, "createContext.ts"),
        [
          "// Matches SDK's unauthenticatedTailorUser.id",
          'const note = "TailorUser";',
          "const unauthenticatedTailorUserId = caller?.id;",
        ].join("\n"),
        "utf-8",
      );

      const result = await runCodemods(
        [
          {
            codemod: makeCodemod(
              "test/principal",
              partialTransformPath,
              ["**/*.ts"],
              ["TailorUser", "unauthenticatedTailorUser"],
            ),
            scriptPath: partialTransformPath,
          },
        ],
        dir,
        true,
      );

      expect(result.warnings).toEqual([]);
    });

    test("keeps legacy warnings for source identifiers", async () => {
      const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "runner-warning-source-test-"));
      tmpDir = dir;
      await fs.promises.writeFile(
        path.join(dir, "resolver.ts"),
        [
          'import type { TailorUser } from "@tailor-platform/sdk";',
          "const fallback = unauthenticatedTailorUser;",
        ].join("\n"),
        "utf-8",
      );

      const result = await runCodemods(
        [
          {
            codemod: makeCodemod(
              "test/principal",
              partialTransformPath,
              ["**/*.ts"],
              ["TailorUser", "unauthenticatedTailorUser"],
            ),
            scriptPath: partialTransformPath,
          },
        ],
        dir,
        true,
      );

      expect(result.warnings).toEqual([
        "resolver.ts: contains TailorUser, unauthenticatedTailorUser but was not migrated automatically (rule: test/principal). Manual migration may be needed.",
      ]);
    });

    test("flags files matching a suspicious pattern for LLM review", async () => {
      const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "runner-llm-test-"));
      tmpDir = dir;
      await fs.promises.writeFile(path.join(dir, "a.ts"), "executeScript({ arg: payload });\n");
      await fs.promises.writeFile(path.join(dir, "b.ts"), "const x = 1;\n");

      const result = await runCodemods(
        [
          {
            codemod: makeCodemod("test/llm", partialTransformPath, ["**/*.ts"], undefined, {
              suspiciousPatterns: ["executeScript"],
              prompt: "Rewrite remaining executeScript usages by hand.",
            }),
            scriptPath: partialTransformPath,
          },
        ],
        dir,
        true,
      );

      expect(result.llmReviews).toEqual([
        {
          codemodId: "test/llm",
          prompt: "Rewrite remaining executeScript usages by hand.",
          files: ["a.ts"],
        },
      ]);
    });

    test("does not flag for LLM review without a prompt", async () => {
      const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "runner-llm-noprompt-test-"));
      tmpDir = dir;
      await fs.promises.writeFile(path.join(dir, "a.ts"), "executeScript({ arg: payload });\n");

      const result = await runCodemods(
        [
          {
            codemod: makeCodemod("test/llm", partialTransformPath, ["**/*.ts"], undefined, {
              suspiciousPatterns: ["executeScript"],
            }),
            scriptPath: partialTransformPath,
          },
        ],
        dir,
        true,
      );

      expect(result.llmReviews).toEqual([]);
    });

    test("ignores source comments and strings for LLM review patterns", async () => {
      const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "runner-llm-source-test-"));
      tmpDir = dir;
      await fs.promises.writeFile(
        path.join(dir, "a.ts"),
        [
          "// executeScript({ arg: payload });",
          'const name = "executeScript";',
          "const template = `executeScript`;",
        ].join("\n"),
      );

      const result = await runCodemods(
        [
          {
            codemod: makeCodemod("test/llm", partialTransformPath, ["**/*.ts"], undefined, {
              suspiciousPatterns: ["executeScript"],
              prompt: "Rewrite remaining executeScript usages by hand.",
            }),
            scriptPath: partialTransformPath,
          },
        ],
        dir,
        true,
      );

      expect(result.llmReviews).toEqual([]);
    });

    test("keeps LLM review patterns inside template substitutions", async () => {
      const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "runner-llm-source-test-"));
      tmpDir = dir;
      await fs.promises.writeFile(
        path.join(dir, "a.ts"),
        "const message = `${executeScript({ arg: payload })}`;\n",
      );

      const result = await runCodemods(
        [
          {
            codemod: makeCodemod("test/llm", partialTransformPath, ["**/*.ts"], undefined, {
              suspiciousPatterns: ["executeScript"],
              prompt: "Rewrite remaining executeScript usages by hand.",
            }),
            scriptPath: partialTransformPath,
          },
        ],
        dir,
        true,
      );

      expect(result.llmReviews).toEqual([
        {
          codemodId: "test/llm",
          prompt: "Rewrite remaining executeScript usages by hand.",
          files: ["a.ts"],
        },
      ]);
    });

    test("keeps LLM review patterns after nested template substitutions", async () => {
      const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "runner-llm-source-test-"));
      tmpDir = dir;
      await fs.promises.writeFile(
        path.join(dir, "a.ts"),
        "const message = `${`prefix ${foo}`.toString(executeScript())}`;\n",
      );

      const result = await runCodemods(
        [
          {
            codemod: makeCodemod("test/llm", partialTransformPath, ["**/*.ts"], undefined, {
              suspiciousPatterns: ["executeScript"],
              prompt: "Rewrite remaining executeScript usages by hand.",
            }),
            scriptPath: partialTransformPath,
          },
        ],
        dir,
        true,
      );

      expect(result.llmReviews).toEqual([
        {
          codemodId: "test/llm",
          prompt: "Rewrite remaining executeScript usages by hand.",
          files: ["a.ts"],
        },
      ]);
    });

    test("keeps LLM review patterns after regex literals with escaped slashes", async () => {
      const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "runner-llm-source-test-"));
      tmpDir = dir;
      await fs.promises.writeFile(
        path.join(dir, "a.ts"),
        "const re = /https?:\\/\\//; executeScript({ arg: payload });\n",
      );

      const result = await runCodemods(
        [
          {
            codemod: makeCodemod("test/llm", partialTransformPath, ["**/*.ts"], undefined, {
              suspiciousPatterns: ["executeScript"],
              prompt: "Rewrite remaining executeScript usages by hand.",
            }),
            scriptPath: partialTransformPath,
          },
        ],
        dir,
        true,
      );

      expect(result.llmReviews).toEqual([
        {
          codemodId: "test/llm",
          prompt: "Rewrite remaining executeScript usages by hand.",
          files: ["a.ts"],
        },
      ]);
    });

    test("emits a blanket LLM review for a codemod-less manual entry", async () => {
      const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "runner-manual-test-"));
      tmpDir = dir;
      await fs.promises.writeFile(path.join(dir, "a.ts"), "const x = 1;\n");

      const result = await runCodemods(
        [
          {
            codemod: makeCodemod("test/manual", undefined, ["**/*.ts"], undefined, {
              prompt: "Do the manual change.",
            }),
            scriptPath: undefined,
          },
        ],
        dir,
        true,
      );

      expect(result.changed).toBe(false);
      expect(result.llmReviews).toEqual([
        { codemodId: "test/manual", prompt: "Do the manual change.", files: [] },
      ]);
    });

    test("does not emit a blanket review for a legacy-pattern entry with a prompt", async () => {
      const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "runner-legacy-prompt-test-"));
      tmpDir = dir;
      await fs.promises.writeFile(path.join(dir, "a.ts"), "const x = 1;\n");

      const result = await runCodemods(
        [
          {
            codemod: makeCodemod("test/legacy", partialTransformPath, ["**/*.ts"], ["needle"], {
              prompt: "Finish the residual.",
            }),
            scriptPath: partialTransformPath,
          },
        ],
        dir,
        true,
      );

      // legacy-pattern entries surface via warnings, not a blanket llmReview.
      expect(result.llmReviews).toEqual([]);
    });

    test("AND-group legacy pattern warns only when every substring co-occurs", async () => {
      const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "runner-and-group-test-"));
      tmpDir = dir;
      await fs.promises.writeFile(
        path.join(dir, "both.ts"),
        "executeScript({ arg: payload });\nconst s = JSON.stringify(x);\n",
        "utf-8",
      );
      await fs.promises.writeFile(
        path.join(dir, "only-stringify.ts"),
        "const s = JSON.stringify(x);\n",
        "utf-8",
      );

      const result = await runCodemods(
        [
          {
            codemod: makeCodemod(
              "test/and-group",
              partialTransformPath,
              ["**/*.ts"],
              [["executeScript", "JSON.stringify"]],
            ),
            scriptPath: partialTransformPath,
          },
        ],
        dir,
        true,
      );

      expect(result.warnings).toEqual([
        "both.ts: contains executeScript + JSON.stringify but was not migrated automatically (rule: test/and-group). Manual migration may be needed.",
      ]);
    });

    test("flags files matching a suspicious pattern for LLM review", async () => {
      const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "runner-llm-test-"));
      tmpDir = dir;
      await fs.promises.writeFile(path.join(dir, "a.ts"), "executeScript({ arg: payload });\n");
      await fs.promises.writeFile(path.join(dir, "b.ts"), "const x = 1;\n");

      const result = await runCodemods(
        [
          {
            codemod: makeCodemod("test/llm", partialTransformPath, ["**/*.ts"], undefined, {
              suspiciousPatterns: ["executeScript"],
              prompt: "Rewrite remaining executeScript usages by hand.",
            }),
            scriptPath: partialTransformPath,
          },
        ],
        dir,
        true,
      );

      expect(result.llmReviews).toEqual([
        {
          codemodId: "test/llm",
          prompt: "Rewrite remaining executeScript usages by hand.",
          files: ["a.ts"],
        },
      ]);
    });

    test("does not flag for LLM review without a prompt", async () => {
      const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "runner-llm-noprompt-test-"));
      tmpDir = dir;
      await fs.promises.writeFile(path.join(dir, "a.ts"), "executeScript({ arg: payload });\n");

      const result = await runCodemods(
        [
          {
            codemod: makeCodemod("test/llm", partialTransformPath, ["**/*.ts"], undefined, {
              suspiciousPatterns: ["executeScript"],
            }),
            scriptPath: partialTransformPath,
          },
        ],
        dir,
        true,
      );

      expect(result.llmReviews).toEqual([]);
    });
  });
});
