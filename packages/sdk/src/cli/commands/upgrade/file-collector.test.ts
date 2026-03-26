import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectFiles } from "./file-collector";

describe("collectFiles", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "collect-files-test-"));
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it("should collect .ts files", async () => {
    await fs.promises.writeFile(path.join(tmpDir, "config.ts"), "export default {};");
    await fs.promises.writeFile(path.join(tmpDir, "helper.ts"), "export const x = 1;");

    const files = await collectFiles(tmpDir);
    expect(files).toHaveLength(2);
    expect(files.every((f) => f.endsWith(".ts"))).toBe(true);
  });

  it("should collect .tsx files", async () => {
    await fs.promises.writeFile(path.join(tmpDir, "component.tsx"), "export default () => <div/>;");

    const files = await collectFiles(tmpDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain("component.tsx");
  });

  it("should collect files in subdirectories", async () => {
    const subDir = path.join(tmpDir, "tailordb");
    await fs.promises.mkdir(subDir);
    await fs.promises.writeFile(path.join(subDir, "user.ts"), "export const user = {};");

    const files = await collectFiles(tmpDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain(path.join("tailordb", "user.ts"));
  });

  it("should exclude node_modules", async () => {
    const nmDir = path.join(tmpDir, "node_modules", "some-pkg");
    await fs.promises.mkdir(nmDir, { recursive: true });
    await fs.promises.writeFile(path.join(nmDir, "index.ts"), "export const x = 1;");
    await fs.promises.writeFile(path.join(tmpDir, "config.ts"), "export default {};");

    const files = await collectFiles(tmpDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain("config.ts");
  });

  it("should exclude dist directory", async () => {
    const distDir = path.join(tmpDir, "dist");
    await fs.promises.mkdir(distDir);
    await fs.promises.writeFile(path.join(distDir, "output.ts"), "export const x = 1;");
    await fs.promises.writeFile(path.join(tmpDir, "config.ts"), "export default {};");

    const files = await collectFiles(tmpDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain("config.ts");
  });

  it("should ignore non-TypeScript files", async () => {
    await fs.promises.writeFile(path.join(tmpDir, "config.ts"), "export default {};");
    await fs.promises.writeFile(path.join(tmpDir, "readme.md"), "# Hello");
    await fs.promises.writeFile(path.join(tmpDir, "data.json"), "{}");

    const files = await collectFiles(tmpDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain("config.ts");
  });

  it("should return empty array for empty directory", async () => {
    const files = await collectFiles(tmpDir);
    expect(files).toHaveLength(0);
  });

  it("should collect .mts and .cts files", async () => {
    await fs.promises.writeFile(path.join(tmpDir, "module.mts"), "export const x = 1;");
    await fs.promises.writeFile(path.join(tmpDir, "common.cts"), "module.exports = {};");

    const files = await collectFiles(tmpDir);
    expect(files).toHaveLength(2);
    expect(files.some((f) => f.endsWith(".mts"))).toBe(true);
    expect(files.some((f) => f.endsWith(".cts"))).toBe(true);
  });

  it("should exclude declaration files (.d.ts, .d.mts, .d.cts)", async () => {
    await fs.promises.writeFile(path.join(tmpDir, "config.ts"), "export default {};");
    await fs.promises.writeFile(path.join(tmpDir, "types.d.ts"), "declare const x: number;");
    await fs.promises.writeFile(path.join(tmpDir, "module.d.mts"), "declare const y: string;");
    await fs.promises.writeFile(path.join(tmpDir, "common.d.cts"), "declare const z: boolean;");

    const files = await collectFiles(tmpDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain("config.ts");
  });

  it("should return sorted file paths", async () => {
    await fs.promises.writeFile(path.join(tmpDir, "z.ts"), "");
    await fs.promises.writeFile(path.join(tmpDir, "a.ts"), "");
    await fs.promises.writeFile(path.join(tmpDir, "m.ts"), "");

    const files = await collectFiles(tmpDir);
    const basenames = files.map((f) => path.basename(f));
    expect(basenames).toEqual(["a.ts", "m.ts", "z.ts"]);
  });
});
