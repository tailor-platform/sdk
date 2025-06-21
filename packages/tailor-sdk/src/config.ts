import type { TailorDBServiceInput } from "./services/tailordb/types";
import type { PipelineResolverServiceInput } from "./services/pipeline/types";
import type { AuthServiceInput } from "./services/auth/types";

interface AppConfig {
  name: string;
  db: TailorDBServiceInput;
  resolver: PipelineResolverServiceInput;
  auth: AuthServiceInput;
}

export interface WorkspaceConfig {
  name: string;
  app: AppConfig;
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
