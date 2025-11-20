import type { AuthConfig } from "@/configure/services/auth";
import type { ExecutorServiceInput } from "@/configure/services/executor/types";
import type { IdPConfig } from "@/configure/services/idp";
import type { ResolverServiceInput } from "@/configure/services/resolver/types";
import type { StaticWebsiteConfig } from "@/configure/services/staticwebsite";
import type { TailorDBServiceInput } from "@/configure/services/tailordb/types";
import type { GeneratorConfig } from "@/parser/generator-config/types";

export interface AppConfig<
  Auth extends AuthConfig = AuthConfig,
  Idp extends IdPConfig[] = IdPConfig[],
  StaticWebsites extends StaticWebsiteConfig[] = StaticWebsiteConfig[],
> {
  name: string;
  cors?: string[];
  allowedIPAddresses?: string[];
  disableIntrospection?: boolean;
  db?: TailorDBServiceInput;
  resolver?: ResolverServiceInput;
  idp?: Idp;
  auth?: Auth;
  executor?: ExecutorServiceInput;
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

export function defineConfig<
  const Config extends AppConfig &
    // type-fest's Exact works recursively and causes type errors, so we use a shallow version here.
    Record<Exclude<keyof Config, keyof AppConfig>, never>,
>(config: Config) {
  return config;
}

export function defineGenerators(...configs: GeneratorConfig[]) {
  return configs;
}
