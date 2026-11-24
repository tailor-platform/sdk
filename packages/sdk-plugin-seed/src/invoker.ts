import { show } from "@tailor-platform/sdk/cli";
import type { SeedContext } from "@tailor-platform/sdk/cli";

/** The machine user a seed runs as, and the application its temporary resources belong to. */
export interface SeedInvoker {
  invoker: { namespace: string; machineUserName: string };
  appName: string | undefined;
}

interface ResolveSeedInvokerParams {
  context: SeedContext;
  machineUser: string;
  configPath: string | undefined;
  profile: string | undefined;
  workspaceId: string | undefined;
}

/**
 * Resolve the machine user a seed runs as among the config's Auth services, as `<name>` or
 * `<auth>/<name>`. A context that cannot resolve it falls back to the deployed application's Auth service.
 * @param params - Seed context, machine user, and how to reach the deployed application
 * @returns The invoker and the application that owns the seed's temporary resources
 */
export async function resolveSeedInvoker(params: ResolveSeedInvokerParams): Promise<SeedInvoker> {
  const { context, machineUser } = params;
  if (context.resolveMachineUser) {
    return { invoker: context.resolveMachineUser(machineUser), appName: context.appName };
  }
  const appInfo = await show({
    configPath: params.configPath,
    profile: params.profile,
    workspaceId: params.workspaceId,
  });
  return {
    invoker: { namespace: appInfo.auth, machineUserName: machineUser },
    appName: appInfo.name,
  };
}
