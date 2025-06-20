import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as TOML from "@iarna/toml";

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
