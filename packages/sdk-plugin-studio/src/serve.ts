import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { arg, defineAppCommand, logger, workspaceArgs } from "@tailor-platform/sdk/cli";
import * as path from "pathe";
import { z } from "zod";
import { discoverTab, type TabSpec } from "./discover-tab";
import { createFunctionRunTab } from "./function-run/tab";
import { openBrowser } from "./open-browser";
import { startServer } from "./server";
import { createShellHandler } from "./shell-handler";
import { createWorkspaceContext, listProfiles } from "./workspace-context";

const DEFAULT_PORT = 7777;

const DEFAULT_TABS: readonly TabSpec[] = [
  { id: "tailordb-erd", title: "ERD", packageName: "@tailor-platform/sdk-plugin-tailordb-erd" },
];

const clientDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "client");

export const uiCommand = defineAppCommand({
  name: "studio",
  description: "Serve the local web UI shell that hosts CLI plugin UIs. (beta)",
  args: z.strictObject({
    ...workspaceArgs,
    port: arg(z.coerce.number().int().min(0).max(65535).default(DEFAULT_PORT), {
      description:
        "Preferred local port; the next free port is used when it is taken (0 selects any free port)",
    }),
    open: arg(z.boolean().default(false), {
      description: "Open the UI in the default browser",
    }),
    "function-file": arg(z.string().optional(), {
      description:
        "Existing file the Function run tab edits (default: a scratch function at .tailor/studio/function.ts)",
    }),
    "function-watch": arg(z.boolean().default(false), {
      description:
        "Start the Function run tab's watch as soon as the server is up, against the selected workspace",
    }),
  }),
  run: async (args) => {
    logger.warn(
      "The 'studio' command is a beta feature and may introduce breaking changes in future releases.",
    );
    const projectDir = process.cwd();
    const workspace = createWorkspaceContext({
      initial: {
        ...(args.profile ? { profile: args.profile } : {}),
        ...(args["workspace-id"] ? { workspaceId: args["workspace-id"] } : {}),
      },
      listProfiles: listProfiles,
    });
    const functionRun = await createFunctionRunTab({
      projectDir,
      file: args["function-file"],
      watch: args["function-watch"],
      getSelection: () => workspace.selection(),
      pageFile: path.join(clientDir, "function-run.html"),
    });
    const tabs = [
      ...(await Promise.all(DEFAULT_TABS.map((spec) => discoverTab(spec, projectDir)))),
      functionRun.tab,
    ];
    const token = randomBytes(32).toString("hex");
    const server = await startServer({
      port: args.port,
      createHandler: (port) =>
        createShellHandler({
          tabs,
          port,
          token,
          workspace,
          clientDir,
          onError: (error, pluginId) =>
            logger.error(
              `Plugin "${pluginId}" failed: ${error instanceof Error ? error.message : String(error)}`,
            ),
        }),
    });
    logger.success(`Tailor Studio is running at ${server.url}`);
    logger.info(
      `Function run edits ${functionRun.paths.file} (argument: ${functionRun.paths.argFile})`,
    );
    if (args.open) await openBrowser(server.url);

    await new Promise<void>((resolve) => {
      process.once("SIGINT", resolve);
      process.once("SIGTERM", resolve);
    });
    functionRun.close();
    await server.close();
  },
});
