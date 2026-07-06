import { z } from "zod";
import { BUILTIN_COMMAND_NAMES } from "#/cli/shared/builtin-commands";
import { defineAppCommand } from "#/cli/shared/command";
import { logger } from "#/cli/shared/logger";
import { readPackageJson } from "#/cli/shared/package-json";
import { listPlugins } from "#/cli/shared/plugin";
import ml from "#/utils/multiline";

interface PluginListItem {
  name: string;
  source: "node_modules" | "path";
  path: string;
  /** True when a builtin command of the same name shadows this plugin. */
  shadowed: boolean;
}

export const listCommand = defineAppCommand({
  name: "list",
  description:
    "List discovered plugins (executables named `<cli>-<name>` on PATH or node_modules/.bin).",
  args: z.strictObject({}),
  run: async () => {
    const pkg = await readPackageJson();
    const cliName = Object.keys(pkg.bin ?? {})[0] || "tailor";
    const builtins = new Set<string>(BUILTIN_COMMAND_NAMES);

    const plugins = listPlugins(cliName);
    if (plugins.length === 0) {
      logger.info(ml`
        No plugins found.
        Install an executable named "${cliName}-<name>" on your PATH or in node_modules/.bin,
        then run it with "${cliName} <name>".
      `);
      if (logger.jsonMode) {
        logger.out([]);
      }
      return;
    }

    const items: PluginListItem[] = plugins.map((plugin) => ({
      name: plugin.name,
      source: plugin.source,
      path: plugin.path,
      shadowed: builtins.has(plugin.name),
    }));

    logger.out(items);

    for (const item of items) {
      if (item.shadowed) {
        logger.warn(
          `Plugin "${cliName}-${item.name}" is shadowed by the builtin "${cliName} ${item.name}" command and will not be dispatched.`,
        );
      }
    }
  },
});
