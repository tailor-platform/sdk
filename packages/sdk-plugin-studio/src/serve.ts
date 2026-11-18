import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { arg, defineAppCommand, logger } from "@tailor-platform/sdk/cli";
import open from "open";
import * as path from "pathe";
import { z } from "zod";
import { discoverTab, type TabSpec } from "./discover-tab";
import { startServer } from "./server";
import { createShellHandler } from "./shell-handler";

const DEFAULT_PORT = 7777;

const DEFAULT_TABS: readonly TabSpec[] = [
  { id: "tailordb-erd", title: "ERD", packageName: "@tailor-platform/sdk-plugin-tailordb-erd" },
];

const clientDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "client");

export const uiCommand = defineAppCommand({
  name: "studio",
  description: "Serve the local web UI shell that hosts CLI plugin UIs. (beta)",
  args: z.strictObject({
    port: arg(z.coerce.number().int().min(0).max(65535).default(DEFAULT_PORT), {
      description:
        "Preferred local port; the next free port is used when it is taken (0 selects any free port)",
    }),
    open: arg(z.boolean().default(false), {
      description: "Open the UI in the default browser",
    }),
  }),
  run: async (args) => {
    logger.warn(
      "The 'studio' command is a beta feature and may introduce breaking changes in future releases.",
    );
    const tabs = await Promise.all(DEFAULT_TABS.map((spec) => discoverTab(spec, process.cwd())));
    const token = randomBytes(32).toString("hex");
    const server = await startServer({
      port: args.port,
      createHandler: (port) =>
        createShellHandler({
          tabs,
          port,
          token,
          clientDir,
          onError: (error, pluginId) =>
            logger.error(
              `Plugin "${pluginId}" failed: ${error instanceof Error ? error.message : String(error)}`,
            ),
        }),
    });
    logger.success(`Tailor Studio is running at ${server.url}`);
    if (args.open) await open(server.url);

    await new Promise<void>((resolve) => {
      process.once("SIGINT", resolve);
      process.once("SIGTERM", resolve);
    });
    await server.close();
  },
});
