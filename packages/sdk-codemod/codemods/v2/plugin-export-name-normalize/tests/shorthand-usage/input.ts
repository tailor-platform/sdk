import { definePlugins } from "@tailor-platform/sdk";
import myPlugin from "./plugins/my-plugin";

export const generators = definePlugins(myPlugin());

export function debugInfo(): unknown {
  return { generators };
}
