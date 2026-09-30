import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import * as path from "pathe";
import type { Plugin } from "#/plugin/types";
import type { FrontendPluginOptions } from "./types";

export type { FrontendDefinition, FrontendEnvContext, FrontendPluginOptions } from "./types";

/** Unique identifier for the frontend plugin. */
export const FrontendPluginID = "@tailor-platform/frontend";

type FrontendOutput = { site: string; url: string; skippedFiles: string[] };

interface BuildParams {
  command: string;
  workingDir: string;
  env: Record<string, string>;
}

async function buildFrontend(params: BuildParams): Promise<void> {
  const { command, workingDir, env } = params;
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      cwd: workingDir,
      env: { ...process.env, ...env },
      stdio: ["ignore", process.stderr, process.stderr],
    });
    child.once("error", (error) => {
      reject(
        new Error(
          `Failed to start frontend build: ${command} (working directory: ${workingDir}): ${error.message}`,
          {
            cause: error,
          },
        ),
      );
    });
    child.once("close", (code, signal) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `Frontend build failed: ${command} (working directory: ${workingDir}, exit code: ${code}${signal ? `, signal: ${signal}` : ""})`,
          ),
        );
    });
  });
}

/**
 * Build and upload frontend assets after a successful deployment.
 * @param options - Frontends and their build settings
 * @returns Plugin that deploys frontends in the supplied order
 */
export function frontendPlugin(
  options: FrontendPluginOptions,
): Plugin<unknown, FrontendPluginOptions> {
  if (options.frontends.length === 0)
    throw new Error("frontends must contain at least one frontend");
  const names = new Set<string>();
  for (const frontend of options.frontends) {
    const name = typeof frontend.site === "string" ? frontend.site : frontend.site.name;
    if (frontend.distDir.length === 0)
      throw new Error(`distDir must not be empty for site "${name}"`);
    if (names.has(name)) throw new Error(`Duplicate frontend site "${name}"`);
    names.add(name);
  }
  return {
    id: FrontendPluginID,
    description: "Builds and deploys frontend assets to static websites",
    pluginConfig: options,
    async onDeployed(ctx) {
      const frontends: FrontendOutput[] = [];
      for (const def of ctx.pluginConfig.frontends) {
        const name = typeof def.site === "string" ? def.site : def.site.name;
        const site = Object.hasOwn(ctx.staticWebsites, name) ? ctx.staticWebsites[name] : undefined;
        if (!site)
          throw new Error(
            `Static website "${name}" is not included in this deploy. Available sites: ${Object.keys(ctx.staticWebsites).join(", ")}`,
          );
        const workingDir = path.resolve(path.dirname(ctx.configPath), def.workingDir ?? ".");
        const distDir = path.resolve(workingDir, def.distDir);
        const env =
          (await def.env?.({
            site,
            application: ctx.application,
            applications: ctx.applications,
            staticWebsites: ctx.staticWebsites,
            workspaceId: ctx.workspaceId,
          })) ?? {};
        if (def.build) {
          ctx.logger.info(
            `Building frontend for site "${name}": ${def.build} (working directory: ${workingDir})`,
          );
          await buildFrontend({ command: def.build, workingDir, env });
        }
        const info = await stat(distDir).catch(() => undefined);
        if (!info?.isDirectory())
          throw new Error(
            `Frontend dist directory does not exist or is not a directory: ${distDir}`,
          );
        const result = await site.publish(distDir);
        if (result.skippedFiles.length > 0) {
          ctx.logger.warn(
            "Deployment completed, but some files failed to upload. These files may have unsupported content types or other validation issues. Please review the list below:",
          );
          for (const file of result.skippedFiles) ctx.logger.warn(`  - ${file}`);
        }
        ctx.logger.success(`Frontend deployed to "${name}": ${result.url}`);
        frontends.push({ site: name, url: result.url, skippedFiles: result.skippedFiles });
      }
      return { outputs: { frontends } };
    },
  };
}
