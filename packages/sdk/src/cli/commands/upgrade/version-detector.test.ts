import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { detectInstalledVersion } from "./version-detector";

describe("version-detector", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "version-detect-test-"));
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  describe("detectInstalledVersion", () => {
    test("should return null when SDK is not installed", async () => {
      const version = await detectInstalledVersion(tmpDir);
      expect(version).toBeNull();
    });

    test("should detect version from node_modules", async () => {
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

    test("should return null when package.json has no version field", async () => {
      const sdkDir = path.join(tmpDir, "node_modules", "@tailor-platform", "sdk");
      await fs.promises.mkdir(sdkDir, { recursive: true });
      await fs.promises.writeFile(
        path.join(sdkDir, "package.json"),
        JSON.stringify({ name: "@tailor-platform/sdk" }),
      );

      const version = await detectInstalledVersion(tmpDir);
      expect(version).toBeNull();
    });

    test("should detect version from parent node_modules (workspace hoisting)", async () => {
      const sdkDir = path.join(tmpDir, "node_modules", "@tailor-platform", "sdk");
      await fs.promises.mkdir(sdkDir, { recursive: true });
      await fs.promises.writeFile(
        path.join(sdkDir, "package.json"),
        JSON.stringify({ name: "@tailor-platform/sdk", version: "1.32.1" }),
      );

      const subDir = path.join(tmpDir, "packages", "app");
      await fs.promises.mkdir(subDir, { recursive: true });

      const version = await detectInstalledVersion(subDir);
      expect(version).toBe("1.32.1");
    });

    test("should return null for nonexistent directory", async () => {
      const version = await detectInstalledVersion(path.join(tmpDir, "nonexistent"));
      expect(version).toBeNull();
    });
  });
});
