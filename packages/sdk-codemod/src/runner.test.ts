import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

function makeCodemod(id: string, scriptPath: string, filePatterns?: string[]): CodemodPackage {
  return {
    id,
    name: id,
    description: `Test codemod ${id}`,
    since: "1.0.0",
    until: "2.0.0",
    scriptPath,
    filePatterns,
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

    it("should chain transforms so B sees A's output in dry-run", async () => {
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

    it("should produce diff showing final result (oldFunc → newFunc) in dry-run", async () => {
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

    it("should write final chained result in non-dry-run", async () => {
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

    it("should skip transform B if A produces no match for B", async () => {
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

    beforeEach(async () => {
      await fs.promises.writeFile(
        transformPath,
        `export default function transform(source) {
          return source.toUpperCase();
        }`,
        "utf-8",
      );
    });

    afterEach(async () => {
      await fs.promises.rm(transformPath, { force: true });
    });

    it("should only apply transform to files matching filePatterns", async () => {
      const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "runner-pattern-test-"));
      tmpDir = dir;
      await fs.promises.writeFile(path.join(dir, "config.ts"), "hello", "utf-8");
      await fs.promises.writeFile(path.join(dir, "data.json"), "world", "utf-8");

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

      // TS file should be unchanged
      const tsContent = await fs.promises.readFile(path.join(dir, "config.ts"), "utf-8");
      expect(tsContent).toBe("hello");

      // JSON file should be uppercased
      const jsonContent = await fs.promises.readFile(path.join(dir, "data.json"), "utf-8");
      expect(jsonContent).toBe("WORLD");
    });
  });
});
