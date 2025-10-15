import type { TailorDBServiceInput } from "@/configure/services/tailordb/types";
import type { PipelineResolverServiceInput } from "@/configure/services/pipeline/types";
import type { AuthConfig } from "@/configure/services/auth";
import type { ExecutorServiceInput } from "@/configure/services/executor/types";
import { type IdPServiceInput } from "@/configure/services/idp/types";
import type { StaticWebsiteServiceInput } from "@/configure/services/staticwebsite/types";
import type { GeneratorConfig } from "@/parser/generator-config";

export interface AppConfig<Auth = AuthConfig> {
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
  if (distPath === null) {
    distPath = process.env.TAILOR_SDK_OUTPUT_DIR || ".tailor-sdk";
  }
  return distPath;
};

export function defineConfig<Auth = AuthConfig>(
  config: AppConfig<Auth>,
): AppConfig<Auth> {
  if (!config?.workspaceId || !config?.name) {
    throw new Error(
      "Invalid Tailor config structure: workspaceId and name are required",
    );
  }
  return config;
}

export function defineGenerators(...configs: GeneratorConfig[]) {
  return configs;
}
