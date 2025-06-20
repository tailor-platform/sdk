import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as TOML from "@iarna/toml";
import type { TailorDBServiceInput } from "./services/tailordb/types";
import type { PipelineResolverServiceInput } from "./services/pipeline/types";
import type { AuthServiceInput } from "./services/auth/types";

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface TailorConfig {}

export const loadTailorConfig = (): TailorConfig | null => {
  const homeDir = os.homedir();
  const configPath = path.join(homeDir, ".tailorctl", "config");

  if (!fs.existsSync(configPath)) {
    console.warn("Tailor config file not found at:", configPath);
    return null;
  }

  const configContent = fs.readFileSync(configPath, "utf8");
  const config = TOML.parse(configContent) as TailorConfig;
  return config;
};

export interface AppConfig {
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
