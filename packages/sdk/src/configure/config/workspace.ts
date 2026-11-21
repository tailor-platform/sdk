import { brandValue } from "#/utils/brand";
import type { UnknownKeys } from "#/configure/config/index";
import type { AppDefinition, EnvEntry, WorkspaceConfig } from "#/configure/config/types";

/**
 * Define the services a Tailor Platform workspace owns and the applications that expose them.
 * @template Env
 * @template Db
 * @template Resolver
 * @template Auth
 * @template Idp
 * @param config - Workspace configuration
 * @returns A copy of the configuration marked as a workspace configuration
 */
/* @__NO_SIDE_EFFECTS__ */
export function defineWorkspace<
  Env extends Record<string, EnvEntry> = Record<never, never>,
  const Db extends string = never,
  const Resolver extends string = never,
  const Auth extends string = never,
  const Idp extends string = never,
>(
  config: WorkspaceConfig<Env, Db, Resolver, Auth, Idp>,
): WorkspaceConfig<Env, Db, Resolver, Auth, Idp> {
  return brandValue({ ...config }, "workspace-config");
}

/**
 * Define a Tailor Platform workspace that holds a single application.
 * @template Config
 * @param config - Application configuration
 * @returns A copy of the configuration marked as a single-application workspace configuration
 */
/* @__NO_SIDE_EFFECTS__ */
export function defineApp<const Config extends AppDefinition & UnknownKeys<Config, AppDefinition>>(
  config: Config,
): Config {
  return brandValue({ ...config }, "app-config");
}
