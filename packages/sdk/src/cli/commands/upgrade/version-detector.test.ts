import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectDeclaredVersion, detectInstalledVersion } from "./version-detector";

describe("version-detector", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "version-detect-test-"));
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  describe("detectInstalledVersion", () => {
    it("should return null when SDK is not installed", async () => {
      const version = await detectInstalledVersion(tmpDir);
      expect(version).toBeNull();
    });

    it("should detect version from node_modules", async () => {
      const sdkDir = path.join(tmpDir, "node_modules", "@tailor-platform", "sdk");
      await fs.promises.mkdir(sdkDir, { recursive: true });
      await fs.promises.writeFile(
        path.join(sdkDir, "package.json"),
        JSON.stringify({
          name: "@tailor-platform/sdk",
          version: "1.32.1",
        }),
      );

      const version = await detectInstalledVersion(tmpDir);
      expect(version).toBe("1.32.1");
    });

    it("should return null when package.json has no version field", async () => {
      const sdkDir = path.join(tmpDir, "node_modules", "@tailor-platform", "sdk");
      await fs.promises.mkdir(sdkDir, { recursive: true });
      await fs.promises.writeFile(
        path.join(sdkDir, "package.json"),
        JSON.stringify({ name: "@tailor-platform/sdk" }),
      );

      const version = await detectInstalledVersion(tmpDir);
      expect(version).toBeNull();
    });

    it("should return null for nonexistent directory", async () => {
      const version = await detectInstalledVersion(path.join(tmpDir, "nonexistent"));
      expect(version).toBeNull();
    });
  });

  describe("detectDeclaredVersion", () => {
    it("should detect version from dependencies", async () => {
      await fs.promises.writeFile(
        path.join(tmpDir, "package.json"),
        JSON.stringify({
          name: "test-project",
          dependencies: { "@tailor-platform/sdk": "^2.0.0" },
        }),
      );

      const version = await detectDeclaredVersion(tmpDir);
      expect(version).toBe("^2.0.0");
    });

    it("should detect version from devDependencies", async () => {
      await fs.promises.writeFile(
        path.join(tmpDir, "package.json"),
        JSON.stringify({
          name: "test-project",
          devDependencies: { "@tailor-platform/sdk": "~2.1.0" },
        }),
      );

      const version = await detectDeclaredVersion(tmpDir);
      expect(version).toBe("~2.1.0");
    });

    it("should return null when SDK is not a dependency", async () => {
      await fs.promises.writeFile(
        path.join(tmpDir, "package.json"),
        JSON.stringify({
          name: "test-project",
          dependencies: { "some-other-package": "1.0.0" },
        }),
      );

      const version = await detectDeclaredVersion(tmpDir);
      expect(version).toBeNull();
    });

    it("should return null when package.json does not exist", async () => {
      const version = await detectDeclaredVersion(path.join(tmpDir, "nonexistent"));
      expect(version).toBeNull();
    });
  });
});
