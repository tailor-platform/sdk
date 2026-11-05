import { findUpSync } from "find-up-simple";
import * as path from "pathe";
import { DEFAULT_CONFIG_PATH } from "#/cli/shared/args";
import { loadConfig } from "#/cli/shared/config-loader";
import { loadConfigNamespaces } from "#/cli/shared/tailordb-namespaces";
import { beginUserModuleRun } from "#/cli/shared/user-modules";
import { buildRecordMeta } from "./crud";
import {
  renderResolverModule,
  renderTailorDBModule,
  RESOLVERS_FILE,
  TAILORDB_FILE,
} from "./module";
import { buildResolverOperation } from "./operation";
import { listResolvers, type ResolverEntry } from "./resolvers";
import { listTailorDBTypes, type TailorDBEntry } from "./tailordb-types";

/** Options of {@link tailorResolvers}. */
export interface TailorResolversOptions {
  /** Base URL of the application, used when the app does not call `configureResolvers`. */
  url?: string;
  /** Path to `tailor.config.ts`. Defaults to the nearest one above the importing file. */
  config?: string;
}

/** The Vite plugin returned by {@link tailorResolvers}. */
export interface ResolverClientPlugin {
  name: string;
  enforce: "pre";
  load(this: { addWatchFile(file: string): void }, id: string): Promise<string | undefined>;
}

interface ProjectEntries {
  resolvers: ResolverEntry[];
  tailordb: TailorDBEntry[];
}

async function loadProjectEntries(configPath: string): Promise<ProjectEntries> {
  const cwd = process.cwd();
  const configDir = path.dirname(configPath);
  try {
    if (cwd !== configDir) process.chdir(configDir);
    beginUserModuleRun();
    const { config, plugins } = await loadConfig(configPath);
    const { application, namespaces } = await loadConfigNamespaces(config, plugins);
    return {
      resolvers: await listResolvers(application),
      tailordb: listTailorDBTypes(namespaces),
    };
  } finally {
    if (process.cwd() !== cwd) process.chdir(cwd);
  }
}

function findConfig(options: TailorResolversOptions, fromDir: string): string {
  const configPath = options.config ?? findUpSync(DEFAULT_CONFIG_PATH, { cwd: fromDir });
  if (!configPath) {
    throw new Error(`No ${DEFAULT_CONFIG_PATH} found in ${fromDir} or its parent directories`);
  }
  return path.resolve(configPath);
}

/**
 * Create the Vite plugin that turns an imported `resolvers.tailor` into
 * functions calling the resolvers of the project's `tailor.config.ts`, and an
 * imported `tailordb.tailor` into the record operations of its TailorDB types.
 * @param options - The application's URL and the config to read
 * @returns The Vite plugin
 */
export function tailorResolvers(options: TailorResolversOptions = {}): ResolverClientPlugin {
  return {
    name: "tailor-resolvers",
    enforce: "pre",
    async load(id) {
      const file = id.split("?")[0] ?? id;
      const fileName = path.basename(file);
      if (fileName !== RESOLVERS_FILE && fileName !== TAILORDB_FILE) return undefined;

      const configPath = findConfig(options, path.dirname(file));
      const { resolvers, tailordb } = await loadProjectEntries(configPath);
      this.addWatchFile(configPath);

      if (fileName === TAILORDB_FILE) {
        for (const entry of tailordb) this.addWatchFile(entry.file);
        const types = Object.fromEntries(tailordb.map((entry) => [entry.name, entry.type]));
        return renderTailorDBModule({
          types: tailordb.map((entry) => ({
            name: entry.name,
            meta: buildRecordMeta(entry.type, types),
          })),
          url: options.url,
        });
      }

      for (const entry of resolvers) this.addWatchFile(entry.file);
      return renderResolverModule({
        operations: resolvers.map((entry) => buildResolverOperation(entry.resolver)),
        url: options.url,
      });
    },
  };
}
