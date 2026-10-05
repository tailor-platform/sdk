import * as path from "pathe";
import type { FrontendDefinition } from "./types";
import type { Plugin } from "@tailor-platform/sdk";

export type { FrontendDefinition, FrontendEnvContext } from "./types";

/** Unique identifier for the frontend plugin. */
export const FrontendPluginID = "@tailor-platform/frontend";

type FrontendOutput = { site: string; url: string; skippedFiles: string[] };

/**
 * Build and upload frontend assets after a successful deployment.
 * @param frontends - Frontends to build and upload in order. Each site may appear only once.
 * @returns Plugin that deploys frontends in the supplied order
 */
export function frontendPlugin(
  ...frontends: [FrontendDefinition, ...FrontendDefinition[]]
): Plugin<unknown, FrontendDefinition[]> {
  if (frontends.length === 0) throw new Error("frontendPlugin requires at least one frontend");
  const names = new Set<string>();
  for (const frontend of frontends) {
    const name = typeof frontend.site === "string" ? frontend.site : frontend.site.name;
    if (frontend.distDir.length === 0)
      throw new Error(`distDir must not be empty for site "${name}"`);
    if (frontend.build !== undefined && frontend.build.trim().length === 0)
      throw new Error(
        `build must not be blank for site "${name}"; omit it to publish without building`,
      );
    if (names.has(name)) throw new Error(`Duplicate frontend site "${name}"`);
    names.add(name);
  }
  return {
    id: FrontendPluginID,
    description: "Builds and deploys frontend assets to static websites",
    pluginConfig: frontends,
    async onDeployed(ctx) {
      const frontends: FrontendOutput[] = [];
      for (const def of ctx.pluginConfig) {
        const name = typeof def.site === "string" ? def.site : def.site.name;
        const sites = ctx.application.staticWebsites;
        const site = Object.hasOwn(sites, name) ? sites[name] : undefined;
        if (!site) {
          const owner = ctx.applications.find((app) => Object.hasOwn(app.staticWebsites, name));
          throw new Error(
            owner
              ? `Static website "${name}" is defined in app "${owner.name}", but frontendPlugin is registered in app "${ctx.application.name}"; register it in the config that defines the site`
              : `Static website "${name}" is not declared in the config that registers frontendPlugin (app "${ctx.application.name}"). Available sites: ${Object.keys(sites).join(", ")}`,
          );
        }
        const workingDir = path.resolve(path.dirname(ctx.configPath), def.workingDir ?? ".");
        const distDir = path.resolve(workingDir, def.distDir);
        const env =
          (await def.env?.({
            site,
            application: ctx.application,
            applications: ctx.applications,
            workspaceId: ctx.workspaceId,
          })) ?? {};
        if (def.build) {
          ctx.logger.info(
            `Building frontend for site "${name}": ${def.build} (working directory: ${workingDir})`,
          );
          await ctx.exec(def.build, { workingDir, env });
        }
        const result = await site.publish(distDir);
        if (result.skippedFiles.length > 0) {
          ctx.logger.warn(
            [
              "Deployment completed, but some files failed to upload. These files may have unsupported content types or other validation issues. Please review the list below:",
              ...result.skippedFiles.map((file) => `  - ${file}`),
            ].join("\n"),
          );
        }
        ctx.logger.success(`Frontend deployed to "${name}": ${result.url}`);
        frontends.push({ site: name, url: result.url, skippedFiles: result.skippedFiles });
      }
      return { outputs: { frontends } };
    },
  };
}
