import { loadConfigFile, type LoadedConfig } from "./config-loader";
import { CLIError } from "./errors";
import { atUserModule } from "./validation-errors";
import type { AuthOwnConfig } from "#/configure/services/auth/types";

/** An application a config deploys, with what commands read about it. */
export interface ConfigApplication {
  name: string;
  /** OAuth2 clients the application's auth service defines, in config order. */
  oauth2ClientNames: string[];
  /** TailorDB namespaces the application exposes; `undefined` for a `defineConfig()` config. */
  tailordbNamespaces: string[] | undefined;
}

/** The applications of a config of either kind, with the services the workspace shares. */
export interface ConfigApplications {
  path: string;
  applications: ConfigApplication[];
  aiGatewayNames: string[];
  staticWebsiteNames: string[];
}

function uniqueNames(entries: ReadonlyArray<{ name: string }> | undefined): string[] {
  return [...new Set((entries ?? []).map((entry) => entry.name))];
}

function oauth2ClientNamesOf(auth: LoadedConfig["auth"] | AuthOwnConfig | undefined): string[] {
  if (!auth || "external" in auth) return [];
  return Object.keys(auth.oauth2Clients ?? {});
}

/**
 * Load a config of any kind and list the applications it deploys.
 * @param configPath - Optional explicit config path
 * @returns The loaded config and its applications, in config order
 */
export async function loadConfigApplications(configPath?: string): Promise<ConfigApplications> {
  const file = await loadConfigFile(configPath);
  if (file.kind === "config") {
    const { config } = file;
    return {
      path: config.path,
      applications: [
        {
          name: config.name,
          oauth2ClientNames: oauth2ClientNamesOf(config.auth),
          tailordbNamespaces: undefined,
        },
      ],
      aiGatewayNames: uniqueNames(config.aiGateways),
      staticWebsiteNames: uniqueNames(config.staticWebsites),
    };
  }
  const { workspace } = file;
  return {
    path: workspace.path,
    applications: Object.entries(workspace.apps).map(([name, app]) => ({
      name,
      oauth2ClientNames:
        app.auth === undefined ? [] : oauth2ClientNamesOf(workspace.auth[app.auth]),
      tailordbNamespaces: app.db,
    })),
    aiGatewayNames: uniqueNames(workspace.aiGateways),
    staticWebsiteNames: uniqueNames(workspace.staticWebsites),
  };
}

function applicationList(applications: ReadonlyArray<ConfigApplication>): string {
  return applications.map(({ name }) => name).join(", ");
}

/**
 * Pick the application a command names, or the only one the config defines.
 * @param config - Applications of the loaded config
 * @param name - Application name the command was given
 * @returns The application, or `undefined` when no name was given and the config defines several or none
 */
export function selectApplication(
  config: ConfigApplications,
  name: string | undefined,
): ConfigApplication | undefined {
  const { applications } = config;
  if (name === undefined) {
    return applications.length === 1 ? applications[0] : undefined;
  }
  const application = applications.find((candidate) => candidate.name === name);
  if (application) return application;
  throw atUserModule(
    CLIError({
      code: "CONFIG_APP_NOT_FOUND",
      message: `Application "${name}" is not defined in the config.`,
      suggestion:
        applications.length === 0
          ? "The config defines no application."
          : `Name one of the applications the config defines: ${applicationList(applications)}.`,
      context: { app: name, applications: applications.map((application) => application.name) },
    }),
    config.path,
  );
}

/** Inputs to {@link requireApplication}. */
export interface RequireApplicationParams {
  config: ConfigApplications;
  /** Application name the command was given. */
  name: string | undefined;
  /** How the caller names an application, such as `--name <application>`. */
  option: string;
}

/**
 * Pick the application a command names, or the only one the config defines, and fail when that
 * leaves no single application.
 * @param params - The loaded applications, the name given, and how to give one
 * @returns The application
 */
export function requireApplication(params: RequireApplicationParams): ConfigApplication {
  const { config, name, option } = params;
  const application = selectApplication(config, name);
  if (application) return application;
  const { applications } = config;
  throw atUserModule(
    CLIError({
      code: "CONFIG_APP_REQUIRED",
      message:
        applications.length === 0
          ? "The config defines no application."
          : `The config defines several applications: ${applicationList(applications)}.`,
      suggestion: `Choose the application with ${option}.`,
      context: { applications: applications.map((application) => application.name) },
    }),
    config.path,
  );
}
