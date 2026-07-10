import * as fs from "node:fs";
import * as path from "pathe";
import { afterEach, describe, expect, test, vi } from "vitest";
import { tempCwd } from "#/cli/shared/test-helpers/temp-cwd";
import { bundleResolvers } from "./bundler";
import type * as rolldown from "rolldown";

let buildTracker: { active: number; maxActive: number } | undefined;
let concurrentBuildBarrier:
  | {
      calls: number;
      firstBuildStarted: Promise<void>;
      secondBuildStarted: Promise<void>;
      resolveFirstBuildStarted: () => void;
      resolveSecondBuildStarted: () => void;
    }
  | undefined;

type RolldownModule = typeof rolldown;

vi.mock("rolldown", async (importOriginal) => {
  const original = await importOriginal<RolldownModule>();
  return {
    ...original,
    build: async (...args: Parameters<RolldownModule["build"]>) => {
      if (concurrentBuildBarrier) {
        concurrentBuildBarrier.calls++;
        if (concurrentBuildBarrier.calls === 1) {
          concurrentBuildBarrier.resolveFirstBuildStarted();
          await concurrentBuildBarrier.secondBuildStarted;
        } else {
          concurrentBuildBarrier.resolveSecondBuildStarted();
        }

        const options = args[0] as unknown as rolldown.BuildOptions;
        const input = options.input;
        if (typeof input !== "string") {
          throw new TypeError("Expected a string rolldown input");
        }
        const entry = fs.readFileSync(input, "utf8");
        const sourcePath = entry.match(/from "([^"]+)"/)?.[1];
        if (!sourcePath) {
          throw new Error(`Could not find source import in ${input}`);
        }
        return {
          output: [{ code: fs.readFileSync(sourcePath, "utf8") }],
        } as unknown as Awaited<ReturnType<RolldownModule["build"]>>;
      }
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
      concurrentBuildBarrier = undefined;
    });

    test("isolates entry files between concurrent namespaces", async () => {
      using tmp = tempCwd("sdk-bundler-isolation-");
      const firstResolverDir = path.join(tmp.dir, "first/resolver");
      const secondResolverDir = path.join(tmp.dir, "second/resolver");
      fs.mkdirSync(firstResolverDir, { recursive: true });
      fs.mkdirSync(secondResolverDir, { recursive: true });

      fs.writeFileSync(
        path.join(firstResolverDir, "shared.ts"),
        `export default {\n` +
          `  operation: "query",\n` +
          `  name: "shared",\n` +
          `  body: async () => "FIRST_NAMESPACE_MARKER",\n` +
          `  output: { type: "string", metadata: {}, fields: {} },\n` +
          `};\n`,
      );
      fs.writeFileSync(
        path.join(secondResolverDir, "shared.ts"),
        `export default {\n` +
          `  operation: "query",\n` +
          `  name: "shared",\n` +
          `  body: async () => "SECOND_NAMESPACE_MARKER",\n` +
          `  output: { type: "string", metadata: {}, fields: {} },\n` +
          `};\n`,
      );

      let resolveFirstBuildStarted!: () => void;
      let resolveSecondBuildStarted!: () => void;
      const firstBuildStarted = new Promise<void>((resolve) => {
        resolveFirstBuildStarted = resolve;
      });
      const secondBuildStarted = new Promise<void>((resolve) => {
        resolveSecondBuildStarted = resolve;
      });
      concurrentBuildBarrier = {
        calls: 0,
        firstBuildStarted,
        secondBuildStarted,
        resolveFirstBuildStarted,
        resolveSecondBuildStarted,
      };

      const firstBuild = bundleResolvers("first", {
        files: ["./first/resolver/*.ts"],
      });
      await firstBuildStarted;
      const secondBuild = bundleResolvers("second", {
        files: ["./second/resolver/*.ts"],
      });

      const [firstBundles, secondBundles] = await Promise.all([firstBuild, secondBuild]);
      const firstCode = firstBundles.get("shared");
      const secondCode = secondBundles.get("shared");

      expect(firstCode).toContain("FIRST_NAMESPACE_MARKER");
      expect(firstCode).not.toContain("SECOND_NAMESPACE_MARKER");
      expect(secondCode).toContain("SECOND_NAMESPACE_MARKER");
      expect(secondCode).not.toContain("FIRST_NAMESPACE_MARKER");
      expect(fs.readdirSync(path.join(tmp.dir, ".tailor-sdk/.entries"))).toEqual([]);
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
