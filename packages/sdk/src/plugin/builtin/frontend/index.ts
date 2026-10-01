import * as path from "pathe";
import type { Plugin } from "#/plugin/types";
import type { FrontendDefinition } from "./types";

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
