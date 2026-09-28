import { definePlugins } from "@tailor-platform/sdk";
import myPlugin from "./plugins/my-plugin";

export const plugins = definePlugins(myPlugin());
console.log(`Loaded ${plugins.length} plugin(s)`);
