import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { resolveTSConfig } from "pkg-types";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { tempCwd } from "#/cli/shared/test-helpers/temp-cwd";
import { bundleResolvers } from "./bundler";
import type * as pkgTypes from "pkg-types";
import type * as rolldown from "rolldown";

let buildTracker: { active: number; maxActive: number } | undefined;
let concurrentBuildBarrier:
  | {
      calls: number;
      secondBuildStarted: Promise<void>;
      resolveFirstBuildStarted: () => void;
      resolveSecondBuildStarted: () => void;
    }
  | undefined;

type RolldownModule = typeof rolldown;
type PkgTypesModule = typeof pkgTypes;

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
        let entry: string;
        if (fs.existsSync(input)) {
          entry = fs.readFileSync(input, "utf8");
        } else {
          const plugins = options.plugins as rolldown.Plugin[];
          const entryPlugin = plugins.find((plugin) => plugin.name === "tailor-virtual-entry");
          if (!entryPlugin || typeof entryPlugin.resolveId !== "function") {
            throw new Error("Virtual entry plugin was not configured");
          }
          const resolveId = entryPlugin.resolveId as unknown as (source: string) => unknown;
          const resolved = await resolveId(input);
          const resolvedId =
            typeof resolved === "string"
              ? resolved
              : resolved &&
                  typeof resolved === "object" &&
                  "id" in resolved &&
                  typeof resolved.id === "string"
                ? resolved.id
                : undefined;
          if (!resolvedId || typeof entryPlugin.load !== "function") {
            throw new Error(`Could not resolve virtual entry ${input}`);
          }
          const load = entryPlugin.load as unknown as (id: string) => unknown;
          const loaded = await load(resolvedId);
          entry =
            typeof loaded === "string"
              ? loaded
              : loaded &&
                  typeof loaded === "object" &&
                  "code" in loaded &&
                  typeof loaded.code === "string"
                ? loaded.code
                : "";
        }
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

vi.mock("pkg-types", async (importOriginal) => {
  const original = await importOriginal<PkgTypesModule>();
  return { ...original, resolveTSConfig: vi.fn(async () => undefined) };
});

