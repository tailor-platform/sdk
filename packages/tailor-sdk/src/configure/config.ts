import type { TailorDBServiceInput } from "@/configure/services/tailordb/types";
import type { PipelineResolverServiceInput } from "@/configure/services/pipeline/types";
import type { AuthConfig } from "@/configure/services/auth";
import type { ExecutorServiceInput } from "@/configure/services/executor/types";
import { type IdPServiceInput } from "@/configure/services/idp/types";
import type { StaticWebsiteServiceInput } from "@/configure/services/staticwebsite/types";
import type { GeneratorConfig } from "@/parser/generator-config/types";

export interface AppConfig<Auth extends AuthConfig = AuthConfig> {
  workspaceId: string;
  name: string;
  cors?: string[];
  allowedIPAddresses?: string[];
  disableIntrospection?: boolean;
  db?: TailorDBServiceInput;
  pipeline?: PipelineResolverServiceInput;
  idp?: IdPServiceInput;
  auth?: Auth;
  executor?: ExecutorServiceInput;
  staticWebsites?: Record<string, StaticWebsiteServiceInput>;
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

export function defineConfig<const Config extends AppConfig<any>>(
  config: Config,
) {
  return config;
}

export function defineGenerators(...configs: GeneratorConfig[]) {
  return configs;
}
