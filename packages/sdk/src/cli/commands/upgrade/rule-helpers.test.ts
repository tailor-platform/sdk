import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWarningRule } from "./rule-helpers";
import type { TransformContext } from "./types";

describe("createWarningRule", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "warning-rule-test-"));
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  function makeContext(files: string[], dryRun = false): TransformContext {
    return { projectRoot: tmpDir, files, dryRun };
  }

  it("should collect a single warning from scan function", async () => {
    const filePath = path.join(tmpDir, "a.ts");
    await fs.promises.writeFile(filePath, "const x = 1;", "utf-8");

    const rule = createWarningRule(
      {
        id: "test/single",
        name: "Single warning",
        description: "desc",
        since: "0.0.0",
        until: "1.0.0",
      },
      () => "Manual migration needed",
    );

    const result = await rule.transform(makeContext([filePath]));
    expect(result.warnings).toEqual(["Manual migration needed"]);
    expect(result.changed).toBe(false);
    expect(result.filesModified).toEqual([]);
    expect(result.diffs).toBeUndefined();
  });

  it("should collect multiple warnings from array return", async () => {
    const filePath = path.join(tmpDir, "b.ts");
    await fs.promises.writeFile(filePath, "const x = 1;", "utf-8");

    const rule = createWarningRule(
      {
        id: "test/multi",
        name: "Multi warning",
        description: "desc",
        since: "0.0.0",
        until: "1.0.0",
      },
      () => ["Warning 1", "Warning 2"],
    );

    const result = await rule.transform(makeContext([filePath]));
    expect(result.warnings).toEqual(["Warning 1", "Warning 2"]);
    expect(result.changed).toBe(false);
  });

  it("should skip files where scan returns null", async () => {
    const filePath = path.join(tmpDir, "c.ts");
    await fs.promises.writeFile(filePath, "const x = 1;", "utf-8");

    const rule = createWarningRule(
      { id: "test/null", name: "No warning", description: "desc", since: "0.0.0", until: "1.0.0" },
      () => null,
    );

    const result = await rule.transform(makeContext([filePath]));
    expect(result.warnings).toEqual([]);
    expect(result.changed).toBe(false);
  });

  it("should not modify any files", async () => {
    const filePath = path.join(tmpDir, "d.ts");
    const originalContent = "const original = true;";
    await fs.promises.writeFile(filePath, originalContent, "utf-8");

    const rule = createWarningRule(
      {
        id: "test/no-modify",
        name: "No modify",
        description: "desc",
        since: "0.0.0",
        until: "1.0.0",
      },
      () => "Some warning",
    );

    await rule.transform(makeContext([filePath]));
    const content = await fs.promises.readFile(filePath, "utf-8");
    expect(content).toBe(originalContent);
  });

  it("should expose scanSource for direct testing", () => {
    const scanFn = (_source: string, file: string) => `Issue in ${file}`;
    const rule = createWarningRule(
      { id: "test/expose", name: "Exposed", description: "desc", since: "0.0.0", until: "1.0.0" },
      scanFn,
    );

    expect(rule.scanSource).toBe(scanFn);
    expect(rule.scanSource("content", "file.ts")).toBe("Issue in file.ts");
  });

  it("should handle multiple files with mixed results", async () => {
    const fileA = path.join(tmpDir, "warn.ts");
    const fileB = path.join(tmpDir, "clean.ts");
    const fileC = path.join(tmpDir, "multi.ts");
    await fs.promises.writeFile(fileA, "deprecated();", "utf-8");
    await fs.promises.writeFile(fileB, "const x = 1;", "utf-8");
    await fs.promises.writeFile(fileC, "old1(); old2();", "utf-8");

    const rule = createWarningRule(
      { id: "test/mixed", name: "Mixed", description: "desc", since: "0.0.0", until: "1.0.0" },
      (source, file) => {
        if (source.includes("deprecated")) return `Deprecated usage in ${file}`;
        if (source.includes("old1")) return [`old1 in ${file}`, `old2 in ${file}`];
        return null;
      },
    );

    const result = await rule.transform(makeContext([fileA, fileB, fileC]));
    expect(result.warnings).toHaveLength(3);
    expect(result.warnings).toContain(`Deprecated usage in ${fileA}`);
    expect(result.warnings).toContain(`old1 in ${fileC}`);
    expect(result.warnings).toContain(`old2 in ${fileC}`);
    expect(result.changed).toBe(false);
    expect(result.filesModified).toEqual([]);
  });
});