describe("bundleResolvers", () => {
  test("does not throw when no resolver files match", async () => {
    using tmp = tempCwd("sdk-bundler-");
    fs.mkdirSync(path.join(tmp.dir, "src/backend/provisioning/resolver"), {
      recursive: true,
    });

    await expect(
      bundleResolvers(
        "provisioning",
        {
          files: ["./src/backend/provisioning/resolver/*.ts"],
        },
        tmp.dir,
      ),
    ).resolves.toEqual(new Map());
  });

  test("injects the permission guard into the entry file", async () => {
    using tmp = tempCwd("sdk-bundler-permission-");
    const resolverDir = path.join(tmp.dir, "src/backend/permissioncheck/resolver");
    fs.mkdirSync(resolverDir, { recursive: true });
    fs.writeFileSync(
      path.join(resolverDir, "protected.ts"),
      `export default {\n` +
        `  operation: "query",\n` +
        `  name: "protected",\n` +
        `  permission: [{ conditions: [[{ user: "_loggedIn" }, "=", true]], permit: true }],\n` +
        `  body: async () => 1,\n` +
        `  output: { type: "integer", metadata: {}, fields: {} },\n` +
        `};\n`,
    );

    const result = await bundleResolvers(
      "permissioncheck",
      { files: ["./src/backend/permissioncheck/resolver/*.ts"] },
      tmp.dir,
    );

    const entryContent = result.get("protected");

    expect(entryContent).toBeDefined();
    expect(entryContent).toContain("caller!==null");
    expect(entryContent).toContain("TailorErrorMessage");
    expect(entryContent).toContain("access denied");
  });

  test("does not inject a guard when permission is omitted or allowAnonymous", async () => {
    using tmp = tempCwd("sdk-bundler-nopermission-");
    const resolverDir = path.join(tmp.dir, "src/backend/nopermission/resolver");
    fs.mkdirSync(resolverDir, { recursive: true });
    fs.writeFileSync(
      path.join(resolverDir, "open.ts"),
      `export default {\n` +
        `  operation: "query",\n` +
        `  name: "open",\n` +
        `  permission: "allowAnonymous",\n` +
        `  body: async () => 1,\n` +
        `  output: { type: "integer", metadata: {}, fields: {} },\n` +
        `};\n`,
    );

    const result = await bundleResolvers(
      "nopermission",
      { files: ["./src/backend/nopermission/resolver/*.ts"] },
      tmp.dir,
    );

    const entryContent = result.get("open");

    expect(entryContent).toBeDefined();
    expect(entryContent).not.toContain("TailorErrorMessage");
  });

  test("resolves tsconfig relative to baseDir, not process.cwd()", async () => {
    using _tmp = tempCwd("sdk-bundler-tsconfig-");
    const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), "sdk-bundler-tsconfig-other-"));
    try {
      const resolverDir = path.join(otherDir, "src/backend/tsconfig-test/resolver");
      fs.mkdirSync(resolverDir, { recursive: true });
      fs.writeFileSync(
        path.join(resolverDir, "resolver.ts"),
        `export default {\n` +
          `  operation: "query",\n` +
          `  name: "tsconfig_resolver",\n` +
          `  body: async () => 1,\n` +
          `  output: { type: "integer", metadata: {}, fields: {} },\n` +
          `};\n`,
      );

      await bundleResolvers(
        "tsconfig-test",
        { files: ["./src/backend/tsconfig-test/resolver/*.ts"] },
        otherDir,
      );

      expect(resolveTSConfig).toHaveBeenCalledWith(otherDir);
    } finally {
      fs.rmSync(otherDir, { recursive: true, force: true });
    }
  });

  test("produces deterministic bundles with inline sourcemaps", async () => {
    using tmp = tempCwd("sdk-bundler-sourcemap-");
    const resolverDir = path.join(tmp.dir, "resolver");
    fs.mkdirSync(resolverDir, { recursive: true });
    fs.writeFileSync(
      path.join(resolverDir, "stable.ts"),
      `export default {\n` +
        `  operation: "query",\n` +
        `  name: "stable",\n` +
        `  body: async () => "STABLE_MARKER",\n` +
        `  output: { type: "string", metadata: {}, fields: {} },\n` +
        `};\n`,
    );

    const build = () =>
      bundleResolvers(
        "deterministic",
        { files: ["./resolver/*.ts"] },
        tmp.dir,
        undefined,
        undefined,
        true,
      );

    const first = await build();
    const second = await build();
    const firstCode = first.get("stable");

    expect(firstCode).toBeDefined();
    expect(firstCode).toBe(second.get("stable"));
  });

  describe("concurrency", () => {
    aroundEach(async (runTest) => {
      await runTest();
      vi.unstubAllEnvs();
      buildTracker = undefined;
      concurrentBuildBarrier = undefined;
    });

    test("isolates entry modules between concurrent namespaces", async () => {
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
        secondBuildStarted,
        resolveFirstBuildStarted,
        resolveSecondBuildStarted,
      };

      const firstBuild = bundleResolvers("first", { files: ["./first/resolver/*.ts"] }, tmp.dir);
      await firstBuildStarted;
      const secondBuild = bundleResolvers("second", { files: ["./second/resolver/*.ts"] }, tmp.dir);

      const [firstBundles, secondBundles] = await Promise.all([firstBuild, secondBuild]);
      const firstCode = firstBundles.get("shared");
      const secondCode = secondBundles.get("shared");

      expect(firstCode).toContain("FIRST_NAMESPACE_MARKER");
      expect(firstCode).not.toContain("SECOND_NAMESPACE_MARKER");
      expect(secondCode).toContain("SECOND_NAMESPACE_MARKER");
      expect(secondCode).not.toContain("FIRST_NAMESPACE_MARKER");
      expect(fs.existsSync(path.join(tmp.dir, ".tailor-sdk/resolvers/shared.entry.js"))).toBe(
        false,
      );
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

      await bundleResolvers(
        "concurrency",
        {
          files: ["./src/backend/concurrency/resolver/*.ts"],
        },
        tmp.dir,
      );

      expect(buildTracker.maxActive).toBeGreaterThan(0);
      expect(buildTracker.maxActive).toBeLessThanOrEqual(2);
    });
  });
});
