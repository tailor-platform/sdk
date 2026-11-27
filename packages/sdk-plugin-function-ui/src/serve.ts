import { arg, defineAppCommand, logger, workspaceArgs } from "@tailor-platform/sdk/cli";
import { startServer } from "@tailor-platform/shared/local-server";
import { guardRequest } from "@tailor-platform/shared/request-guard";
import { z } from "zod";
import { createFunctionRun } from "./function-run";
import { openBrowser } from "./open-browser";

const DEFAULT_PORT = 7778;

export const functionUiCommand = defineAppCommand({
  name: "tailor-function-ui",
  description: "Run a function from the browser: edit it and its argument and see each run. (beta)",
  args: z.strictObject({
    file: arg(z.string().optional(), {
      positional: true,
      description:
        "Existing function file to edit (default: a scratch function at .tailor/studio/function.ts)",
      completion: { type: "file", extensions: ["ts", "js"] },
    }),
    profile: workspaceArgs.profile,
    "workspace-id": workspaceArgs["workspace-id"],
    port: arg(z.coerce.number().int().min(0).max(65535).default(DEFAULT_PORT), {
      description:
        "Preferred local port; the next free port is used when it is taken (0 selects any free port)",
    }),
    open: arg(z.boolean().default(false), {
      description: "Open the UI in the default browser",
    }),
    watch: arg(z.boolean().default(false), {
      description: "Start the watch as soon as the server is up instead of waiting for Run",
    }),
  }),
  gracefulShutdown: true,
  run: async (args) => {
    const stopRequested = new Promise<void>((resolve) => {
      args.$signal?.addEventListener("abort", () => resolve(), { once: true });
    });
    logger.warn(
      "The 'function-ui' command is a beta feature and may introduce breaking changes in future releases.",
    );
    const selection = args.profile
      ? { profile: args.profile }
      : args["workspace-id"]
        ? { workspaceId: args["workspace-id"] }
        : {};
    if (!args.profile && !args["workspace-id"]) {
      logger.warn("No workspace selected. Pass --profile or --workspace-id to run the function.");
    }
    const functionRun = await createFunctionRun({
      projectDir: process.cwd(),
      file: args.file,
      watch: args.watch,
      getSelection: () => selection,
      onSelectionChange: () => () => {},
    });
    const server = await startServer({
      port: args.port,
      createHandler: (port) => (request) =>
        guardRequest(request, { port }) ?? functionRun.handler(request),
    });
    logger.success(`Function run is at ${server.url}`);
    logger.info(
      `Edits ${functionRun.paths.file} (argument: ${functionRun.paths.argFile}, result: ${functionRun.paths.resultFile})`,
    );
    if (args.open) await openBrowser(server.url);

    await stopRequested;
    functionRun.close();
    await server.close();
  },
});
