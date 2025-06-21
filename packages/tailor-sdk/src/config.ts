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

export function defineConfig(configs: WorkspaceConfig): WorkspaceConfig {
  if (!configs || !configs.name) {
    throw new Error("Invalid Tailor config structure");
  }
  return configs;
}
