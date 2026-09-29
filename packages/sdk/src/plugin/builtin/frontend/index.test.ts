import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { frontendPlugin } from "./index";
import type { DeployedContext } from "#/plugin/types";
import type { FrontendDefinition, FrontendPluginOptions } from "./types";

let root: string;
aroundEach(async (runTest) => {
  root = await mkdtemp(join(tmpdir(), "frontend-plugin-"));
  try {
    await runTest();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
function context(options: FrontendPluginOptions): DeployedContext<FrontendPluginOptions> {
  const application = {
    name: "app",
    configPath: join(root, "apps/backend/tailor.config.ts"),
    url: "https://app",
    domain: "app",
    staticWebsites: [{ name: "web", url: "https://web" }],
    aiGateways: [],
  };
  return {
    workspaceId: "ws",
    application,
    applications: [application],
    staticWebsites: {
      web: { name: "web", url: "https://web" },
      admin: { name: "admin", url: "https://admin" },
    },
    configPath: application.configPath,
    pluginConfig: options,
    logger: { info: vi.fn(), warn: vi.fn(), success: vi.fn() },
    uploadStaticWebsite: vi.fn().mockResolvedValue({ url: "https://published", skippedFiles: [] }),
  };
}
function setup(frontends: FrontendDefinition[]) {
  const options = { frontends };
  const plugin = frontendPlugin(options);
  const ctx = context(options);
  const run = async () => {
    if (!plugin.onDeployed) throw new Error("onDeployed hook missing");
    return plugin.onDeployed(ctx);
  };
  return { ctx, run };
}
describe("frontendPlugin", () => {
  test("rejects an empty frontend list", () => {
    expect(() => frontendPlugin({ frontends: [] })).toThrow(/frontends/i);
  });
  test("rejects an empty output directory", () => {
    expect(() => frontendPlugin({ frontends: [{ site: "web", outDir: "" }] })).toThrow(/outDir/);
  });
  test("rejects duplicate site names across string and object definitions", () => {
    expect(() =>
      frontendPlugin({
        frontends: [
          { site: "web", outDir: "dist" },
          { site: { name: "web" }, outDir: "other" },
        ],
      }),
    ).toThrow(/web/);
  });
  test("builds with awaited environment values in a cwd relative to the config", async () => {
    const cwd = join(root, "apps/web");
    await mkdir(cwd, { recursive: true });
    const { ctx, run } = setup([
      {
        site: { name: "web" },
        cwd: "../web",
        outDir: "dist",
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
    expect(ctx.uploadStaticWebsite).toHaveBeenCalledExactlyOnceWith({
      name: "web",
      dir: join(cwd, "dist"),
    });
  });
  test("reports the command, cwd, and exit code when a build fails", async () => {
    const cwd = join(root, "apps/web");
    await mkdir(cwd, { recursive: true });
    const build = 'node -e "process.exit(7)"';
    const { ctx, run } = setup([{ site: "web", cwd: "../web", outDir: "dist", build }]);
    await expect(run()).rejects.toThrow(
      `Frontend build failed: ${build} (cwd: ${cwd}, exit code: 7)`,
    );
    expect(ctx.uploadStaticWebsite).not.toHaveBeenCalled();
  });
  test("reports the resolved path when the output directory is absent", async () => {
    const { ctx, run } = setup([{ site: "web", outDir: "dist" }]);
    await expect(run()).rejects.toThrow(join(root, "apps/backend/dist"));
    expect(ctx.uploadStaticWebsite).not.toHaveBeenCalled();
  });
  test("rejects an output path that is a file", async () => {
    const file = join(root, "file");
    await writeFile(file, "data");
    const { ctx, run } = setup([{ site: "web", outDir: file }]);
    await expect(run()).rejects.toThrow(file);
    expect(ctx.uploadStaticWebsite).not.toHaveBeenCalled();
  });
  test("lists available sites when the requested site is outside this deploy", async () => {
    const { ctx, run } = setup([{ site: "toString", outDir: "dist" }]);
    await expect(run()).rejects.toThrow(/toString.*web, admin/);
    expect(ctx.uploadStaticWebsite).not.toHaveBeenCalled();
  });
  test("uploads existing assets without requiring a build command", async () => {
    const dir = join(root, "apps/backend/dist");
    await mkdir(dir, { recursive: true });
    const { ctx, run } = setup([{ site: "web", outDir: "dist" }]);
    expect(await run()).toEqual({
      outputs: { frontends: [{ site: "web", url: "https://published", skippedFiles: [] }] },
    });
    expect(ctx.uploadStaticWebsite).toHaveBeenCalledExactlyOnceWith({ name: "web", dir });
    expect(ctx.logger.info).not.toHaveBeenCalled();
    expect(ctx.logger.success).toHaveBeenCalledWith(
      'Frontend deployed to "web": https://published',
    );
  });
  test("warns about files that were skipped during upload", async () => {
    const { ctx, run } = setup([{ site: "web", outDir: root }]);
    vi.mocked(ctx.uploadStaticWebsite).mockResolvedValue({
      url: "https://published",
      skippedFiles: ["bad.bin"],
    });
    await run();
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("some files failed to upload"),
    );
    expect(ctx.logger.warn).toHaveBeenCalledWith("  - bad.bin");
  });
  test("waits for each frontend upload before evaluating the next frontend", async () => {
    const sequence: string[] = [];
    const { ctx, run } = setup([
      { site: "web", outDir: root },
      {
        site: "admin",
        outDir: root,
        env: async () => {
          sequence.push("admin env");
          return {};
        },
      },
    ]);
    vi.mocked(ctx.uploadStaticWebsite).mockImplementation(async ({ name }) => {
      await Promise.resolve();
      sequence.push(name);
      return { url: "https://published", skippedFiles: [] };
    });
    await run();
    expect(sequence).toEqual(["web", "admin env", "admin"]);
  });
  test("stops before later frontends when an upload fails", async () => {
    const nextEnv = vi.fn();
    const { ctx, run } = setup([
      { site: "web", outDir: root },
      { site: "admin", outDir: root, env: nextEnv },
    ]);
    vi.mocked(ctx.uploadStaticWebsite).mockRejectedValue(new Error("upload failed"));
    await expect(run()).rejects.toThrow("upload failed");
    expect(nextEnv).not.toHaveBeenCalled();
  });
});

test("keeps frontend build output off the JSON stdout stream", () => {
  const options = {
    frontends: [
      {
        site: "web",
        cwd: root,
        outDir: root,
        build: `node -e "process.stdout.write('build stdout');process.stderr.write('build stderr')"`,
      },
    ],
  };
  const moduleUrl = pathToFileURL(join(import.meta.dirname, "index.ts")).href;
  const script = `
    import { frontendPlugin } from ${JSON.stringify(moduleUrl)};
    const ctx = ${JSON.stringify(context(options))};
    ctx.logger = { info() {}, warn() {}, success() {} };
    ctx.uploadStaticWebsite = async () => ({ url: "https://published", skippedFiles: [] });
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
