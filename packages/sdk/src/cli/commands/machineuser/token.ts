import { arg } from "@politty/zod";
import { z } from "zod";
import {
  deploymentArgs,
  resolveMachineUserInputSource,
  type MachineUserInputSource,
} from "#/cli/shared/args";
import { loadAuthApplication } from "#/cli/shared/auth-applications";
import { fetchMachineUserToken, type OperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { configApplications, machineUserAuths } from "#/cli/shared/config-file";
import { loadConfigFile, type LoadedConfigFile } from "#/cli/shared/config-loader";
import { loadMachineUserName } from "#/cli/shared/context";
import { CLIError } from "#/cli/shared/errors";
import { logger } from "#/cli/shared/logger";
import { resolveMachineUser } from "#/cli/shared/machine-user";
import { loadOperatorWorkspaceContext } from "#/cli/shared/operator-context";
import type { AuthInvokerObject } from "#/types/auth.generated";
import type { Application } from "@tailor-platform/tailor-proto/application_resource_pb";

export interface GetMachineUserTokenOptions {
  name?: string;
  workspaceId?: string;
  profile?: string;
  configPath?: string;
}

type GetMachineUserTokenInternalOptions = GetMachineUserTokenOptions & {
  nameSource?: MachineUserInputSource;
};

export interface MachineUserTokenInfo {
  accessToken: string;
  tokenType: string;
  expiresAt: string;
}

interface TokenTarget {
  /** Application whose URL issues the token. */
  application: Application;
  invoker: AuthInvokerObject;
}

interface ResolveTokenTargetParams {
  client: OperatorClient;
  workspaceId: string;
  loaded: LoadedConfigFile;
  machineUser: string;
}

async function resolveTokenTarget(params: ResolveTokenTargetParams): Promise<TokenTarget> {
  const { client, workspaceId, loaded, machineUser } = params;
  if (loaded.kind === "config") {
    const application = await loadAuthApplication({
      client,
      workspaceId,
      name: loaded.config.name,
    });
    const auth = machineUserAuths(loaded).find(({ name }) => name === application.authNamespace);
    const invoker = resolveMachineUser({
      value: machineUser,
      auths: [{ name: application.authNamespace, machineUsers: auth?.machineUsers }],
    });
    return { application, invoker };
  }

  const invoker = resolveMachineUser({ value: machineUser, auths: machineUserAuths(loaded) });
  const applications = configApplications(loaded);
  const issuer = applications.find(({ authNamespace }) => authNamespace === invoker.namespace);
  if (!issuer) {
    throw CLIError({
      code: "MACHINE_USER_TOKEN_APP_NOT_FOUND",
      message: `No application uses Auth service "${invoker.namespace}" of machine user "${invoker.machineUserName}".`,
      details:
        "A machine user's token is issued through an application that uses its Auth service.",
      suggestion: `Set auth: "${invoker.namespace}" on an application under apps in tailor.config.ts, and deploy it.`,
      context: {
        machineUser: invoker.machineUserName,
        authNamespace: invoker.namespace,
        apps: applications.map(({ name }) => name),
      },
    });
  }
  const application = await loadAuthApplication({ client, workspaceId, name: issuer.name });
  return { application, invoker };
}

async function getMachineUserTokenInternal(
  options: GetMachineUserTokenInternalOptions,
): Promise<MachineUserTokenInfo> {
  // Load and validate options
  const name = await loadMachineUserName({
    machineUser: options.name,
    machineUserSource: options.nameSource,
    profile: options.profile,
  });
  if (!name) {
    throw CLIError({
      code: "MACHINE_USER_REQUIRED",
      message: "Machine user is required.",
      suggestion:
        "Provide the NAME positional argument, set TAILOR_PLATFORM_MACHINE_USER_NAME, or set a profile default with 'tailor profile update <profile> --machine-user <name>'.",
      command: "machineuser token",
    });
  }

  const { client, workspaceId } = await loadOperatorWorkspaceContext({
    profile: options.profile,
    workspaceId: options.workspaceId,
  });
  const loaded = await loadConfigFile(options.configPath);
  const { application, invoker } = await resolveTokenTarget({
    client,
    workspaceId,
    loaded,
    machineUser: name,
  });

  // Get machine user
  const { machineUser } = await client.getAuthMachineUser({
    workspaceId,
    authNamespace: invoker.namespace,
    name: invoker.machineUserName,
  });
  if (!machineUser) {
    throw CLIError({
      code: "MACHINE_USER_NOT_FOUND",
      message: `Machine user ${invoker.machineUserName} not found.`,
    });
  }

  // Fetch machine user token
  const resp = await fetchMachineUserToken(
    application.url,
    machineUser.clientId,
    machineUser.clientSecret,
  );
  const expiresAt = new Date();
  expiresAt.setSeconds(expiresAt.getSeconds() + resp.expires_in);

  return {
    accessToken: resp.access_token,
    tokenType: resp.token_type,
    expiresAt: expiresAt.toISOString(),
  };
}

/**
 * Get a machine user access token for the current application.
 * @param options - Token retrieval options
 * @returns Machine user token info
 */
export async function getMachineUserToken(
  options: GetMachineUserTokenOptions,
): Promise<MachineUserTokenInfo> {
  return await getMachineUserTokenInternal(options);
}

export const tokenCommand = defineAppCommand({
  name: "token",
  description: "Get an access token for a machine user.",
  args: z.strictObject({
    ...deploymentArgs,
    name: arg(z.string().optional(), {
      positional: true,
      description:
        "Machine user name. Falls back to TAILOR_PLATFORM_MACHINE_USER_NAME, then the active profile's default machine user.",
    }),
  }),
  run: async (args) => {
    // Execute machineuser token logic
    const token = await getMachineUserTokenInternal({
      name: args.name,
      nameSource: resolveMachineUserInputSource(args.name, process.argv.slice(2), {
        valueIsExplicit: args.name !== undefined,
      }),
      workspaceId: args["workspace-id"],
      profile: args.profile,
      configPath: args.config,
    });

    // Show machine user token info
    // TODO: remove this transformation
    const tokenInfo = {
      access_token: token.accessToken,
      token_type: token.tokenType,
      expires_at: token.expiresAt,
    };
    logger.out(tokenInfo);
  },
});
