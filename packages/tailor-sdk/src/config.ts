import type { TailorDBServiceInput } from "@/services/tailordb/types";
import type { PipelineResolverServiceInput } from "@/services/pipeline/types";
import type { AuthConfig } from "@/services/auth/types";
import type { ExecutorServiceInput } from "@/services/executor/types";
import { type IdPServiceInput } from "./services/idp/types";
import type { StaticWebsiteServiceInput } from "@/services/staticwebsite/types";
import {
  type KyselyGenerator,
  type KyselyGeneratorID,
} from "@/generator/builtin/kysely-type/index";
import {
  type DbTypeGenerator,
  type DbTypeGeneratorID,
} from "@/generator/builtin/db-type/index";
import { type CodeGenerator } from "@/generator/types";

export interface AppConfig {
  workspaceId: string;
  name: string;
  cors?: string[];
  allowedIPAddresses?: string[];
  disableIntrospection?: boolean;
  db?: TailorDBServiceInput;
  pipeline?: PipelineResolverServiceInput;
  idp?: IdPServiceInput;
  auth?: AuthConfig;
  executor?: ExecutorServiceInput;
  staticWebsites?: Record<string, StaticWebsiteServiceInput>;
  // FIXME: separate generator config;
  generators?: Array<
    | [
        typeof KyselyGeneratorID,
        ConstructorParameters<typeof KyselyGenerator>[0],
      ]
    | [
        typeof DbTypeGeneratorID,
        ConstructorParameters<typeof DbTypeGenerator>[0],
      ]
    | CodeGenerator<any, any, any, any>
  >;
}

let distPath: string | null = null;

export const getDistDir = (): string => {
  if (distPath === null) {
    distPath = process.env.TAILOR_SDK_OUTPUT_DIR || ".tailor-sdk";
  }
  return distPath;
};

export function defineConfig(config: AppConfig): AppConfig {
  if (!config?.workspaceId || !config?.name) {
    throw new Error(
      "Invalid Tailor config structure: workspaceId and name are required",
    );
  }
  return config;
}
