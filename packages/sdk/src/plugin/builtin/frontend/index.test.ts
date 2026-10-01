import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { frontendPlugin } from "./index";
import type { StaticWebsiteConfig } from "#/configure/services/staticwebsite/types";
import type {
  DeployedContext,
  PluginExecOptions,
  PluginExecResult,
  PublishStaticWebsiteResult,
} from "#/plugin/types";
import type { FrontendDefinition } from "./types";

let root: string;
aroundEach(async (runTest) => {
  root = await mkdtemp(join(tmpdir(), "frontend-plugin-"));
  try {
    await runTest();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
function context(frontends: FrontendDefinition[]) {
  const publish = vi.fn<(site: string, dir: string) => Promise<PublishStaticWebsiteResult>>(
    async () => ({ url: "https://published", skippedFiles: [] }),
  );
  const site = (name: string, application = "app") => ({
    name,
    url: `https://${name}`,
    application,
    publish: (dir: string) => publish(name, dir),
  });
  const application = {
    name: "app",
    configPath: join(root, "apps/backend/tailor.config.ts"),
    url: "https://app",
    domain: "app",
    aiGateways: [],
  };
  const exec = vi.fn<(command: string, options: PluginExecOptions) => Promise<PluginExecResult>>(
    async () => ({ stdout: "", stderr: "" }),
  );
  const ctx: DeployedContext<FrontendDefinition[]> = {
    workspaceId: "ws",
    application,
    applications: [application],
    staticWebsites: { web: site("web"), admin: site("admin"), other: site("other", "other-app") },
    configPath: application.configPath,
    pluginConfig: frontends,
    logger: { info: vi.fn(), warn: vi.fn(), success: vi.fn() },
    exec,
  };
  return { ctx, publish, exec };
}
function setup(frontends: [FrontendDefinition, ...FrontendDefinition[]]) {
  const plugin = frontendPlugin(...frontends);
  const { ctx, publish, exec } = context(frontends);
  const run = async () => {
    if (!plugin.onDeployed) throw new Error("onDeployed hook missing");
    return plugin.onDeployed(ctx);
  };
  return { ctx, publish, exec, run };
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
  test("requires at least one frontend", () => {
    expect(() => {
      // @ts-expect-error at least one frontend is required
      frontendPlugin();
    }).toThrow(/at least one frontend/);
  });
  test("rejects an empty dist directory", () => {
    expect(() => frontendPlugin({ site: "web", distDir: "" })).toThrow(/distDir/);
  });
  test.each(["", "   "])("rejects a blank build command %j", (build) => {
    expect(() => frontendPlugin({ site: "web", distDir: "dist", build })).toThrow(/build/);
  });
  test("rejects duplicate site names across string and object definitions", () => {
    expect(() =>
      frontendPlugin(
        { site: "web", distDir: "dist" },
        { site: { name: "web" } as StaticWebsiteConfig, distDir: "other" },
      ),
    ).toThrow(/web/);
  });
  test("builds with awaited environment values in a working directory relative to the config", async () => {
    const build = "pnpm build";
    const { publish, exec, run } = setup([
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
        build,
      },
    ]);
    await run();
    expect(exec).toHaveBeenCalledExactlyOnceWith(build, {
      workingDir: join(root, "apps/web"),
      env: { FRONTEND_TEST_VALUE: "https://web|https://app|ws|1|https://admin" },
    });
    expect(publish).toHaveBeenCalledExactlyOnceWith("web", join(root, "apps/web/dist"));
  });
  test("does not publish when the build fails", async () => {
    const { publish, exec, run } = setup([{ site: "web", distDir: "dist", build: "pnpm build" }]);
    exec.mockRejectedValue(new Error("Command failed: pnpm build"));
    await expect(run()).rejects.toThrow("Command failed: pnpm build");
    expect(publish).not.toHaveBeenCalled();
  });
  test("lists available sites when the requested site is outside this deploy", async () => {
    const { publish, run } = setup([{ site: "toString", distDir: "dist" }]);
    await expect(run()).rejects.toThrow(/toString.*web, admin, other/);
    expect(publish).not.toHaveBeenCalled();
  });
  test("rejects a site defined in another application's config before building", async () => {
    const env = vi.fn();
    const { publish, exec, run } = setup([
      { site: "other", distDir: "dist", build: "pnpm build", env },
    ]);
    await expect(run()).rejects.toThrow(
      'Static website "other" is defined in app "other-app", but frontendPlugin is registered in app "app"; register it in the config that defines the site',
    );
    expect(env).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });
  test("uploads existing assets without requiring a build command", async () => {
    const { ctx, publish, exec, run } = setup([{ site: "web", distDir: "dist" }]);
    expect(await run()).toEqual({
      outputs: { frontends: [{ site: "web", url: "https://published", skippedFiles: [] }] },
    });
    expect(publish).toHaveBeenCalledExactlyOnceWith("web", join(root, "apps/backend/dist"));
    expect(exec).not.toHaveBeenCalled();
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
