import { fileURLToPath } from "node:url";
import { createFunctionRun } from "@tailor-platform/sdk-plugin-function-ui";
import {
  arg,
  defineAppCommand,
  logger,
  platformConfigFromEnv,
  workspaceArgs,
} from "@tailor-platform/sdk/cli";
import { startServer } from "@tailor-platform/shared/local-server";
import * as path from "pathe";
import { z } from "zod";
import { createAccounts } from "./accounts";
import { discoverTab, type TabSpec } from "./discover-tab";
import { openBrowser } from "./open-browser";
import { createSelectionStore, projectDirectory } from "./selection-store";
import { createShellHandler } from "./shell-handler";
import { createWorkspaceContext, listProfiles } from "./workspace-context";

const DEFAULT_PORT = 7777;

const DEFAULT_TABS: readonly TabSpec[] = [
  { id: "tailordb-erd", title: "ERD", packageName: "@tailor-platform/sdk-plugin-tailordb-erd" },
];

const clientDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "client");

export const uiCommand = defineAppCommand({
  name: "tailor-studio",
  description: "Serve the local web UI shell that hosts CLI plugin UIs. (beta)",
  args: z.strictObject({
    profile: workspaceArgs.profile,
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
  gracefulShutdown: true,
  run: async (args) => {
    const stopRequested = new Promise<void>((resolve) => {
      args.$signal?.addEventListener("abort", () => resolve(), { once: true });
    });
    logger.warn(
      "The 'studio' command is a beta feature and may introduce breaking changes in future releases.",
    );
    const projectDir = projectDirectory(process.env, process.cwd());
    const platform = platformConfigFromEnv();
    const workspace = createWorkspaceContext({
      ...(args.profile ? { initialProfile: args.profile } : {}),
      listProfiles: listProfiles,
      store: createSelectionStore(projectDir),
      onListenerError: (error) =>
        logger.error(
          `A selection listener failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
    });
    await workspace.restore();
    const functionRun = await createFunctionRun({
      projectDir,
      file: args["function-file"],
      watch: args["function-watch"],
      getSelection: () => workspace.selection(),
      onSelectionChange: (listener) => workspace.subscribe(listener),
    });
    const tabs = [
      ...(await Promise.all(DEFAULT_TABS.map((spec) => discoverTab(spec, projectDir)))),
      {
        id: "function-run",
        title: "Function run",
        state: "mounted" as const,
        handler: functionRun.handler,
      },
    ];
    const server = await startServer({
      port: args.port,
      createHandler: (port) =>
        createShellHandler({
          tabs,
          port,
          workspace,
          accounts: createAccounts(platform),
          ...(platform === undefined ? {} : { platform }),
          clientDir,
          onError: (error, pluginId) =>
            logger.error(
              `Plugin "${pluginId}" failed: ${error instanceof Error ? error.message : String(error)}`,
            ),
        }),
    });
    logger.success(`Tailor Studio is running at ${server.url}`);
    logger.info(
      `Function run edits ${functionRun.paths.file} (argument: ${functionRun.paths.argFile}, result: ${functionRun.paths.resultFile})`,
    );
    if (args.open) await openBrowser(server.url);

    await stopRequested;
    functionRun.close();
    await server.close();
  },
});
