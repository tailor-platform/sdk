import { PluginManager } from "#/plugin/manager";
import { extractAllNamespaces, extractOwnedNamespaces } from "./config";
import { CLIError } from "./errors";
import type { ConfigServices } from "#/cli/services/application";
import type { LoadedConfig, LoadedConfigFile, LoadedWorkspaceConfig } from "./config-loader";
import type { MachineUserAuth } from "./machine-user";

/**
 * The config a loaded config file holds, of either kind.
 * @param loaded - Loaded config file
 * @returns The `defineConfig()` config, or the workspace a `defineWorkspace()` or `defineApp()` config describes
 */
export function configOf(loaded: LoadedConfigFile): LoadedConfig | LoadedWorkspaceConfig {
  return loaded.kind === "workspace" ? loaded.workspace : loaded.config;
}

/**
 * TailorDB namespaces a config file declares: for `defineConfig()`, its own and external ones;
 * for a workspace config, every namespace of the workspace.
 * @param loaded - Loaded config file
 * @returns Namespace names in declaration order
 */
export function declaredNamespaces(loaded: LoadedConfigFile): string[] {
  return loaded.kind === "workspace"
    ? Object.keys(loaded.workspace.db)
    : extractAllNamespaces(loaded.config);
}

/**
 * TailorDB namespaces a config file owns: for `defineConfig()`, those not declared external; for a
 * workspace config, every namespace of the workspace.
 * @param loaded - Loaded config file
 * @returns Namespace names in declaration order
 */
export function ownedNamespaces(loaded: LoadedConfigFile): string[] {
  return loaded.kind === "workspace"
    ? Object.keys(loaded.workspace.db)
    : extractOwnedNamespaces(loaded.config);
}

/**
 * Check that a config file declares a TailorDB namespace.
 * @param loaded - Loaded config file
 * @param namespace - Namespace to check
 */
export function assertDeclaredNamespace(loaded: LoadedConfigFile, namespace: string): void {
  const available = declaredNamespaces(loaded);
  if (available.includes(namespace)) return;
  throw CLIError({
    code: "TAILORDB_NAMESPACE_NOT_FOUND",
    message: `TailorDB namespace "${namespace}" is not defined in the config.`,
    suggestion: available.length
      ? `Use one of the namespaces: ${available.join(", ")}.`
      : "Define the namespace under db in tailor.config.ts.",
    context: { namespace, available },
  });
}

type MachineUserConfigs = Readonly<Record<string, unknown>>;

function authMachineUserConfigs(loaded: LoadedConfigFile): Array<{
  name: string;
  machineUsers: MachineUserConfigs | undefined;
}> {
  if (loaded.kind === "workspace") {
    return Object.entries(loaded.workspace.auth).map(([name, auth]) => ({
      name,
      machineUsers: auth.machineUsers ?? {},
    }));
  }
  const { auth } = loaded.config;
  if (!auth) return [];
  if ("external" in auth) return [{ name: auth.name, machineUsers: undefined }];
  return [
    { name: auth.name, machineUsers: "machineUsers" in auth ? (auth.machineUsers ?? {}) : {} },
  ];
}

/**
 * Auth services of a config file with the machine users each defines; an external Auth service's
 * machine users are not known.
 * @param loaded - Loaded config file
 * @returns Auth services in declaration order
 */
export function machineUserAuths(loaded: LoadedConfigFile): MachineUserAuth[] {
  return authMachineUserConfigs(loaded).map(({ name, machineUsers }) => ({
    name,
    machineUsers: machineUsers && Object.keys(machineUsers),
  }));
}

/**
 * The config of a machine user, as its Auth service in the config file defines it.
 * @param loaded - Loaded config file
 * @param authNamespace - Auth service of the machine user
 * @param name - Machine user name
 * @returns The machine user's config, or undefined when the config file does not define it
 */
export function machineUserConfig(
  loaded: LoadedConfigFile,
  authNamespace: string,
  name: string,
): unknown {
  return authMachineUserConfigs(loaded).find((auth) => auth.name === authNamespace)?.machineUsers?.[
    name
  ];
}

/**
 * Define the services of a config file of either kind, without loading or bundling them.
 * @param loaded - Loaded config file
 * @returns The services
 */
export async function defineConfigFileServices(loaded: LoadedConfigFile): Promise<ConfigServices> {
  const services = await import("#/cli/services/application");
  const pluginManager = loaded.plugins.length > 0 ? new PluginManager(loaded.plugins) : undefined;
  if (loaded.kind === "workspace") {
    return services.defineWorkspaceServices({ workspace: loaded.workspace, pluginManager });
  }
  return services.defineApplication({ config: loaded.config, pluginManager });
}
