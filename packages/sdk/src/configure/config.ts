import type { AuthConfig } from "@/configure/services/auth";
import type { ExecutorServiceInput } from "@/configure/services/executor/types";
import type { IdPConfig } from "@/configure/services/idp";
import type { ResolverServiceInput } from "@/configure/services/resolver/types";
import type { StaticWebsiteConfig } from "@/configure/services/staticwebsite";
import type { TailorDBServiceInput } from "@/configure/services/tailordb/types";
import type { WorkflowServiceInput } from "@/configure/services/workflow/types";
import type { GeneratorConfig } from "@/parser/generator-config/types";
import type { PluginConfig } from "@/parser/plugin-config/types";

export interface AppConfig<
  Auth extends AuthConfig = AuthConfig,
  Idp extends IdPConfig[] = IdPConfig[],
  StaticWebsites extends StaticWebsiteConfig[] = StaticWebsiteConfig[],
  Env extends Record<string, string | number | boolean> = Record<string, string | number | boolean>,
> {
  name: string;
  env?: Env;
  cors?: string[];
  allowedIpAddresses?: string[];
  disableIntrospection?: boolean;
  db?: TailorDBServiceInput;
  resolver?: ResolverServiceInput;
  idp?: Idp;
  auth?: Auth;
  executor?: ExecutorServiceInput;
  workflow?: WorkflowServiceInput;
  staticWebsites?: StaticWebsites;
}

let distPath: string | null = null;
export const getDistDir = (): string => {
  const configured = process.env.TAILOR_SDK_OUTPUT_DIR;
  if (configured && configured !== distPath) {
    distPath = configured;
  } else if (distPath === null) {
    distPath = configured || ".tailor-sdk";
  }
  return distPath;
};

/**
 * Define a Tailor SDK application configuration with shallow exactness.
 * @template Config
 * @param config - Application configuration
 * @returns The same configuration object
 */
export function defineConfig<
  const Config extends AppConfig &
    // type-fest's Exact works recursively and causes type errors, so we use a shallow version here.
    Record<Exclude<keyof Config, keyof AppConfig>, never>,
>(config: Config) {
  return config;
}

/**
 * Define generators to be used with the Tailor SDK.
 * @param configs - Generator configurations
 * @returns Generator configurations as given
 */
export function defineGenerators(...configs: GeneratorConfig[]) {
  return configs;
}

/**
 * Define plugins to be used with the Tailor SDK.
 * Plugins can generate additional types, resolvers, and executors
 * based on existing TailorDB types.
 * @param configs - Plugin configurations
 * @returns Plugin configurations as given
 */
export function definePlugins(...configs: PluginConfig[]) {
  return configs;
}
