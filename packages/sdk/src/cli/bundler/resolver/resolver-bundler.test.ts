import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { bundleResolvers } from "./resolver-bundler";

describe("bundleResolvers", () => {
  it("does not throw when no resolver files match", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sdk-bundler-"));
    const originalCwd = process.cwd();

    try {
      fs.mkdirSync(path.join(tempDir, "src/backend/provisioning/resolver"), {
        recursive: true,
      });
      process.chdir(tempDir);

      await expect(
        bundleResolvers("provisioning", {
          files: ["./src/backend/provisioning/resolver/*.ts"],
        }),
      ).resolves.toBeUndefined();
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
