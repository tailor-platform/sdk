import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bundleResolvers } from "./bundler";
import type * as rolldown from "rolldown";

let buildTracker: { active: number; maxActive: number } | undefined;

type RolldownModule = typeof rolldown;

vi.mock("rolldown", async (importOriginal) => {
  const original = await importOriginal<RolldownModule>();
  return {
    ...original,
    build: async (...args: Parameters<RolldownModule["build"]>) => {
      if (buildTracker) {
        buildTracker.active++;
        buildTracker.maxActive = Math.max(buildTracker.maxActive, buildTracker.active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        buildTracker.active--;
        return {
          output: [{ code: "// mocked bundle" }],
        } as unknown as Awaited<ReturnType<RolldownModule["build"]>>;
      }
      return original.build(...args);
    },
  };
});

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
      ).resolves.toEqual(new Map());
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("concurrency", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
      buildTracker = undefined;
    });

    it("caps concurrent rolldown.build invocations to TAILOR_BUNDLE_CONCURRENCY", async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sdk-bundler-conc-"));
      const originalCwd = process.cwd();
      const resolverDir = path.join(tempDir, "src/backend/concurrency/resolver");

      try {
        fs.mkdirSync(resolverDir, { recursive: true });

        const fileCount = 8;
        for (let i = 0; i < fileCount; i++) {
          fs.writeFileSync(
            path.join(resolverDir, `resolver_${i}.ts`),
            `export default {\n` +
              `  operation: "query",\n` +
              `  name: "resolver_${i}",\n` +
              `  body: async () => ${i},\n` +
              `  output: { type: "integer", metadata: {}, fields: {} },\n` +
              `};\n`,
          );
        }

        process.chdir(tempDir);
        vi.stubEnv("TAILOR_BUNDLE_CONCURRENCY", "2");
        buildTracker = { active: 0, maxActive: 0 };

        await bundleResolvers("concurrency", {
          files: ["./src/backend/concurrency/resolver/*.ts"],
        });

        expect(buildTracker.maxActive).toBeGreaterThan(0);
        expect(buildTracker.maxActive).toBeLessThanOrEqual(2);
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });
});
