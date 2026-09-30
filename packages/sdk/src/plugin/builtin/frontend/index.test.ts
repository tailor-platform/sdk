import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { frontendPlugin } from "./index";
import type { StaticWebsiteConfig } from "#/configure/services/staticwebsite/types";
import type { DeployedContext, PublishStaticWebsiteResult } from "#/plugin/types";
import type { FrontendDefinition, FrontendPluginOptions } from "./types";

const statFailure = vi.hoisted(() => ({ next: undefined as Error | undefined }));
vi.mock(import("node:fs/promises"), async (original) => {
  const actual = await original();
  const stat = (async (...args: Parameters<typeof actual.stat>) => {
    const failure = statFailure.next;
    statFailure.next = undefined;
    if (failure) throw failure;
    return actual.stat(...args);
  }) as typeof actual.stat;
  return { ...actual, stat, default: { ...actual, stat } };
});
function permissionDenied(path: string): Error {
  return Object.assign(new Error(`EACCES: permission denied, stat '${path}'`), { code: "EACCES" });
}
let root: string;
aroundEach(async (runTest) => {
  root = await mkdtemp(join(tmpdir(), "frontend-plugin-"));
  try {
    await runTest();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
function context(options: FrontendPluginOptions) {
  const publish = vi.fn<(site: string, dir: string) => Promise<PublishStaticWebsiteResult>>(
    async () => ({ url: "https://published", skippedFiles: [] }),
  );
  const site = (name: string) => ({
    name,
    url: `https://${name}`,
    publish: (dir: string) => publish(name, dir),
  });
  const application = {
    name: "app",
    configPath: join(root, "apps/backend/tailor.config.ts"),
    url: "https://app",
    domain: "app",
    aiGateways: [],
  };
  const ctx: DeployedContext<FrontendPluginOptions> = {
    workspaceId: "ws",
    application,
    applications: [application],
    staticWebsites: { web: site("web"), admin: site("admin") },
    configPath: application.configPath,
    pluginConfig: options,
    logger: { info: vi.fn(), warn: vi.fn(), success: vi.fn() },
  };
  return { ctx, publish };
}
function setup(frontends: FrontendDefinition[]) {
  const options = { frontends };
  const plugin = frontendPlugin(options);
  const { ctx, publish } = context(options);
  const run = async () => {
    if (!plugin.onDeployed) throw new Error("onDeployed hook missing");
    return plugin.onDeployed(ctx);
  };
  return { ctx, publish, run };
}
describe("frontendPlugin", () => {
  test("accepts only static website definitions or names as site", () => {
    const frontend: FrontendDefinition = {
      // @ts-expect-error a plain object with a name is not a static website definition
      site: { name: "web" },
      distDir: "dist",
    };
    expect(frontend.distDir).toBe("dist");
  });
  test("rejects an empty frontend list", () => {
    expect(() => frontendPlugin({ frontends: [] })).toThrow(/frontends/i);
  });
  test("rejects an empty dist directory", () => {
    expect(() => frontendPlugin({ frontends: [{ site: "web", distDir: "" }] })).toThrow(/distDir/);
  });
  test.each(["", "   "])("rejects a blank build command %j", (build) => {
    expect(() => frontendPlugin({ frontends: [{ site: "web", distDir: "dist", build }] })).toThrow(
      /build/,
    );
  });
  test("rejects duplicate site names across string and object definitions", () => {
    expect(() =>
      frontendPlugin({
        frontends: [
          { site: "web", distDir: "dist" },
          { site: { name: "web" } as StaticWebsiteConfig, distDir: "other" },
        ],
      }),
    ).toThrow(/web/);
  });
  test("builds with awaited environment values in a working directory relative to the config", async () => {
    const cwd = join(root, "apps/web");
    await mkdir(cwd, { recursive: true });
    const { publish, run } = setup([
      {
        site: { name: "web" } as StaticWebsiteConfig,
        workingDir: "../web",
        distDir: "dist",
        env: async ({ site, application, workspaceId, applications, staticWebsites }) => {
          await Promise.resolve();
          return {
            FRONTEND_TEST_VALUE: [
              site.url,
              application.url,
              workspaceId,
              applications.length,
              staticWebsites.admin?.url,
            ].join("|"),
          };
        },
        build: `node -e "const fs=require('node:fs');fs.mkdirSync('dist');fs.writeFileSync('dist/env.txt',process.env.FRONTEND_TEST_VALUE)"`,
      },
    ]);
    await run();
    expect(await readFile(join(cwd, "dist/env.txt"), "utf8")).toBe(
      "https://web|https://app|ws|1|https://admin",
    );
    expect(publish).toHaveBeenCalledExactlyOnceWith("web", join(cwd, "dist"));
  });
  test("reports the command, working directory, and exit code when a build fails", async () => {
    const cwd = join(root, "apps/web");
    await mkdir(cwd, { recursive: true });
    const build = 'node -e "process.exit(7)"';
    const { publish, run } = setup([{ site: "web", workingDir: "../web", distDir: "dist", build }]);
    await expect(run()).rejects.toThrow(
      `Frontend build failed: ${build} (working directory: ${cwd}, exit code: 7)`,
    );
    expect(publish).not.toHaveBeenCalled();
  });
  test("reports the resolved path when the dist directory is absent", async () => {
    const { publish, run } = setup([{ site: "web", distDir: "dist" }]);
    await expect(run()).rejects.toThrow(join(root, "apps/backend/dist"));
    expect(publish).not.toHaveBeenCalled();
  });
  test("rejects a dist path that is a file", async () => {
    const file = join(root, "file");
    await writeFile(file, "data");
    const { publish, run } = setup([{ site: "web", distDir: file }]);
    await expect(run()).rejects.toThrow(file);
    expect(publish).not.toHaveBeenCalled();
  });
  test("lists available sites when the requested site is outside this deploy", async () => {
    const { publish, run } = setup([{ site: "toString", distDir: "dist" }]);
    await expect(run()).rejects.toThrow(/toString.*web, admin/);
    expect(publish).not.toHaveBeenCalled();
  });
  test("uploads existing assets without requiring a build command", async () => {
    const dir = join(root, "apps/backend/dist");
    await mkdir(dir, { recursive: true });
    const { ctx, publish, run } = setup([{ site: "web", distDir: "dist" }]);
    expect(await run()).toEqual({
      outputs: { frontends: [{ site: "web", url: "https://published", skippedFiles: [] }] },
    });
    expect(publish).toHaveBeenCalledExactlyOnceWith("web", dir);
    expect(ctx.logger.info).not.toHaveBeenCalled();
    expect(ctx.logger.success).toHaveBeenCalledWith(
      'Frontend deployed to "web": https://published',
    );
  });
  test("warns about files that were skipped during upload", async () => {
    const { ctx, publish, run } = setup([{ site: "web", distDir: root }]);
    publish.mockResolvedValue({
      url: "https://published",
      skippedFiles: ["bad.bin"],
    });
    await run();
    expect(ctx.logger.warn).toHaveBeenCalledExactlyOnceWith(
      expect.stringMatching(/some files failed to upload.*\n {2}- bad\.bin$/s),
    );
  });
  test("reports stat failures other than a missing dist directory as they are", async () => {
    const { publish, run } = setup([{ site: "web", distDir: root }]);
    statFailure.next = permissionDenied(root);
    await expect(run()).rejects.toThrow("EACCES");
    expect(publish).not.toHaveBeenCalled();
  });
  test("waits for each frontend upload before evaluating the next frontend", async () => {
    const sequence: string[] = [];
    const { publish, run } = setup([
      { site: "web", distDir: root },
      {
        site: "admin",
        distDir: root,
        env: async () => {
          sequence.push("admin env");
          return {};
        },
      },
    ]);
    publish.mockImplementation(async (name) => {
      await Promise.resolve();
      sequence.push(name);
      return { url: "https://published", skippedFiles: [] };
    });
    await run();
    expect(sequence).toEqual(["web", "admin env", "admin"]);
  });
  test("stops before later frontends when an upload fails", async () => {
    const nextEnv = vi.fn();
    const { publish, run } = setup([
      { site: "web", distDir: root },
      { site: "admin", distDir: root, env: nextEnv },
    ]);
    publish.mockRejectedValue(new Error("upload failed"));
    await expect(run()).rejects.toThrow("upload failed");
    expect(nextEnv).not.toHaveBeenCalled();
  });
});

test("keeps frontend build output off the JSON stdout stream", () => {
  const options = {
    frontends: [
      {
        site: "web",
        workingDir: root,
        distDir: root,
        build: `node -e "process.stdout.write('build stdout');process.stderr.write('build stderr')"`,
      },
    ],
  };
  const moduleUrl = pathToFileURL(join(import.meta.dirname, "index.ts")).href;
  const script = `
    import { frontendPlugin } from ${JSON.stringify(moduleUrl)};
    const ctx = ${JSON.stringify(context(options).ctx)};
    ctx.logger = { info() {}, warn() {}, success() {} };
    for (const site of Object.values(ctx.staticWebsites))
      site.publish = async () => ({ url: "https://published", skippedFiles: [] });
    const result = await frontendPlugin(ctx.pluginConfig).onDeployed(ctx);
    process.stdout.write(JSON.stringify(result));
  `;
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", script],
    { encoding: "utf8" },
  );
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    outputs: { frontends: [{ site: "web", url: "https://published", skippedFiles: [] }] },
  });
  expect(result.stderr).toContain("build stdout");
  expect(result.stderr).toContain("build stderr");
});
