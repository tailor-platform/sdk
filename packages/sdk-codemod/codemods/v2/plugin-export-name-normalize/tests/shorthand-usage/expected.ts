import { definePlugins } from "@tailor-platform/sdk";
import myPlugin from "./plugins/my-plugin";

export const plugins = definePlugins(myPlugin());

export function debugInfo(): unknown {
  return { generators: plugins };
}
