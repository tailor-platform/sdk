import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { parse, stringify } from "smol-toml";

type TailorctlConfigMap = Partial<
  {
    global: {
      context: string;
    };
  } & Record<string, TailorctlConfig>
>;

export type TailorctlConfig = {
  controlplaneaccesstoken: string;
  controlplanerefreshtoken: string;
  controlplanetokenexpiresat: string;
  workspaceid: string;
};

export function readTailorctlConfig() {
  const configMap = readTailorctlConfigMap();
  return configMap ? configMap[tailorctlContext(configMap)] : undefined;
}

export function writeTailorctlConfig(config: TailorctlConfig) {
  const configMap = readTailorctlConfigMap();
  if (!configMap) {
    return;
  }
  configMap[tailorctlContext(configMap)] = config;
  fs.writeFileSync(tailorctlConfigPath(), stringify(configMap));
}

function readTailorctlConfigMap() {
  const configPath = tailorctlConfigPath();
  if (!fs.existsSync(configPath)) {
    return;
  }
  return parse(fs.readFileSync(configPath, "utf-8")) as TailorctlConfigMap;
}

function tailorctlConfigPath() {
  return path.join(os.homedir(), ".tailorctl", "config");
}

function tailorctlContext(configMap: TailorctlConfigMap) {
  return configMap.global?.context || "default";
}
