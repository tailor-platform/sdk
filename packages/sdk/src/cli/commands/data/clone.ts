import { arg } from "@politty/zod";
import { CloneOperationStatus } from "@tailor-platform/tailor-proto/application_pb";
import { z } from "zod";
import { confirmationArgs } from "#/cli/shared/args";
import { initOperatorClient, type OperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { loadAccessToken } from "#/cli/shared/context";
import { CLIError } from "#/cli/shared/errors";
import { logger } from "#/cli/shared/logger";
import { printMutationResult } from "#/cli/shared/mutation-result";
import { prompt } from "#/cli/shared/prompt";
import { assertWritable } from "#/cli/shared/readonly-guard";

const POLL_INTERVAL_MS = 2000;

interface CloneOptions {
  sourceWorkspaceId: string;
  targetWorkspaceId: string;
  name: string;
  copyFiles?: boolean;
  copyIdpUsers?: boolean;
  profile?: string;
}

async function waitForClone(
  client: OperatorClient,
  options: { sourceWorkspaceId: string; targetWorkspaceId: string; operationId: string },
): Promise<void> {
  for (;;) {
    const operation = await client.getCloneApplicationDataOperation(options);
    if (operation.status === CloneOperationStatus.COMPLETED) return;
    if (operation.status === CloneOperationStatus.FAILED) {
      throw CLIError({
        code: "DATA_CLONE_FAILED",
        message: `Data clone failed: ${operation.errorMessage}`,
        command: "data clone",
      });
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
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
  const { operationId } = await client.cloneApplicationData({
    sourceWorkspaceId: options.sourceWorkspaceId,
    sourceApplicationName: options.name,
    targetWorkspaceId: options.targetWorkspaceId,
    targetApplicationName: options.name,
    copyFiles: options.copyFiles,
    copyIdpUsers: options.copyIdpUsers,
  });
  logger.info(`Clone started (operation: ${operationId})`);
  await waitForClone(client, {
    sourceWorkspaceId: options.sourceWorkspaceId,
    targetWorkspaceId: options.targetWorkspaceId,
    operationId,
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
  }),
  run: async (args) => {
    await assertWritable({ profile: args.profile });
    const { operationId } = await $clone({
      sourceWorkspaceId: args.from,
      targetWorkspaceId: args.to,
      name: args.name,
      copyFiles: args["copy-files"],
      copyIdpUsers: args["copy-idp-users"],
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
