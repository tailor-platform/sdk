import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { describe, expect, it } from "vitest";
import { bundleExecutors } from "./executor-bundler";

describe("bundleExecutors", () => {
  it("does not throw when no executor files match", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sdk-bundler-"));
    const originalCwd = process.cwd();

    try {
      fs.mkdirSync(path.join(tempDir, "src/backend/provisioning/executor"), {
        recursive: true,
      });
      process.chdir(tempDir);

      await expect(
        bundleExecutors({
          files: ["./src/backend/provisioning/executor/*.ts"],
        }),
      ).resolves.toBeUndefined();
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
