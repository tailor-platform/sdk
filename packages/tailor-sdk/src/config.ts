/* eslint-disable @typescript-eslint/no-explicit-any */
import type { TailorDBServiceInput } from "@/services/tailordb/types";
import type { PipelineResolverServiceInput } from "@/services/pipeline/types";
import type { AuthServiceInput } from "@/services/auth/types";
import { Region } from "@/types/types";
import { SdlGeneratorID } from "@/generator/builtin/sdl/index";
import {
  KyselyGenerator,
  KyselyGeneratorID,
} from "@/generator/builtin/kysely-type/index";
import { CodeGenerator } from "@/generator/types";

export interface AppConfig {
  db: TailorDBServiceInput;
  resolver: PipelineResolverServiceInput;
  auth: AuthServiceInput;
}

export interface WorkspaceConfig {
  name: string;
  region: Region;
  app: Record<string, AppConfig>;
  generators?: Array<
    | typeof SdlGeneratorID
    | [
        typeof KyselyGeneratorID,
        ConstructorParameters<typeof KyselyGenerator>[0],
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

export function defineConfig(configs: WorkspaceConfig): WorkspaceConfig {
  if (!configs || !configs.name) {
    throw new Error("Invalid Tailor config structure");
  }
  return configs;
}
