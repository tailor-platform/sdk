import { Code, ConnectError } from "@connectrpc/connect";
import { arg } from "@politty/zod";
import { z } from "zod";
import { waitForCloneApplicationData } from "#/cli/commands/tailordb/migrate/test-runtime";
import {
  configArg,
  confirmationArgs,
  formatConfigArg,
  recoveryContextArgs,
} from "#/cli/shared/args";
import { initOperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { loadConfig } from "#/cli/shared/config-loader";
import { loadAccessToken } from "#/cli/shared/context";
import { CLIError, formatCommandHint, internalError } from "#/cli/shared/errors";
import { logger } from "#/cli/shared/logger";
import { printMutationResult } from "#/cli/shared/mutation-result";
import { prompt } from "#/cli/shared/prompt";
import { assertWritable } from "#/cli/shared/readonly-guard";
import {
  cloneWorkspaceArgs,
  formatElapsed,
  hintOnInterrupt,
  reportStatus,
  resumeHint,
} from "./shared";

interface CloneOptions {
  sourceWorkspaceId: string;
  targetWorkspaceId: string;
  name: string;
  config?: string;
  nameFromConfig?: boolean;
  copyFiles?: boolean;
  copyIdpUsers?: boolean;
  noWait?: boolean;
  profile?: string;
}

async function $clone(options: CloneOptions & { yes?: boolean }) {
  const configArg = formatConfigArg(options.config);
  const configArgs = configArg ? [configArg] : [];
  if (options.sourceWorkspaceId === options.targetWorkspaceId) {
    throw CLIError({
      code: "DATA_CLONE_SAME_WORKSPACE",
      message: "The source and target workspaces must be different.",
      command: "data clone",
    });
  }

  const client = await initOperatorClient(await loadAccessToken({ profile: options.profile }));
  try {
    await client.getApplication({
      workspaceId: options.targetWorkspaceId,
      applicationName: options.name,
    });
  } catch (error) {
    if (error instanceof ConnectError && error.code === Code.NotFound) {
      throw CLIError({
        code: "DATA_CLONE_TARGET_APPLICATION_NOT_FOUND",
        message: `Application "${options.name}" was not found in the target workspace "${options.targetWorkspaceId}".`,
        suggestion:
          "Check --to, and deploy the application to the target workspace first so it has the same namespaces and schema.",
        next: {
          command: "tailor",
          args: [
            "deploy",
            ...recoveryContextArgs({
              workspaceId: options.targetWorkspaceId,
              profile: options.profile,
            }),
            ...configArgs,
          ],
        },
        command: "data clone",
        cause: error,
      });
    }
    throw error;
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
    if (error instanceof ConnectError && error.code === Code.FailedPrecondition) {
      throw CLIError({
        code: "DATA_CLONE_PRECONDITION_FAILED",
        message: error.rawMessage,
        suggestion: `A clone needs both workspaces in the same region with the same namespaces, a matching TailorDB schema (deploy the same version to the target first), and an empty target. ${
          options.nameFromConfig
            ? `To empty the target's TailorDB records, run ${formatCommandHint({
                command: "tailor",
                args: [
                  "tailordb",
                  "truncate",
                  "--all",
                  ...recoveryContextArgs({
                    workspaceId: options.targetWorkspaceId,
                    profile: options.profile,
                  }),
                  ...configArgs,
                ],
              })}.`
            : "To empty the target's TailorDB records, run tailor tailordb truncate for the namespaces of this application (see tailor tailordb truncate --help)."
        }`,
        command: "data clone",
        cause: error,
      });
    }
    if (error instanceof ConnectError && error.code === Code.NotFound) {
      throw CLIError({
        code: "DATA_CLONE_NOT_FOUND",
        message: error.rawMessage,
        suggestion:
          "Check that --from and --to are workspace IDs you can access and that the application exists in the source workspace.",
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
  const ref = {
    sourceWorkspaceId: options.sourceWorkspaceId,
    targetWorkspaceId: options.targetWorkspaceId,
    operationId,
    profile: options.profile,
  };
  if (options.noWait) {
    logger.info(`The clone keeps running on the platform. To wait for it: ${resumeHint(ref)}`);
    return { operationId, status: "started" };
  }
  const startedAt = Date.now();
  await hintOnInterrupt(ref, () =>
    waitForCloneApplicationData(client, {
      sourceWorkspaceId: ref.sourceWorkspaceId,
      targetWorkspaceId: ref.targetWorkspaceId,
      operationId,
      timeout: Infinity,
      errorCodePrefix: "DATA_CLONE",
      onStatus: reportStatus,
    }),
  );
  logger.success(
    `Cloned data of application "${options.name}" from "${options.sourceWorkspaceId}" to "${options.targetWorkspaceId}" in ${formatElapsed(Date.now() - startedAt)}`,
  );
  return { operationId, status: "completed" };
}

export const cloneCommand = defineAppCommand({
  name: "clone",
  description:
    "Clone the data of an application (TailorDB namespaces registered in its subgraph) from one workspace to another.",
  notes: `
The platform rejects the clone with a failed precondition unless all of the following hold:
- The source and target workspaces are in the same region.
- The target workspace has the same namespaces as the source.
- The TailorDB schema of the target matches the source, so deploy the same version to the target first.
- The target is empty for every namespace and copy type in scope (TailorDB records, plus files and IdP users when \`--copy-files\` / \`--copy-idp-users\` are given).

The command waits until the clone finishes. Pressing Ctrl+C or passing --no-wait does not stop the clone, which keeps running on the platform. Use \`tailor data operation get --wait\` with the operation ID printed at the start to keep waiting, or without --wait to check the status once.

With --json, the result carries \`status\`: \`completed\` once the clone has finished, or \`started\` with --no-wait.
`,
  args: z.strictObject({
    ...confirmationArgs,
    profile: arg(z.string().optional(), {
      alias: "p",
      description: "Workspace profile",
      env: "TAILOR_PLATFORM_PROFILE",
      completion: { type: "none" },
    }),
    ...cloneWorkspaceArgs,
    name: arg(z.string().optional(), {
      alias: "n",
      description:
        "Application name, the same in the source and the target workspace (default: the name in the config file)",
      completion: { type: "none" },
    }),
    ...configArg,
    "copy-files": arg(z.boolean().default(false), {
      description: "Also copy TailorDB file content",
    }),
    "copy-idp-users": arg(z.boolean().default(false), {
      description: "Also copy IdP users, including their passwords",
    }),
    "no-wait": arg(z.boolean().default(false), {
      description: "Start the clone and exit without waiting for it to finish",
    }),
  }),
  run: async (args) => {
    await assertWritable({ profile: args.profile });
    const name = args.name ?? (await loadConfig(args.config)).config.name;
    const { operationId, status } = await $clone({
      sourceWorkspaceId: args.from,
      targetWorkspaceId: args.to,
      name,
      config: args.config,
      nameFromConfig: args.name === undefined,
      copyFiles: args["copy-files"],
      copyIdpUsers: args["copy-idp-users"],
      noWait: args["no-wait"],
      profile: args.profile,
      yes: args.yes,
    });
    printMutationResult({
      changed: true,
      sourceWorkspaceId: args.from,
      targetWorkspaceId: args.to,
      operationId,
      status,
    });
  },
});
