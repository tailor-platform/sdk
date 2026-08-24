import { loadTailorDBNamespaces } from "@tailor-platform/sdk/cli";
import { logger } from "@tailor-platform/sdk/cli";
import { z } from "zod";
import { TailorDBErdPluginID } from "./index";
import type { LoadedConfig, Plugin, TailorDBNamespaceData } from "@tailor-platform/sdk/cli";

export interface LoadLocalErdSchemaOptions {
  configPath?: string;
  namespaces?: string[];
  requireErdSite?: boolean;
}

export interface LocalErdSchemaContext {
  config: LoadedConfig;
  /** TailorDB namespace name → static website name, from `tailordbErdPlugin({ sites })`. */
  sites: Record<string, string>;
  namespaces: TailorDBNamespaceData[];
}

// strip: tolerate extra keys from other plugin versions
const ErdPluginConfigSchema = z.object({
  sites: z.record(z.string(), z.string()),
});

interface ErdSiteIssue {
  /** Namespace key of the offending `sites` entry. */
  namespace: string;
  /** Human-readable description of the mismatch. */
  message: string;
}

export interface ResolvedErdSites {
  /** TailorDB namespace name → static website name. */
  sites: Record<string, string>;
  /** Cross-reference issues: unknown namespaces or undefined static websites. */
  issues: ErdSiteIssue[];
}

/**
 * Resolve ERD site mappings from the `tailordbErdPlugin()` instance registered
 * via `definePlugins()`. A duplicate registration or an invalid config shape
 * throws; cross-reference mismatches against `config.db` / `staticWebsites`
 * are reported as issues so callers decide whether they are fatal.
 * @param config - Loaded Tailor config.
 * @param plugins - Plugins registered in the config module.
 * @returns Site mappings (empty when the plugin is not registered) and issues.
 */
export function resolveErdSites(
  config: LoadedConfig,
  plugins: readonly Plugin[] | undefined,
): ResolvedErdSites {
  const instances = (plugins ?? []).filter((plugin) => plugin.id === TailorDBErdPluginID);
  if (instances.length === 0) {
    return { sites: {}, issues: [] };
  }
  if (instances.length > 1) {
    throw new Error("tailordbErdPlugin() is registered more than once in definePlugins().");
  }

  const parsed = ErdPluginConfigSchema.safeParse(instances[0]!.pluginConfig);
  if (!parsed.success) {
    throw new Error(
      'Invalid tailordbErdPlugin() configuration. Expected { sites: { "<namespace>": "<static-website-name>" } }.',
    );
  }

  const issues: ErdSiteIssue[] = [];
  const websiteNames = new Set((config.staticWebsites ?? []).map((website) => website.name));
  for (const [namespace, site] of Object.entries(parsed.data.sites)) {
    const dbConfig = config.db?.[namespace];
    if (!dbConfig || "external" in dbConfig) {
      const available = Object.entries(config.db ?? {})
        .filter(([, candidate]) => !("external" in candidate))
        .map(([name]) => name)
        .join(", ");
      issues.push({
        namespace,
        message:
          `tailordbErdPlugin sites: TailorDB namespace "${namespace}" not found in config.db.` +
          (available ? ` Available owned namespaces: ${available}` : ""),
      });
    } else if (!websiteNames.has(site)) {
      const available = [...websiteNames].join(", ");
      issues.push({
        namespace,
        message:
          `tailordbErdPlugin sites: static website "${site}" (namespace "${namespace}") not found in staticWebsites.` +
          (available ? ` Available static websites: ${available}` : ""),
      });
    }
  }

  return { sites: parsed.data.sites, issues };
}

export interface ResolveLocalErdSchemaNamespacesOptions {
  /** Explicit namespace selection. */
  namespaces?: string[];
  /** Limit implicit selection to namespaces with an ERD site configured. */
  requireErdSite?: boolean;
}

/**
 * Resolve TailorDB namespaces that need local table loading for ERD generation.
 * @param sites - Namespace → static website name mapping from the plugin config.
 * @param options - Namespace selection options.
 * @returns Namespace names to load, or undefined to load all owned namespaces.
 */
export function resolveLocalErdSchemaNamespaces(
  sites: Record<string, string>,
  options: ResolveLocalErdSchemaNamespacesOptions,
): string[] | undefined {
  if (options.namespaces) {
    return options.namespaces;
  }
  if (!options.requireErdSite) {
    return undefined;
  }
  return Object.keys(sites);
}

/**
 * Load local TailorDB namespaces exactly as SDK generation/deploy sees them.
 * @param options - Local schema loading options.
 * @returns Loaded TailorDB namespace data with resolved ERD site mappings.
 */
export async function loadLocalErdSchema(
  options: LoadLocalErdSchemaOptions,
): Promise<LocalErdSchemaContext> {
  let sites: Record<string, string> = {};
  const { config, namespaces } = await loadTailorDBNamespaces({
    configPath: options.configPath,
    namespaces: (loadedConfig, plugins) => {
      const resolved = resolveErdSites(loadedConfig, plugins);
      // Only commands that deploy to the sites need a fatal error, and only
      // for the namespaces the command actually targets; everything else
      // still surfaces the misconfiguration as warnings.
      const fatal = resolved.issues.filter(
        (issue) =>
          options.requireErdSite &&
          (!options.namespaces || options.namespaces.includes(issue.namespace)),
      );
      if (fatal.length > 0) {
        throw new Error(fatal.map((issue) => issue.message).join("\n"));
      }
      for (const issue of resolved.issues) {
        logger.warn(issue.message);
      }
      sites = resolved.sites;
      return resolveLocalErdSchemaNamespaces(sites, {
        namespaces: options.namespaces,
        requireErdSite: options.requireErdSite,
      });
    },
  });
  return { config, sites, namespaces };
}
