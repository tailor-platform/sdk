import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadEnvFiles } from "./args";

describe("loadEnvFiles", () => {
  const originalEnv = process.env;
  let tempDir: string;

  beforeEach(() => {
    process.env = { ...originalEnv };
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tailor-env-test-"));
    vi.spyOn(process, "cwd").mockReturnValue(tempDir);
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("required env files (envFiles)", () => {
    it("loads environment variables from existing file", () => {
      const envPath = path.join(tempDir, ".env");
      fs.writeFileSync(envPath, "TEST_VAR=hello\nANOTHER_VAR=world");

      loadEnvFiles(".env", undefined);

      expect(process.env.TEST_VAR).toBe("hello");
      expect(process.env.ANOTHER_VAR).toBe("world");
    });

    it("throws error when required file does not exist", () => {
      expect(() => loadEnvFiles("nonexistent.env", undefined)).toThrow(
        /Environment file not found/,
      );
    });

    it("loads multiple files from array", () => {
      const env1Path = path.join(tempDir, ".env.1");
      const env2Path = path.join(tempDir, ".env.2");
      fs.writeFileSync(env1Path, "VAR_FROM_1=value1");
      fs.writeFileSync(env2Path, "VAR_FROM_2=value2");

      loadEnvFiles([".env.1", ".env.2"], undefined);

      expect(process.env.VAR_FROM_1).toBe("value1");
      expect(process.env.VAR_FROM_2).toBe("value2");
    });
  });

  describe("optional env files (envFilesIfExists)", () => {
    it("loads environment variables from existing file", () => {
      const envPath = path.join(tempDir, ".env.local");
      fs.writeFileSync(envPath, "LOCAL_VAR=local_value");

      loadEnvFiles(undefined, ".env.local");

      expect(process.env.LOCAL_VAR).toBe("local_value");
    });

    it("does not throw when optional file does not exist", () => {
      expect(() => loadEnvFiles(undefined, "nonexistent.env")).not.toThrow();
    });

    it("loads existing files and skips non-existing ones from array", () => {
      const envPath = path.join(tempDir, ".env.exists");
      fs.writeFileSync(envPath, "EXISTS_VAR=exists");

      loadEnvFiles(undefined, [".env.exists", ".env.missing"]);

      expect(process.env.EXISTS_VAR).toBe("exists");
    });
  });

  describe("environment variable behavior (follows Node.js --env-file since v20.7.0)", () => {
    it("does NOT overwrite pre-existing environment variables", () => {
      process.env.PREEXISTING_VAR = "original";
      const envPath = path.join(tempDir, ".env");
      fs.writeFileSync(envPath, "PREEXISTING_VAR=from_file");

      loadEnvFiles(".env", undefined);

      expect(process.env.PREEXISTING_VAR).toBe("original");
    });

    it("allows later env files to override earlier ones", () => {
      const env1Path = path.join(tempDir, ".env.1");
      const env2Path = path.join(tempDir, ".env.2");
      fs.writeFileSync(env1Path, "SHARED_VAR=from_first");
      fs.writeFileSync(env2Path, "SHARED_VAR=from_second");

      loadEnvFiles([".env.1", ".env.2"], undefined);

      expect(process.env.SHARED_VAR).toBe("from_second");
    });

    it("allows optional files to override required files", () => {
      const requiredEnv = path.join(tempDir, ".env");
      const optionalEnv = path.join(tempDir, ".env.local");
      fs.writeFileSync(requiredEnv, "SHARED_VAR=from_required");
      fs.writeFileSync(optionalEnv, "SHARED_VAR=from_optional");

      loadEnvFiles(".env", ".env.local");

      expect(process.env.SHARED_VAR).toBe("from_optional");
    });

    it("sets new variables while preserving pre-existing ones", () => {
      process.env.EXISTING = "keep_me";
      const envPath = path.join(tempDir, ".env");
      fs.writeFileSync(envPath, "EXISTING=try_to_override\nNEW_VAR=new_value");

      loadEnvFiles(".env", undefined);

      expect(process.env.EXISTING).toBe("keep_me");
      expect(process.env.NEW_VAR).toBe("new_value");
    });
  });

  describe("edge cases", () => {
    it("handles undefined for both arguments", () => {
      expect(() => loadEnvFiles(undefined, undefined)).not.toThrow();
    });

    it("handles empty arrays", () => {
      expect(() => loadEnvFiles([], [])).not.toThrow();
    });
  });
});
