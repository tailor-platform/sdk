import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import ini from "ini";

type TailorctlConfigMap = Partial<
  {
    readonly global: {
      readonly context: string;
    };
  } & Readonly<Record<string, TailorctlConfig>>
>;

export type TailorctlConfig = Readonly<{
  controlplaneaccesstoken: string;
  // controlplanerefreshtoken: string;
  // controlplanetokenexpiresat: string;
  workspaceid: string;
}>;

export function readTailorctlConfig() {
  const configPath = path.join(os.homedir(), ".tailorctl", "config");
  if (!fs.existsSync(configPath)) {
    return;
  }
  const configMap = ini.parse(
    fs.readFileSync(configPath, "utf-8"),
  ) as TailorctlConfigMap;
  return configMap[configMap.global?.context || "default"];
}
