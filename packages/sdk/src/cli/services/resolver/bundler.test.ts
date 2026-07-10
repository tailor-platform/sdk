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

  test("injects the auth guard into the entry file", async () => {
    using tmp = tempCwd("sdk-bundler-auth-");
    const resolverDir = path.join(tmp.dir, "src/backend/authcheck/resolver");
    fs.mkdirSync(resolverDir, { recursive: true });
    fs.writeFileSync(
      path.join(resolverDir, "protected.ts"),
      `export default {\n` +
        `  operation: "query",\n` +
        `  name: "protected",\n` +
        `  auth: [{ conditions: [[{ user: "_loggedIn" }, "=", true]], permit: true }],\n` +
        `  body: async () => 1,\n` +
        `  output: { type: "integer", metadata: {}, fields: {} },\n` +
        `};\n`,
    );

    await bundleResolvers("authcheck", {
      files: ["./src/backend/authcheck/resolver/*.ts"],
    });

    const entryContent = fs.readFileSync(
      path.join(tmp.dir, ".tailor-sdk/resolvers/protected.entry.js"),
      "utf-8",
    );

    expect(entryContent).toContain('context.user.type !== ""');
    expect(entryContent).toContain("TailorErrorMessage");
    expect(entryContent).toContain("access denied");
  });

  test("does not inject a guard when auth is omitted or public", async () => {
    using tmp = tempCwd("sdk-bundler-noauth-");
    const resolverDir = path.join(tmp.dir, "src/backend/noauth/resolver");
    fs.mkdirSync(resolverDir, { recursive: true });
    fs.writeFileSync(
      path.join(resolverDir, "open.ts"),
      `export default {\n` +
        `  operation: "query",\n` +
        `  name: "open",\n` +
        `  auth: "public",\n` +
        `  body: async () => 1,\n` +
        `  output: { type: "integer", metadata: {}, fields: {} },\n` +
        `};\n`,
    );

    await bundleResolvers("noauth", {
      files: ["./src/backend/noauth/resolver/*.ts"],
    });

    const entryContent = fs.readFileSync(
      path.join(tmp.dir, ".tailor-sdk/resolvers/open.entry.js"),
      "utf-8",
    );

    expect(entryContent).not.toContain("TailorErrorMessage");
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
