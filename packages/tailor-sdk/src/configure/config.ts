import type { TailorDBServiceInput } from "@/configure/services/tailordb/types";
import type { PipelineResolverServiceInput } from "@/configure/services/pipeline/types";
import type { AuthConfig } from "@/configure/services/auth";
import type { ExecutorServiceInput } from "@/configure/services/executor/types";
import type { StaticWebsiteConfig } from "@/configure/services/staticwebsite";
import type { IdPConfig } from "@/configure/services/idp";
import type { GeneratorConfig } from "@/parser/generator-config/types";

export interface AppConfig<
  Auth extends AuthConfig = AuthConfig,
  Idp extends IdPConfig[] = IdPConfig[],
  StaticWebsites extends StaticWebsiteConfig[] = StaticWebsiteConfig[],
> {
  workspaceId: string;
  name: string;
  cors?: string[];
  allowedIPAddresses?: string[];
  disableIntrospection?: boolean;
  db?: TailorDBServiceInput;
  pipeline?: PipelineResolverServiceInput;
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

export function defineConfig<const Config extends AppConfig>(config: Config) {
  return config;
}

export function defineGenerators(...configs: GeneratorConfig[]) {
  return configs;
}
