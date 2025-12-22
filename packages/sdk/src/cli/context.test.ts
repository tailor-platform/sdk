import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadConfigPath } from "./context";

describe("loadConfigPath", () => {
  const originalEnv = process.env;
  let tempDir: string;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    delete process.env.TAILOR_PLATFORM_SDK_CONFIG_PATH;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tailor-test-"));
    vi.spyOn(process, "cwd").mockReturnValue(tempDir);
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns explicit config path when provided", () => {
    const result = loadConfigPath("/explicit/path/config.ts");
    expect(result).toBe("/explicit/path/config.ts");
  });

  it("returns env config path when set", () => {
    process.env.TAILOR_PLATFORM_SDK_CONFIG_PATH = "/env/path/config.ts";
    const result = loadConfigPath();
    expect(result).toBe("/env/path/config.ts");
  });

  it("finds config in current directory", () => {
    const configPath = path.join(tempDir, "tailor.config.ts");
    fs.writeFileSync(configPath, "export default {}");

    const result = loadConfigPath();
    expect(result).toBe(configPath);
  });

  it("finds config in parent directory", () => {
    const nestedDir = path.join(tempDir, "nested");
    fs.mkdirSync(nestedDir, { recursive: true });
    const configPath = path.join(tempDir, "tailor.config.ts");
    fs.writeFileSync(configPath, "export default {}");

    vi.spyOn(process, "cwd").mockReturnValue(nestedDir);
    const result = loadConfigPath();
    expect(result).toBe(configPath);
  });

  it("finds config in grandparent directory", () => {
    const deepNestedDir = path.join(tempDir, "nested", "deep");
    fs.mkdirSync(deepNestedDir, { recursive: true });
    const configPath = path.join(tempDir, "tailor.config.ts");
    fs.writeFileSync(configPath, "export default {}");

    vi.spyOn(process, "cwd").mockReturnValue(deepNestedDir);
    const result = loadConfigPath();
    expect(result).toBe(configPath);
  });

  it("prefers config in closer directory", () => {
    const nestedDir = path.join(tempDir, "nested");
    fs.mkdirSync(nestedDir, { recursive: true });
    const parentConfig = path.join(tempDir, "tailor.config.ts");
    const nestedConfig = path.join(nestedDir, "tailor.config.ts");
    fs.writeFileSync(parentConfig, "export default {}");
    fs.writeFileSync(nestedConfig, "export default {}");

    vi.spyOn(process, "cwd").mockReturnValue(nestedDir);
    const result = loadConfigPath();
    expect(result).toBe(nestedConfig);
  });

  it("returns undefined when config not found", () => {
    const result = loadConfigPath();
    expect(result).toBeUndefined();
  });
});
