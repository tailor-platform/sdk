import plugins from "./existing-plugins";
import { definePlugins } from "@tailor-platform/sdk";
import myPlugin from "./plugins/my-plugin";

export const generators = definePlugins(myPlugin());

console.log(plugins);
