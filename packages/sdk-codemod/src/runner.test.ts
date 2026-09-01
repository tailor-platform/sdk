import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { allCodemods } from "./registry";
import { runCodemods } from "./runner";
import type { CodemodPackage } from "./types";

type TestCodemodExtra = Pick<
  CodemodPackage,
  | "sourceStringLegacyPatterns"
  | "sourceTextLegacyPatterns"
  | "suspiciousPatterns"
  | "sourceStringSuspiciousPatterns"
  | "prompt"
  | "reviewSupersededBy"
>;

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
  extra?: TestCodemodExtra,
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

  aroundEach(async (runTest) => {
    await runTest();
    if (tmpDir) {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    }
  });

  describe("chained transforms in dry-run", () => {
    // Transform A: renames "oldFunc" → "midFunc"
    const transformAPath = path.join(os.tmpdir(), "transform-a.ts");
    // Transform B: renames "midFunc" → "newFunc" (depends on A's output)
    const transformBPath = path.join(os.tmpdir(), "transform-b.ts");

    aroundEach(async (runTest) => {
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
      await runTest();
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

  describe("review detection across chained transforms", () => {
    const detectLegacyKeyPath = path.join(os.tmpdir(), "transform-detect-legacy-key.ts");
    const detectNewKeyPath = path.join(os.tmpdir(), "transform-detect-new-key.ts");
    const renameLegacyKeyPath = path.join(os.tmpdir(), "transform-rename-legacy-key.ts");
    const selfFixLegacyKeyPath = path.join(os.tmpdir(), "transform-self-fix-legacy-key.ts");

    function detectorScript(key: string): string {
      return `export default function transform() {
          return null;
        }
        export function reviewFindings(source, _filePath, relativePath) {
          return source.split("\\n").flatMap((lineText, index) =>
            lineText.includes("${key}:")
              ? [{
                  file: relativePath,
                  line: index + 1,
                  message: "Review ${key} usage.",
                  excerpt: lineText.trim(),
                }]
              : [],
          );
        }`;
    }

    aroundEach(async (runTest) => {
      await fs.promises.writeFile(detectLegacyKeyPath, detectorScript("legacyKey"), "utf-8");
      await fs.promises.writeFile(detectNewKeyPath, detectorScript("newKey"), "utf-8");
      await fs.promises.writeFile(
        renameLegacyKeyPath,
        `export default function transform(source) {
          if (!source.includes("legacyKey:")) return null;
          return source.replaceAll("legacyKey:", "newKey:");
        }`,
        "utf-8",
      );
      await fs.promises.writeFile(
        selfFixLegacyKeyPath,
        `export default function transform(source) {
          if (!source.includes("legacyKey:")) return null;
          return source.replaceAll("legacyKey:", "newKey:");
        }
        export function reviewFindings(source, _filePath, relativePath) {
          return source.includes("legacyKey:")
            ? [{ file: relativePath, line: 1, message: "Review legacyKey usage.", excerpt: "legacyKey" }]
            : [];
        }`,
        "utf-8",
      );
      await runTest();
      await fs.promises.rm(detectLegacyKeyPath, { force: true });
      await fs.promises.rm(detectNewKeyPath, { force: true });
      await fs.promises.rm(renameLegacyKeyPath, { force: true });
      await fs.promises.rm(selfFixLegacyKeyPath, { force: true });
    });

    test("keeps an earlier detector's findings when a later transform rewrites the key", async () => {
      const { tmpDir: dir } = await createTestProject(
        "model.ts",
        'const config = { legacyKey: "user" };\n',
      );
      tmpDir = dir;

      const result = await runCodemods(
        [
          {
            codemod: makeCodemod("test/detect", detectLegacyKeyPath, ["**/*.ts"], undefined, {
              prompt: "Review remaining legacyKey usages.",
            }),
            scriptPath: detectLegacyKeyPath,
          },
          {
            codemod: makeCodemod("test/rename", renameLegacyKeyPath, ["**/*.ts"]),
            scriptPath: renameLegacyKeyPath,
          },
        ],
        dir,
        false,
      );

      const onDisk = await fs.promises.readFile(path.join(dir, "model.ts"), "utf-8");
      expect(onDisk).toBe('const config = { newKey: "user" };\n');
      expect(result.llmReviews).toEqual([
        {
          codemodId: "test/detect",
          prompt: "Review remaining legacyKey usages.",
          files: ["model.ts"],
          findings: [
            {
              file: "model.ts",
              line: 1,
              message: "Review legacyKey usage.",
              excerpt: 'const config = { legacyKey: "user" };',
            },
          ],
        },
      ]);
    });

    test("keeps an earlier suspicious-pattern match when a later transform rewrites the key", async () => {
      const { tmpDir: dir } = await createTestProject(
        "model.ts",
        "const config = { legacyKey: value };\n",
      );
      tmpDir = dir;

      const result = await runCodemods(
        [
          {
            codemod: makeCodemod("test/suspicious", undefined, ["**/*.ts"], undefined, {
              suspiciousPatterns: ["legacyKey"],
              prompt: "Review remaining legacyKey usages.",
            }),
          },
          {
            codemod: makeCodemod("test/rename", renameLegacyKeyPath, ["**/*.ts"]),
            scriptPath: renameLegacyKeyPath,
          },
        ],
        dir,
        false,
      );

      expect(result.llmReviews).toEqual([
        {
          codemodId: "test/suspicious",
          prompt: "Review remaining legacyKey usages.",
          files: ["model.ts"],
        },
      ]);
    });

    test("remaps finding lines to the final file when a later transform shifts lines", async () => {
      const prependLinesPath = path.join(os.tmpdir(), "transform-prepend-lines.ts");
      await fs.promises.writeFile(
        prependLinesPath,
        `export default function transform(source) {
          if (!source.includes("legacyKey:")) return null;
          return "const inserted = 1;\\nconst inserted2 = 2;\\n" + source;
        }`,
        "utf-8",
      );
      try {
        const { tmpDir: dir } = await createTestProject(
          "model.ts",
          'const config = { legacyKey: "user" };\n',
        );
        tmpDir = dir;

        const result = await runCodemods(
          [
            {
              codemod: makeCodemod("test/detect", detectLegacyKeyPath, ["**/*.ts"], undefined, {
                prompt: "Review remaining legacyKey usages.",
              }),
              scriptPath: detectLegacyKeyPath,
            },
            {
              codemod: makeCodemod("test/prepend", prependLinesPath, ["**/*.ts"]),
              scriptPath: prependLinesPath,
            },
          ],
          dir,
          false,
        );

        expect(result.llmReviews).toEqual([
          expect.objectContaining({
            codemodId: "test/detect",
            findings: [
              {
                file: "model.ts",
                line: 3,
                message: "Review legacyKey usage.",
                excerpt: 'const config = { legacyKey: "user" };',
              },
            ],
          }),
        ]);
      } finally {
        await fs.promises.rm(prependLinesPath, { force: true });
      }
    });

    test("keeps a finding's relative position inside a multi-line rewrite hunk", async () => {
      const rewriteBlockPath = path.join(os.tmpdir(), "transform-rewrite-block.ts");
      await fs.promises.writeFile(
        rewriteBlockPath,
        `export default function transform(source) {
          if (!source.includes("legacyKey:")) return null;
          return source.replaceAll('"x"', '"y"').replaceAll("legacyKey:", "newKey:");
        }`,
        "utf-8",
      );
      try {
        const { tmpDir: dir } = await createTestProject(
          "model.ts",
          [
            "const a = 1;",
            'const pad1 = "x";',
            'const config = { legacyKey: "user" };',
            'const pad2 = "x";',
            "const b = 2;",
            "",
          ].join("\n"),
        );
        tmpDir = dir;

        const result = await runCodemods(
          [
            {
              codemod: makeCodemod("test/detect", detectLegacyKeyPath, ["**/*.ts"], undefined, {
                prompt: "Review remaining legacyKey usages.",
              }),
              scriptPath: detectLegacyKeyPath,
            },
            {
              codemod: makeCodemod("test/rewrite-block", rewriteBlockPath, ["**/*.ts"]),
              scriptPath: rewriteBlockPath,
            },
          ],
          dir,
          false,
        );

        expect(result.llmReviews).toEqual([
          expect.objectContaining({
            codemodId: "test/detect",
            findings: [
              expect.objectContaining({
                file: "model.ts",
                line: 3,
              }),
            ],
          }),
        ]);
      } finally {
        await fs.promises.rm(rewriteBlockPath, { force: true });
      }
    });

    test("clamps a remapped finding line when a later transform deletes trailing lines", async () => {
      const deleteKeyLinePath = path.join(os.tmpdir(), "transform-delete-key-line.ts");
      await fs.promises.writeFile(
        deleteKeyLinePath,
        `export default function transform(source) {
          if (!source.includes("legacyKey:")) return null;
          return source
            .split("\\n")
            .filter((lineText) => !lineText.includes("legacyKey:"))
            .join("\\n");
        }`,
        "utf-8",
      );
      try {
        const { tmpDir: dir } = await createTestProject(
          "model.ts",
          'const a = 1;\nconst config = { legacyKey: "user" };\n',
        );
        tmpDir = dir;

        const result = await runCodemods(
          [
            {
              codemod: makeCodemod("test/detect", detectLegacyKeyPath, ["**/*.ts"], undefined, {
                prompt: "Review remaining legacyKey usages.",
              }),
              scriptPath: detectLegacyKeyPath,
            },
            {
              codemod: makeCodemod("test/delete-line", deleteKeyLinePath, ["**/*.ts"]),
              scriptPath: deleteKeyLinePath,
            },
          ],
          dir,
          false,
        );

        expect(result.llmReviews).toEqual([
          expect.objectContaining({
            codemodId: "test/detect",
            findings: [
              expect.objectContaining({
                file: "model.ts",
                line: 1,
              }),
            ],
          }),
        ]);
      } finally {
        await fs.promises.rm(deleteKeyLinePath, { force: true });
      }
    });

    test("runs a codemod's detector on its own transform's output", async () => {
      const { tmpDir: dir } = await createTestProject(
        "model.ts",
        'const config = { legacyKey: "user" };\n',
      );
      tmpDir = dir;

      const result = await runCodemods(
        [
          {
            codemod: makeCodemod("test/self-fix", selfFixLegacyKeyPath, ["**/*.ts"], undefined, {
              prompt: "Review remaining legacyKey usages.",
            }),
            scriptPath: selfFixLegacyKeyPath,
          },
        ],
        dir,
        false,
      );

      expect(result.llmReviews).toEqual([]);
    });

    test("runs a later detector on earlier transforms' output", async () => {
      const { tmpDir: dir } = await createTestProject(
        "model.ts",
        'const config = { legacyKey: "user" };\n',
      );
      tmpDir = dir;

      const result = await runCodemods(
        [
          {
            codemod: makeCodemod("test/rename", renameLegacyKeyPath, ["**/*.ts"]),
            scriptPath: renameLegacyKeyPath,
          },
          {
            codemod: makeCodemod("test/detect-new", detectNewKeyPath, ["**/*.ts"], undefined, {
              prompt: "Review remaining newKey usages.",
            }),
            scriptPath: detectNewKeyPath,
          },
        ],
        dir,
        false,
      );

      expect(result.llmReviews).toEqual([
        {
          codemodId: "test/detect-new",
          prompt: "Review remaining newKey usages.",
          files: ["model.ts"],
          findings: [
            {
              file: "model.ts",
              line: 1,
              message: "Review newKey usage.",
              excerpt: 'const config = { newKey: "user" };',
            },
          ],
        },
      ]);
    });
  });

  describe("filePatterns filtering", () => {
    const transformPath = path.join(os.tmpdir(), "transform-upper.ts");
    const throwingTransformPath = path.join(os.tmpdir(), "transform-throw.ts");

    aroundEach(async (runTest) => {
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
      await runTest();
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
        '{"scripts":{"deploy":"tailor apply"}}',
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
        '{"scripts":{"deploy":"tailor apply"}}',
      );
      await expect(fs.promises.readFile(nextYamlPath, "utf-8")).resolves.toBe("hello");
    });
  });

  describe("legacy pattern warnings", () => {
    const partialTransformPath = path.join(os.tmpdir(), "transform-partial.ts");
    const renameBin = allCodemods.find((codemod) => codemod.id === "v2/rename-bin");
    if (!renameBin) throw new Error("rename-bin codemod missing");

    async function runWarningCase({
      fileName,
      source,
      codemod,
    }: {
      fileName: string;
      source: string;
      codemod: CodemodPackage;
    }) {
      const { tmpDir: dir } = await createTestProject(fileName, source);
      tmpDir = dir;
      const result = await runCodemods([{ codemod, scriptPath: codemod.scriptPath }], dir, true);
      return { dir, result };
    }

    aroundEach(async (runTest) => {
      await fs.promises.writeFile(
        partialTransformPath,
        `export default function transform(source) {
          return source.replaceAll("tailor crash-report", "tailor crashreport");
        }`,
        "utf-8",
      );
      await runTest();
      await fs.promises.rm(partialTransformPath, { force: true });
    });

    test("warns when legacy patterns remain after a partial migration", async () => {
      using _stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);

      const { dir, result } = await runWarningCase({
        fileName: "README.md",
        source: "Run `tailor crash-report list`.\nRun tailor login --machineuser.\n",
        codemod: makeCodemod(
          "test/partial",
          partialTransformPath,
          ["**/*.md"],
          ["tailor crash-report", "--machineuser"],
        ),
      });

      expect(result.filesModified).toEqual([path.join(dir, "README.md")]);
      expect(result.warnings).toEqual([
        "README.md: contains --machineuser but was not migrated automatically (rule: test/partial). Manual migration may be needed.",
      ]);
    });

    test("ignores source comments, strings, and identifier substrings for legacy warnings", async () => {
      const { result } = await runWarningCase({
        fileName: "createContext.ts",
        source: [
          "// Matches SDK's unauthenticatedTailorUser.id",
          'const note = "TailorUser";',
          "const unauthenticatedTailorUserId = caller?.id;",
        ].join("\n"),
        codemod: makeCodemod(
          "test/principal",
          partialTransformPath,
          ["**/*.ts"],
          ["TailorUser", "unauthenticatedTailorUser"],
        ),
      });

      expect(result.warnings).toEqual([]);
    });

    test("ignores JSX text for legacy warnings in JavaScript files", async () => {
      const { result } = await runWarningCase({
        fileName: "docs.js",
        source: "export const docs = <p>package tailor-sdk is installed</p>;",
        codemod: makeCodemod("test/rename-bin", undefined, ["**/*.js"], ["tailor-sdk"]),
      });

      expect(result.warnings).toEqual([]);
    });

    test("keeps legacy warnings for source identifiers", async () => {
      const { result } = await runWarningCase({
        fileName: "resolver.ts",
        source: [
          'import type { TailorUser } from "@tailor-platform/sdk";',
          "const fallback = unauthenticatedTailorUser;",
        ].join("\n"),
        codemod: makeCodemod(
          "test/principal",
          partialTransformPath,
          ["**/*.ts"],
          ["TailorUser", "unauthenticatedTailorUser"],
        ),
      });

      expect(result.warnings).toEqual([
        "resolver.ts: contains TailorUser, unauthenticatedTailorUser but was not migrated automatically (rule: test/principal). Manual migration may be needed.",
      ]);
    });

    test("keeps legacy warnings for process.env bracket keys in source files", async () => {
      const { result } = await runWarningCase({
        fileName: "env.ts",
        source: [
          'const platformUrl = process.env["PLATFORM_URL"];',
          "const logLevel = process.env[`LOG_LEVEL`];",
          'const unrelated = "LOG_LEVEL";',
        ].join("\n"),
        codemod: makeCodemod(
          "test/env",
          partialTransformPath,
          ["**/*.ts"],
          ["PLATFORM_URL", "LOG_LEVEL"],
        ),
      });

      expect(result.warnings).toEqual([
        "env.ts: contains PLATFORM_URL, LOG_LEVEL but was not migrated automatically (rule: test/env). Manual migration may be needed.",
      ]);
    });

    test("keeps opt-in legacy warnings for source string fragments", async () => {
      const { result } = await runWarningCase({
        fileName: "env.ts",
        source: [
          'import { execSync } from "node:child_process";',
          'execSync("PLATFORM_URL=https://api.test LOG_LEVEL=DEBUG tailor-sdk login");',
          "// PLATFORM_URL in a comment stays ignored.",
        ].join("\n"),
        codemod: makeCodemod("test/env", partialTransformPath, ["**/*.ts"], [], {
          sourceStringLegacyPatterns: ["PLATFORM_URL", "LOG_LEVEL"],
        }),
      });

      expect(result.warnings).toEqual([
        "env.ts: contains PLATFORM_URL, LOG_LEVEL but was not migrated automatically (rule: test/env). Manual migration may be needed.",
      ]);
    });

    test("keeps source string residual checks inside each literal", async () => {
      const { result } = await runWarningCase({
        fileName: "commands.ts",
        source: [
          'const packageName = "tailor-sdk";',
          'const command = "deploy";',
          'spawn("tailor", ["--arg", "tailor-sdk deploy", "deploy"]);',
          'spawn("npx", ["@tailor-platform/sdk", "--arg", "tailor-sdk deploy", "deploy"]);',
        ].join("\n"),
        codemod: makeCodemod("test/rename-bin", partialTransformPath, ["**/*.ts"], [], {
          sourceStringLegacyPatterns: [/tailor-sdk(?=\s+deploy)/],
        }),
      });

      expect(result.warnings).toEqual([]);
    });

    test("keeps generic source string residual checks out of comments", async () => {
      const { result } = await runWarningCase({
        fileName: "env.ts",
        source: "// PLATFORM_URL is documented here\nconst value = 1;",
        codemod: makeCodemod("test/env", partialTransformPath, ["**/*.ts"], [], {
          sourceStringLegacyPatterns: ["PLATFORM_URL"],
        }),
      });

      expect(result.warnings).toEqual([]);
    });

    test("keeps escaped quoted Tailor values out of rename-bin residual warnings", async () => {
      const { result } = await runWarningCase({
        fileName: "commands.ts",
        source: 'const command = "tailor --arg \\"tailor-sdk deploy\\" deploy";',
        codemod: makeCodemod("test/rename-bin", partialTransformPath, ["**/*.ts"], [], {
          sourceStringLegacyPatterns: renameBin.sourceStringLegacyPatterns,
        }),
      });

      expect(result.warnings).toEqual([]);
    });

    test("keeps split Tailor option values out of rename-bin residual warnings", async () => {
      const { result } = await runWarningCase({
        fileName: "commands.ts",
        source:
          'spawn("tailor", ["tailordb", "migration", "generate", "--name", "tailor-sdk deploy"]);',
        codemod: makeCodemod("test/rename-bin", partialTransformPath, ["**/*.ts"], [], {
          sourceStringLegacyPatterns: renameBin.sourceStringLegacyPatterns,
        }),
      });

      expect(result.warnings).toEqual([]);
    });

    test("keeps shim and path Tailor option values out of rename-bin residual warnings", async () => {
      const { result } = await runWarningCase({
        fileName: "commands.ts",
        source: [
          'spawn("tailor.cmd", ["--arg", "tailor-sdk deploy", "deploy"]);',
          'spawn("./node_modules/.bin/tailor", ["--arg", "tailor-sdk deploy", "deploy"]);',
        ].join("\n"),
        codemod: makeCodemod("test/rename-bin", partialTransformPath, ["**/*.ts"], [], {
          sourceStringLegacyPatterns: renameBin.sourceStringLegacyPatterns,
        }),
      });

      expect(result.warnings).toEqual([]);
    });

    test("warns for split argv rename-bin residuals", async () => {
      const { result } = await runWarningCase({
        fileName: "commands.ts",
        source: [
          'spawn("tailor-sdk", ["apply"]);',
          'spawn("tailor-sdk", ["crash-report", "list"]);',
          'spawn("npx", ["-p", "@tailor-platform/sdk", "tailor-sdk", "crash-report"]);',
        ].join("\n"),
        codemod: makeCodemod("test/rename-bin", partialTransformPath, ["**/*.ts"], [], {
          sourceStringLegacyPatterns: renameBin.sourceStringLegacyPatterns,
        }),
      });

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("commands.ts: contains");
      expect(result.warnings[0]).toContain("rule: test/rename-bin");
    });

    test("warns for variable-backed rename-bin source residuals", async () => {
      const { result } = await runWarningCase({
        fileName: "commands.ts",
        source: ['const bin = "tailor-sdk";', 'spawn(bin, ["deploy"]);'].join("\n"),
        codemod: makeCodemod("test/rename-bin", partialTransformPath, ["**/*.ts"], [], {
          sourceStringLegacyPatterns: renameBin.sourceStringLegacyPatterns,
        }),
      });

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("commands.ts: contains");
      expect(result.warnings[0]).toContain("rule: test/rename-bin");
    });

    test("warns for source comment and JSX rename-bin residuals", async () => {
      const { result } = await runWarningCase({
        fileName: "commands.tsx",
        source: [
          "// tailor-sdk apply",
          "const docs = <code>tailor-sdk crash-report list</code>;",
        ].join("\n"),
        codemod: makeCodemod("test/rename-bin", partialTransformPath, ["**/*.tsx"], [], {
          sourceTextLegacyPatterns: renameBin.sourceTextLegacyPatterns,
        }),
      });

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("commands.tsx: contains");
      expect(result.warnings[0]).toContain("rule: test/rename-bin");
    });

    test("warns for quoted shell rename-bin residuals", async () => {
      const { result } = await runWarningCase({
        fileName: "commands.ts",
        source: [
          'const note = "unrelated";',
          "const command = 'bash -lc \"tailor-sdk crash-report list\"';",
        ].join("\n"),
        codemod: makeCodemod("test/rename-bin", partialTransformPath, ["**/*.ts"], [], {
          sourceStringLegacyPatterns: renameBin.sourceStringLegacyPatterns,
        }),
      });

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("commands.ts: contains");
      expect(result.warnings[0]).toContain("rule: test/rename-bin");
    });

    test("warns for quoted legacy CLI residuals", async () => {
      const { result } = await runWarningCase({
        fileName: "commands.ts",
        source: "const message = 'Run \"tailor-sdk crash-report list\" manually';",
        codemod: makeCodemod("test/rename-bin", partialTransformPath, ["**/*.ts"], [], {
          sourceStringLegacyPatterns: renameBin.sourceStringLegacyPatterns,
        }),
      });

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("commands.ts: contains");
      expect(result.warnings[0]).toContain("rule: test/rename-bin");
    });

    test("warns for source command residuals with shadowed aliases", async () => {
      const { result } = await runWarningCase({
        fileName: "commands.ts",
        source: [
          'const bin = "tailor-sdk";',
          'spawn(bin, ["apply"]);',
          "function shadow() {",
          '  const bin = "tailor";',
          "  return bin;",
          "}",
        ].join("\n"),
        codemod: makeCodemod("test/rename-bin", partialTransformPath, ["**/*.ts"], [], {
          sourceStringLegacyPatterns: renameBin.sourceStringLegacyPatterns,
        }),
      });

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("commands.ts: contains");
      expect(result.warnings[0]).toContain("rule: test/rename-bin");
    });

    test("warns for source command residuals before later fragments", async () => {
      const { result } = await runWarningCase({
        fileName: "commands.ts",
        source: [
          "const command = `${runner} tailor-sdk ${subcommand}`;",
          'const later = "deploy";',
        ].join("\n"),
        codemod: makeCodemod("test/rename-bin", partialTransformPath, ["**/*.ts"], [], {
          sourceStringLegacyPatterns: renameBin.sourceStringLegacyPatterns,
        }),
      });

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("commands.ts: contains");
      expect(result.warnings[0]).toContain("rule: test/rename-bin");
    });

    test("keeps multiple-spaced Tailor option values out of rename-bin residual warnings", async () => {
      const { result } = await runWarningCase({
        fileName: "commands.ts",
        source: 'const command = "tailor --name   tailor-sdk deploy";',
        codemod: makeCodemod("test/rename-bin", partialTransformPath, ["**/*.ts"], [], {
          sourceStringLegacyPatterns: renameBin.sourceStringLegacyPatterns,
        }),
      });

      expect(result.warnings).toEqual([]);
    });

    test("warns for dynamic template rename-bin residuals", async () => {
      const { result } = await runWarningCase({
        fileName: "commands.ts",
        source: "const command = `${runner} tailor-sdk ${subcommand}`;",
        codemod: makeCodemod("test/rename-bin", partialTransformPath, ["**/*.ts"], [], {
          sourceStringLegacyPatterns: renameBin.sourceStringLegacyPatterns,
        }),
      });

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("commands.ts: contains");
      expect(result.warnings[0]).toContain("rule: test/rename-bin");
    });

    test("warns for dynamic package flag rename-bin residuals", async () => {
      const { result } = await runWarningCase({
        fileName: "commands.ts",
        source: "const command = `npx -p ${pkg} tailor-sdk login`;",
        codemod: makeCodemod("test/rename-bin", partialTransformPath, ["**/*.ts"], [], {
          sourceStringLegacyPatterns: renameBin.sourceStringLegacyPatterns,
        }),
      });

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("commands.ts: contains");
      expect(result.warnings[0]).toContain("rule: test/rename-bin");
    });

    test("keeps source string residual checks in non-Tailor option values", async () => {
      const { result } = await runWarningCase({
        fileName: "env.ts",
        source: 'spawn("node", ["-e", "process.env.LOG_LEVEL"]);',
        codemod: makeCodemod("test/env", partialTransformPath, ["**/*.ts"], [], {
          sourceStringLegacyPatterns: ["LOG_LEVEL"],
        }),
      });

      expect(result.warnings).toEqual([
        "env.ts: contains LOG_LEVEL but was not migrated automatically (rule: test/env). Manual migration may be needed.",
      ]);
    });

    test("keeps non-rename-bin source string residual checks in Tailor option values", async () => {
      const { result } = await runWarningCase({
        fileName: "env.ts",
        source: 'spawn("tailor", ["--arg", "LOG_LEVEL=debug", "deploy"]);',
        codemod: makeCodemod("test/env", partialTransformPath, ["**/*.ts"], [], {
          sourceStringLegacyPatterns: ["LOG_LEVEL"],
        }),
      });

      expect(result.warnings).toEqual([
        "env.ts: contains LOG_LEVEL but was not migrated automatically (rule: test/env). Manual migration may be needed.",
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

    test("flags runtime subpath imports left after conservative skips", async () => {
      const codemod = allCodemods.find((entry) => entry.id === "v2/runtime-subpath-namespace");
      if (!codemod?.scriptPath) throw new Error("runtime subpath codemod missing script");
      const scriptPath = path.resolve(
        __dirname,
        "../codemods",
        codemod.scriptPath.replace(/\.js$/, ".ts"),
      );
      const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "runner-runtime-test-"));
      tmpDir = dir;
      await fs.promises.writeFile(
        path.join(dir, "exports.ts"),
        [
          'import { get } from "@tailor-platform/sdk/runtime/aigateway";',
          "",
          "export { get };",
          "",
        ].join("\n"),
      );
      await fs.promises.writeFile(
        path.join(dir, "reexport.ts"),
        ['export { get } from "@tailor-platform/sdk/runtime/aigateway";', ""].join("\n"),
      );
      await fs.promises.writeFile(
        path.join(dir, "reexport-all.ts"),
        ['export * from "@tailor-platform/sdk/runtime/aigateway";', ""].join("\n"),
      );
      await fs.promises.writeFile(
        path.join(dir, "reexport-namespace.ts"),
        ['export * as aigateway from "@tailor-platform/sdk/runtime/aigateway";', ""].join("\n"),
      );
      await fs.promises.writeFile(
        path.join(dir, "dynamic.ts"),
        [
          'type ClientRef = import("@tailor-platform/sdk/runtime/idp").Client;',
          'const getGateway = (await import("@tailor-platform/sdk/runtime/aigateway")).get;',
          "",
        ].join("\n"),
      );
      await fs.promises.writeFile(
        path.join(dir, "dynamic-template.ts"),
        [
          "const getGateway = (await import(`@tailor-platform/sdk/runtime/aigateway`)).get;",
          "",
        ].join("\n"),
      );
      await fs.promises.writeFile(
        path.join(dir, "dynamic-const.ts"),
        [
          'const runtimeModule = "@tailor-platform/sdk/runtime/aigateway";',
          "const getGateway = (await import(runtimeModule)).get;",
          "",
        ].join("\n"),
      );
      await fs.promises.writeFile(
        path.join(dir, "type-reference.ts"),
        [
          'import type { Client } from "@tailor-platform/sdk/runtime/idp";',
          "",
          "type RuntimeClient = Client;",
          "",
        ].join("\n"),
      );
      await fs.promises.writeFile(
        path.join(dir, "namespace-type.ts"),
        [
          'import * as idp from "@tailor-platform/sdk/runtime/idp";',
          "",
          "type RuntimeConfig = idp.ClientConfig;",
          "",
        ].join("\n"),
      );
      await fs.promises.writeFile(
        path.join(dir, "require.cjs"),
        [
          'const { get } = require("@tailor-platform/sdk/runtime/aigateway");',
          "module.exports = get;",
          "",
        ].join("\n"),
      );
      await fs.promises.writeFile(
        path.join(dir, "import-equals.cts"),
        [
          'import iconv = require("@tailor-platform/sdk/runtime/iconv");',
          "",
          "export const encode = iconv.encode;",
          "",
        ].join("\n"),
      );
      await fs.promises.writeFile(
        path.join(dir, "default-import.ts"),
        [
          'import iconv from "@tailor-platform/sdk/runtime/iconv";',
          "",
          'iconv.convert("a", "UTF-8", "Shift_JIS");',
          "",
        ].join("\n"),
      );
      await fs.promises.writeFile(
        path.join(dir, "aggregate-destructure.ts"),
        [
          'import { file as runtimeFile } from "@tailor-platform/sdk/runtime";',
          "",
          "const { deleteFile } = runtimeFile;",
          "",
        ].join("\n"),
      );
      await fs.promises.writeFile(
        path.join(dir, "shadow-only.ts"),
        [
          'import { file as runtimeFile } from "@tailor-platform/sdk/runtime";',
          "",
          "function remove(runtimeFile: { deleteFile(): void }) {",
          "  runtimeFile.deleteFile();",
          "}",
          "",
        ].join("\n"),
      );

      const result = await runCodemods([{ codemod, scriptPath }], dir, true);

      expect(result.changed).toBe(false);
      expect(result.llmReviews).toEqual([
        {
          codemodId: "v2/runtime-subpath-namespace",
          prompt: codemod.prompt,
          files: [
            "aggregate-destructure.ts",
            "default-import.ts",
            "dynamic-const.ts",
            "dynamic-template.ts",
            "dynamic.ts",
            "exports.ts",
            "import-equals.cts",
            "namespace-type.ts",
            "reexport-all.ts",
            "reexport-namespace.ts",
            "reexport.ts",
            "require.cjs",
            "type-reference.ts",
          ],
          findings: [
            expect.objectContaining({
              file: "aggregate-destructure.ts",
              line: 3,
              excerpt: "{ deleteFile } = runtimeFile",
            }),
            expect.objectContaining({
              file: "default-import.ts",
              line: 1,
              excerpt: 'import iconv from "@tailor-platform/sdk/runtime/iconv";',
            }),
            expect.objectContaining({
              file: "dynamic-const.ts",
              line: 2,
              excerpt: "(await import(runtimeModule)).get",
            }),
            expect.objectContaining({
              file: "dynamic-template.ts",
              line: 1,
              excerpt: "(await import(`@tailor-platform/sdk/runtime/aigateway`)).get",
            }),
            expect.objectContaining({
              file: "dynamic.ts",
              line: 1,
              excerpt: 'import("@tailor-platform/sdk/runtime/idp").Client',
            }),
            expect.objectContaining({
              file: "dynamic.ts",
              line: 2,
              excerpt: '(await import("@tailor-platform/sdk/runtime/aigateway")).get',
            }),
            expect.objectContaining({
              file: "exports.ts",
              line: 1,
              excerpt: 'import { get } from "@tailor-platform/sdk/runtime/aigateway";',
            }),
            expect.objectContaining({
              file: "import-equals.cts",
              line: 1,
              excerpt: 'import iconv = require("@tailor-platform/sdk/runtime/iconv");',
            }),
            expect.objectContaining({
              file: "namespace-type.ts",
              line: 1,
              excerpt: 'import * as idp from "@tailor-platform/sdk/runtime/idp";',
            }),
            expect.objectContaining({
              file: "reexport-all.ts",
              line: 1,
              excerpt: 'export * from "@tailor-platform/sdk/runtime/aigateway";',
            }),
            expect.objectContaining({
              file: "reexport-namespace.ts",
              line: 1,
              excerpt: 'export * as aigateway from "@tailor-platform/sdk/runtime/aigateway";',
            }),
            expect.objectContaining({
              file: "reexport.ts",
              line: 1,
              excerpt: 'export { get } from "@tailor-platform/sdk/runtime/aigateway";',
            }),
            expect.objectContaining({
              file: "require.cjs",
              line: 1,
              excerpt: 'require("@tailor-platform/sdk/runtime/aigateway")',
            }),
            expect.objectContaining({
              file: "type-reference.ts",
              line: 1,
              excerpt: 'import type { Client } from "@tailor-platform/sdk/runtime/idp";',
            }),
          ],
        },
      ]);
    });

    test("flags unresolved auth connection token helper usages for LLM review", async () => {
      const codemod = allCodemods.find((entry) => entry.id === "v2/auth-connection-token-helper");
      if (!codemod?.scriptPath) throw new Error("auth connection token codemod missing script");
      const scriptPath = path.resolve(
        __dirname,
        "../codemods",
        codemod.scriptPath.replace(/\.js$/, ".ts"),
      );
      const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "runner-auth-token-test-"));
      tmpDir = dir;
      await fs.promises.writeFile(
        path.join(dir, "migrated.ts"),
        [
          'import { auth } from "../tailor.config";',
          "",
          "export async function run() {",
          '  return auth.getConnectionToken("google");',
          "}",
          "",
        ].join("\n"),
      );
      await fs.promises.writeFile(
        path.join(dir, "default-import.ts"),
        [
          'import config from "../tailor.config";',
          "",
          "export async function run() {",
          '  return config.auth.getConnectionToken("google");',
          "}",
          "",
        ].join("\n"),
      );
      await fs.promises.writeFile(
        path.join(dir, "reexported-config.ts"),
        [
          'import { auth } from "../app-config";',
          "",
          "export async function run() {",
          '  return auth.getConnectionToken("google");',
          "}",
          "",
        ].join("\n"),
      );
      await fs.promises.writeFile(
        path.join(dir, "computed.ts"),
        [
          'import { auth } from "../tailor.config";',
          "",
          'export const token = await auth["getConnectionToken"]("google");',
          "",
        ].join("\n"),
      );
      await fs.promises.writeFile(
        path.join(dir, "destructure.ts"),
        [
          'import { auth } from "../tailor.config";',
          "",
          "export const { getConnectionToken } = auth;",
          "",
        ].join("\n"),
      );
      await fs.promises.writeFile(
        path.join(dir, "cjs-require.js"),
        [
          'const { auth } = require("../tailor.config");',
          "",
          'exports.token = auth.getConnectionToken("google");',
          "",
        ].join("\n"),
      );
      await fs.promises.writeFile(
        path.join(dir, "collision.ts"),
        [
          'import { auth } from "../tailor.config";',
          "",
          "const authconnection = createClient();",
          "",
          "export async function run() {",
          '  return auth.getConnectionToken("google");',
          "}",
          "",
        ].join("\n"),
      );
      await fs.promises.writeFile(
        path.join(dir, "shadowed.ts"),
        [
          'import { auth } from "../tailor.config";',
          "",
          "export async function run(auth: { getConnectionToken(name: string): Promise<string> }) {",
          '  return auth.getConnectionToken("google");',
          "}",
          "",
        ].join("\n"),
      );

      using _stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);

      const result = await runCodemods([{ codemod, scriptPath }], dir, true);

      expect(result.changed).toBe(true);
      expect(result.llmReviews).toEqual([
        {
          codemodId: "v2/auth-connection-token-helper",
          prompt: codemod.prompt,
          files: [
            "cjs-require.js",
            "collision.ts",
            "computed.ts",
            "default-import.ts",
            "destructure.ts",
            "reexported-config.ts",
            "shadowed.ts",
          ],
          findings: [
            expect.objectContaining({
              file: "cjs-require.js",
              line: 3,
              excerpt: 'exports.token = auth.getConnectionToken("google");',
            }),
            expect.objectContaining({
              file: "collision.ts",
              line: 6,
              excerpt: 'return auth.getConnectionToken("google");',
            }),
            expect.objectContaining({
              file: "computed.ts",
              line: 3,
              excerpt: 'export const token = await auth["getConnectionToken"]("google");',
            }),
            expect.objectContaining({
              file: "default-import.ts",
              line: 4,
              excerpt: 'return config.auth.getConnectionToken("google");',
            }),
            expect.objectContaining({
              file: "destructure.ts",
              line: 3,
              excerpt: "export const { getConnectionToken } = auth;",
            }),
            expect.objectContaining({
              file: "reexported-config.ts",
              line: 4,
              excerpt: 'return auth.getConnectionToken("google");',
            }),
            expect.objectContaining({
              file: "shadowed.ts",
              line: 4,
              excerpt: 'return auth.getConnectionToken("google");',
            }),
          ],
        },
      ]);
    });

    test("suppresses LLM review when a superseding codemod is selected", async () => {
      const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "runner-llm-superseded-"));
      tmpDir = dir;
      await fs.promises.writeFile(
        path.join(dir, "a.ts"),
        "createResolver({ authInvoker: auth.invoker(machineUserName) });\n",
      );

      const result = await runCodemods(
        [
          {
            codemod: makeCodemod("test/helper", undefined, ["**/*.ts"], undefined, {
              suspiciousPatterns: ["auth.invoker"],
              prompt: "Keep authInvoker and unwrap auth.invoker.",
              reviewSupersededBy: ["test/rename"],
            }),
          },
          {
            codemod: makeCodemod("test/rename", undefined, ["**/*.ts"], undefined, {
              suspiciousPatterns: ["auth.invoker"],
              prompt: "Rename authInvoker to invoker and unwrap auth.invoker.",
            }),
          },
        ],
        dir,
        true,
      );

      expect(result.llmReviews).toEqual([
        {
          codemodId: "test/rename",
          prompt: "Rename authInvoker to invoker and unwrap auth.invoker.",
          files: ["a.ts"],
        },
      ]);
    });

    test("AND-group suspicious pattern flags only when every substring co-occurs", async () => {
      const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "runner-llm-and-test-"));
      tmpDir = dir;
      await fs.promises.writeFile(
        path.join(dir, "unresolved.ts"),
        "const serialized = JSON.stringify(payload);\nawait executeScript({ arg: serialized });\n",
      );
      await fs.promises.writeFile(
        path.join(dir, "already-plain.ts"),
        "await executeScript({ arg: payload });\n",
      );
      await fs.promises.writeFile(
        path.join(dir, "non-arg-json.ts"),
        "await executeScript({ code: JSON.stringify(meta) });\n",
      );

      const result = await runCodemods(
        [
          {
            codemod: makeCodemod("test/llm", partialTransformPath, ["**/*.ts"], undefined, {
              suspiciousPatterns: [["executeScript", "JSON.stringify", "arg:"]],
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
          files: ["unresolved.ts"],
        },
      ]);
    });

    test("AND-group suspicious pattern supports regex members", async () => {
      const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "runner-llm-regex-test-"));
      tmpDir = dir;
      await fs.promises.writeFile(
        path.join(dir, "spaced-colon.ts"),
        "const serialized = JSON.stringify(payload);\nawait executeScript({ arg : serialized });\n",
      );
      await fs.promises.writeFile(
        path.join(dir, "already-plain.ts"),
        "await executeScript({ arg : payload });\n",
      );

      const result = await runCodemods(
        [
          {
            codemod: makeCodemod("test/llm", partialTransformPath, ["**/*.ts"], undefined, {
              suspiciousPatterns: [["executeScript", "JSON.stringify", /\barg\s*:/]],
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
          files: ["spaced-colon.ts"],
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

    test("flags source strings matching source-string suspicious patterns for LLM review", async () => {
      const dir = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), "runner-llm-source-string-test-"),
      );
      tmpDir = dir;
      const embeddedCode = [
        'const client = new tailor.idp.Client({ namespace: "default" });',
        "const C = tailor.idp.Client;",
        'await tailor.secretmanager.getSecret("vault", "key");',
        "const { getSecret } = tailor.secretmanager;",
        "const getInvoker = tailor.context.getInvoker;",
        "const { upload } = tailordb.file;",
        "const e: TailorErrors = err;",
        "type R = Promise<tailordb.QueryResult<User>>;",
      ].join("\\n");
      const typeOnlyEmbeddedCode = [
        "type U = Promise<tailor.idp.User>;",
        "type Ctor = typeof tailordb.Client;",
        "return tailordb.Client;",
        "foo(tailordb.Client);",
        "type F = () => tailordb.QueryResult<User>;",
      ].join("\\n");
      const seedSource = [
        `const code = \`${embeddedCode}\`;`,
        'const note = "tailor.idp.Client is mentioned in prose";',
      ].join("\n");
      await fs.promises.writeFile(path.join(dir, "seed.mjs"), seedSource);
      await fs.promises.writeFile(
        path.join(dir, "escaped.mjs"),
        'const code = "const C =\\n tailor.idp.Client;";',
      );
      await fs.promises.writeFile(
        path.join(dir, "types.mjs"),
        `const code = \`${typeOnlyEmbeddedCode}\`;`,
      );
      await fs.promises.writeFile(
        path.join(dir, "prose.mjs"),
        ['const separator = "=";', 'const note = "tailor.idp.Client is mentioned in prose";'].join(
          "\n",
        ),
      );

      const result = await runCodemods(
        [
          {
            codemod: makeCodemod(
              "test/llm-source-string",
              partialTransformPath,
              ["**/*.{ts,js,mjs,cjs}"],
              undefined,
              {
                sourceStringSuspiciousPatterns: [
                  "new tailor.idp.Client",
                  /[=(:,[]\s*tailor\.idp\.Client\b/,
                  /(?:(?:=>|[=(:,<{]|\[)\s*|\b(?:return|await|typeof)\s+)tailor\.(?:context|idp|secretmanager)(?:\.[A-Za-z_$][\w$]*)?\b/,
                  /\btailor\.(?:idp|secretmanager)\.[A-Za-z_$][\w$]*\s*\(/,
                  /(?:(?:[=(:,{]|\[)\s*|\b(?:return|await)\s+)tailordb\.file\b/,
                  /(?:\bnew\s+|(?:=>|[=(:,<{]|\[)\s*|\b(?:return|await|typeof)\s+)tailordb\.(?:Client|QueryResult)\b/,
                  /<\s*tailordb\.(?:QueryResult)\b/,
                  /(?:[:=<]\s*|\bas\s+)Tailor(?:Errors)\b/,
                ],
                prompt: "Review embedded runtime global usage by hand.",
              },
            ),
            scriptPath: partialTransformPath,
          },
        ],
        dir,
        true,
      );

      expect(result.llmReviews).toHaveLength(1);
      expect(result.llmReviews[0]).toMatchObject({
        codemodId: "test/llm-source-string",
        prompt: "Review embedded runtime global usage by hand.",
      });
      expect(result.llmReviews[0]?.files).toEqual(
        expect.arrayContaining(["escaped.mjs", "seed.mjs", "types.mjs"]),
      );
      expect(result.llmReviews[0]?.files).toHaveLength(3);
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
