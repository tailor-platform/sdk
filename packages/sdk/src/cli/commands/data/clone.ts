import { Code, ConnectError } from "@connectrpc/connect";
import { arg } from "@politty/zod";
import { z } from "zod";
import { waitForCloneApplicationData } from "#/cli/commands/tailordb/migrate/test-runtime";
import { confirmationArgs, durationArg, parseDuration } from "#/cli/shared/args";
import { initOperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { loadAccessToken } from "#/cli/shared/context";
import { CLIError, internalError } from "#/cli/shared/errors";
import { logger } from "#/cli/shared/logger";
import { printMutationResult } from "#/cli/shared/mutation-result";
import { prompt } from "#/cli/shared/prompt";
import { assertWritable } from "#/cli/shared/readonly-guard";

interface CloneOptions {
  sourceWorkspaceId: string;
  targetWorkspaceId: string;
  name: string;
  copyFiles?: boolean;
  copyIdpUsers?: boolean;
  timeout?: string;
  profile?: string;
}

async function $clone(options: CloneOptions & { yes?: boolean }) {
  if (options.sourceWorkspaceId === options.targetWorkspaceId) {
    throw CLIError({
      code: "DATA_CLONE_SAME_WORKSPACE",
      message: "The source and target workspaces must be different.",
      command: "data clone",
    });
  }

  if (!options.yes) {
    const confirmation = await prompt.confirm({
      message: `This will copy the data of application "${options.name}" from workspace "${options.sourceWorkspaceId}" to workspace "${options.targetWorkspaceId}". Continue?`,
      default: false,
    });
    if (!confirmation) {
      throw CLIError({ code: "DATA_CLONE_CANCELLED", message: "Data clone cancelled." });
    }
  }

  const client = await initOperatorClient(await loadAccessToken({ profile: options.profile }));
  let operationId: string;
  try {
    const response = await client.cloneApplicationData({
      sourceWorkspaceId: options.sourceWorkspaceId,
      sourceApplicationName: options.name,
      targetWorkspaceId: options.targetWorkspaceId,
      targetApplicationName: options.name,
      copyFiles: options.copyFiles,
      copyIdpUsers: options.copyIdpUsers,
    });
    operationId = response.operationId;
  } catch (error) {
    if (error instanceof ConnectError && error.code === Code.Unimplemented) {
      throw CLIError({
        code: "DATA_CLONE_UNAVAILABLE",
        message: "Application data clone is not enabled for this platform.",
        command: "data clone",
        cause: error,
      });
    }
    throw error;
  }
  if (!operationId) {
    throw internalError("Application data clone returned no operation ID.");
  }
  logger.info(`Clone started (operation: ${operationId})`);
  await waitForCloneApplicationData(client, {
    sourceWorkspaceId: options.sourceWorkspaceId,
    targetWorkspaceId: options.targetWorkspaceId,
    operationId,
    timeout: options.timeout === undefined ? undefined : parseDuration(options.timeout),
    errorCodePrefix: "DATA_CLONE",
  });
  logger.success(
    `Cloned data of application "${options.name}" from "${options.sourceWorkspaceId}" to "${options.targetWorkspaceId}"`,
  );
  return { operationId };
}

export const cloneCommand = defineAppCommand({
  name: "clone",
  description:
    "Clone the data of an application (TailorDB namespaces registered in its subgraph) from one workspace to another.",
  args: z.strictObject({
    ...confirmationArgs,
    profile: arg(z.string().optional(), {
      alias: "p",
      description: "Workspace profile",
      env: "TAILOR_PLATFORM_PROFILE",
      completion: { type: "none" },
    }),
    from: arg(z.string(), {
      description: "Workspace ID to copy data from",
      completion: { type: "none" },
    }),
    to: arg(z.string(), {
      description: "Workspace ID to copy data to",
      completion: { type: "none" },
    }),
    name: arg(z.string(), {
      alias: "n",
      description: "Application name (the same in the source and the target workspace)",
      completion: { type: "none" },
    }),
    "copy-files": arg(z.boolean().default(false), {
      description: "Also copy TailorDB file content",
    }),
    "copy-idp-users": arg(z.boolean().default(false), {
      description: "Also copy IdP users, including their passwords",
    }),
    timeout: arg(durationArg.optional(), {
      description:
        "How long to wait for the clone to finish, e.g. 30s or 10m (default: 5m). The clone keeps running on the platform after the CLI times out.",
      completion: { type: "none" },
    }),
  }),
  run: async (args) => {
    await assertWritable({ profile: args.profile });
    const { operationId } = await $clone({
      sourceWorkspaceId: args.from,
      targetWorkspaceId: args.to,
      name: args.name,
      copyFiles: args["copy-files"],
      copyIdpUsers: args["copy-idp-users"],
      timeout: args.timeout,
      profile: args.profile,
      yes: args.yes,
    });
    printMutationResult({
      changed: true,
      sourceWorkspaceId: args.from,
      targetWorkspaceId: args.to,
      operationId,
    });
  },
});
