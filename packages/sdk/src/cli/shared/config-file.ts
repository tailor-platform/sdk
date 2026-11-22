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

/** An application a config file deploys, with its Auth service. */
export interface ConfigApplication {
  name: string;
  authNamespace: string | undefined;
}

/**
 * Applications a config file deploys.
 * @param loaded - Loaded config file
 * @returns One application for `defineConfig()`; each `apps` entry for a workspace config
 */
export function configApplications(loaded: LoadedConfigFile): ConfigApplication[] {
  if (loaded.kind === "config") {
    return [{ name: loaded.config.name, authNamespace: loaded.config.auth?.name }];
  }
  return Object.entries(loaded.workspace.apps).map(([name, app]) => ({
    name,
    authNamespace: app.auth,
  }));
}

/**
 * Choose the application a command works on: the one named, or the only one.
 * @param loaded - Loaded config file
 * @param name - Application name from `--app`
 * @returns The application
 */
export function selectApplication(
  loaded: LoadedConfigFile,
  name: string | undefined,
): ConfigApplication {
  const applications = configApplications(loaded);
  const names = applications.map((application) => application.name);
  if (name !== undefined) {
    const application = applications.find((candidate) => candidate.name === name);
    if (application) return application;
    throw CLIError({
      code: "APP_NOT_FOUND",
      message: `Application "${name}" is not defined in the config.`,
      suggestion: `Pass one of the applications to --app: ${names.join(", ")}.`,
      context: { app: name, apps: names },
    });
  }
  const [only, ...others] = applications;
  if (only && others.length === 0) return only;
  throw CLIError({
    code: "APP_REQUIRED",
    message: only
      ? `The config deploys several applications: ${names.join(", ")}.`
      : "The config deploys no application.",
    suggestion: only ? "Pass the application to --app." : "Add an application under apps.",
    context: { apps: names },
  });
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
