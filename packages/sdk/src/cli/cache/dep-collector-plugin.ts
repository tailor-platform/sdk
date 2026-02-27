import type { Plugin } from "rolldown";

type DepCollectorResult = {
  plugin: Plugin;
  getResult: () => string[];
};

/**
 * Create a rolldown plugin that collects all resolved module paths during a build.
 * The plugin is purely observational and does not modify any code or behavior.
 * Collected paths exclude node_modules (SDK version handles those separately).
 * @returns An object containing the plugin and a getResult function that returns sorted, deduplicated paths
 */
export function createDepCollectorPlugin(): DepCollectorResult {
  const collectedPaths: Set<string> = new Set();

  const plugin: Plugin = {
    name: "cache-dep-collector",
    load: {
      filter: {
        id: {
          include: [/\.(ts|js|tsx|jsx|mts|mjs)$/],
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
    return Array.from(collectedPaths).sort();
  }

  return { plugin, getResult };
}
