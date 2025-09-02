/* eslint-disable @typescript-eslint/no-explicit-any */
import type { TailorDBServiceInput } from "@/services/tailordb/types";
import type { PipelineResolverServiceInput } from "@/services/pipeline/types";
import type { AuthServiceInput } from "@/services/auth/types";
import type { ExecutorServiceInput } from "@/services/executor/types";
import { IdPServiceInput } from "./services/idp/types";
import { Region } from "@/types/types";
import {
  KyselyGenerator,
  KyselyGeneratorID,
} from "@/generator/builtin/kysely-type/index";
import {
  DbTypeGenerator,
  DbTypeGeneratorID,
} from "@/generator/builtin/db-type/index";
import { CodeGenerator } from "@/generator/types";

export interface AppConfig {
  cors?: string[];
  allowedIPAddresses?: string[];
  disableIntrospection?: boolean;
  db?: TailorDBServiceInput;
  pipeline?: PipelineResolverServiceInput;
  idp?: IdPServiceInput;
  auth?: AuthServiceInput;
}

export type WorkspaceConfig = (
  | { id: string; name?: undefined; region?: undefined }
  | { id?: undefined; name: string; region: Region }
) & {
  app: Record<string, AppConfig>;
  executor?: ExecutorServiceInput;
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
  tsConfig?: string;
};

let distPath: string | null = null;

export const getDistDir = (): string => {
  if (distPath === null) {
    distPath = process.env.TAILOR_SDK_OUTPUT_DIR || ".tailor-sdk";
  }
  return distPath;
};

export function defineConfig(configs: WorkspaceConfig): WorkspaceConfig {
  if (!configs || !("id" in configs || "name" in configs)) {
    throw new Error("Invalid Tailor config structure");
  }
  return configs;
}
