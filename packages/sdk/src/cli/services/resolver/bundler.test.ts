import * as fs from "node:fs";
import * as path from "pathe";
import { afterEach, describe, expect, test, vi } from "vitest";
import { tempCwd } from "#/cli/shared/test-helpers/temp-cwd";
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
  test("does not throw when no resolver files match", async () => {
    using tmp = tempCwd("sdk-bundler-");
    fs.mkdirSync(path.join(tmp.dir, "src/backend/provisioning/resolver"), {
      recursive: true,
    });

    await expect(
      bundleResolvers("provisioning", {
        files: ["./src/backend/provisioning/resolver/*.ts"],
      }),
    ).resolves.toEqual(new Map());
  });

  describe("concurrency", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
      buildTracker = undefined;
    });

    test("caps concurrent rolldown.build invocations to TAILOR_BUNDLE_CONCURRENCY", async () => {
      using tmp = tempCwd("sdk-bundler-conc-");
      const resolverDir = path.join(tmp.dir, "src/backend/concurrency/resolver");
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

      vi.stubEnv("TAILOR_BUNDLE_CONCURRENCY", "2");
      buildTracker = { active: 0, maxActive: 0 };

      await bundleResolvers("concurrency", {
        files: ["./src/backend/concurrency/resolver/*.ts"],
      });

      expect(buildTracker.maxActive).toBeGreaterThan(0);
      expect(buildTracker.maxActive).toBeLessThanOrEqual(2);
    });
  });
});
