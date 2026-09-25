import type { Plugin } from "rolldown";

type DepCollectorResult = {
  plugin: Plugin;
  getResult: () => string[];
};

/**
 * Create a rolldown plugin that collects all resolved module paths during a build.
 * The plugin is purely observational and does not modify any code or behavior.
 * Collected paths exclude node_modules and generated entry files.
 * node_modules changes (package upgrades) are not tracked per-bundle;
 * lockfile hash and SDK version changes invalidate the entire cache.
 * @returns An object containing the plugin and a getResult function that returns sorted, deduplicated paths
 */
export function createDepCollectorPlugin(): DepCollectorResult {
  const collectedPaths = new Set<string>();

  const plugin: Plugin = {
    name: "cache-dep-collector",
    load: {
      filter: {
        id: {
          // Match all file types (not just JS/TS) so that JSON, CJS,
          // and other imported files are tracked for cache invalidation.
          include: [/\.[^/]+$/],
        },
      },
      handler(id) {
        if (!id.includes("node_modules") && !id.endsWith(".entry.js")) {
          collectedPaths.add(id);
        }
        return null;
      },
    },
  };

  function getResult(): string[] {
    return Array.from(collectedPaths).toSorted();
  }

  return { plugin, getResult };
}
